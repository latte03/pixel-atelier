"""Loopback reference-to-image workbench: custom API keys or native Codex app-server."""
import argparse,base64,hashlib,http.cookies,io,json,queue,re,secrets,threading,time,uuid
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from PIL import Image
try:from .editor import decode_image,export_animation,gif_reference_frames
except ImportError:from editor import decode_image,export_animation,gif_reference_frames
try:from .projects import ProjectStore,Conflict,create_knight,create_from_master,export_character,palette_for,render_action,save_idle_gif
except ImportError:from projects import ProjectStore,Conflict,create_knight,create_from_master,export_character,palette_for,render_action,save_idle_gif
try:from .rpc import BridgeError,CodexClient,inspect_sprite_png
except ImportError:from rpc import BridgeError,CodexClient,inspect_sprite_png
try:from .settings import Settings
except ImportError:from settings import Settings
try:from .clients import ImageAPIClient,LLMClient,fetch_models
except ImportError:from clients import ImageAPIClient,LLMClient,fetch_models

try:from .production import Production
except ImportError:from production import Production

ROOT=Path(__file__).resolve().parents[1];WORK=ROOT/'work'/'image-workbench';WORK.mkdir(parents=True,exist_ok=True)
KNIGHT_SAMPLE=ROOT/'examples'/'knight'
PROJECTS=ProjectStore(WORK/'projects')
SETTINGS=Settings(WORK/'config.json')
JOBS={};LOCK=threading.Lock();Q=queue.Queue();TOKEN=secrets.token_urlsafe(32)

def record(job):
    (WORK/job['id']/'job.json').write_text(json.dumps(job,ensure_ascii=False,indent=2))

def image_artifact(job):
    filename = job.get('image_file', 'result-0.png')
    if not re.fullmatch(r'result-[0-9]+\.png', filename):
        raise ValueError('生成图片文件名无效')
    return WORK/job['id']/filename


def complete_job(job,path,model,completion):
    size = inspect_sprite_png(path)
    job.pop('error', None)
    job.update(
        status='completed',image_url='/image/'+job['id'],image_file=path.name,
        model=model,image_size=size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        generation_completion=completion,
    )


def recover_timed_out_job(job):
    if job.get('status')!='failed' or job.get('error')!='Generation timed out; no success has been recorded.':
        return
    events=job.get('events',[])
    if not any(e.get('type')=='imageGeneration' and e.get('status')=='completed' for e in events):
        return
    folder=WORK/job['id']
    candidates=[p for p in folder.glob('result-*.png') if re.fullmatch(r'result-[0-9]+\.png',p.name)]
    model=next((e.get('model') for e in events if e.get('type')=='model'),None)
    for candidate in sorted(candidates,key=lambda p:int(p.stem.split('-')[1]),reverse=True):
        try:
            complete_job(job,candidate,model,'artifact_recovered')
        except (BridgeError,OSError):
            continue
        record(job)
        return


def layout_constraint(layout,kind='pose'):
    """Describe the sheet layout the polished prompt must keep, from the real job options."""
    if kind!='sheet':
        return '单张完整角色姿势图（不要生成表格）','完整角色居中'
    cols,rows,count=(layout or {}).get('cols'),(layout or {}).get('rows'),(layout or {}).get('count')
    if isinstance(cols,int) and isinstance(rows,int) and cols>0 and rows>0:
        grid=f'{cols}列×{rows}行表格'+(f'（共{count}个关键姿势）' if isinstance(count,int) and count>0 else '')
    else:
        grid='用户指定的表格行列数（不得改成其他排版）'
    return grid,'每格一名完整角色'


def polish_prompt(prompt,llm_cfg,event,layout=None,kind='pose'):
    """Optionally rewrite the Chinese brief into an English image prompt via the custom LLM."""
    if not llm_cfg.get('polish_prompt'):return prompt
    grid,subject=layout_constraint(layout,kind)
    try:
        client=LLMClient(llm_cfg['base_url'],llm_cfg['api_key'],llm_cfg['model'])
        polished=client.chat(
            prompt,
            system=('你是像素游戏动作图表的提示词工程师。把用户的中文制作要求改写为一段面向图像生成模型的英文提示词。'
                    f'必须保留全部硬性约束：{grid}、透明背景、{subject}、统一比例与装备、无文字无边框。'
                    '把角色设定与动作过程翻译成具体视觉描述。只输出英文提示词正文，不要任何解释。'),
        )
        if not polished:raise BridgeError('文本模型返回空提示词')
        event({'type':'prompt_polish','status':'ok','layout':grid})
        return polished
    except Exception as e:
        event({'type':'prompt_polish','status':'failed','message':str(e)[:200]})
        return prompt


def run_generation_job(job,event):
    reference=WORK/job['id']/'reference.png'
    reference=reference if reference.is_file() else None
    cfg=SETTINGS.raw()
    if cfg.get('provider')=='codex':
        client=CodexClient(event)
        try:
            result=client.generate(reference,job['prompt'],WORK/job['id'],timeout=240)
        finally:
            client.close()
        return result
    icfg=SETTINGS.image_config()
    prompt=polish_prompt(job['prompt'],cfg['llm'],event,job.get('layout') or {},job.get('kind') or 'pose')
    client=ImageAPIClient(icfg['base_url'],icfg['api_key'],icfg['model'],icfg.get('size',''),
                          icfg.get('response_format',''),on_event=event,timeout=int(icfg.get('timeout') or 300))
    try:
        return client.generate(prompt,reference,WORK/job['id'])
    finally:
        client.close()


def worker():
    while True:
        jid=Q.get();job=JOBS[jid]
        try:
            job.update(status='running');record(job)
            def event(e):
                job['events'].append(e);record(job)
            result=run_generation_job(job,event)
            path=Path(result['images'][-1])
            complete_job(job,path,result['model'],result['completion'])
        except Exception as e:job.update(status='failed',error=str(e))
        finally:
            job['finished_at']=time.time();record(job);Q.task_done()

def enqueue_generation(data):
    prompt=data.get('prompt','').strip()
    if not 1<=len(prompt)<=6000:raise ValueError('请填写生成或修改要求，最多6000字')
    with LOCK:
        if generation_busy():raise ValueError('已有生成任务运行中，请等待完成')
        jid=uuid.uuid4().hex;folder=WORK/jid;folder.mkdir()
        if data.get('parent_id'):
            parent=JOBS.get(data['parent_id'])
            if not parent or parent.get('status')!='completed':raise ValueError('请选择已完成的结果')
            raw=image_artifact(parent).read_bytes()
        elif data.get('reference_id'):
            rid=data['reference_id']
            if not isinstance(rid,str)or len(rid)!=32 or any(c not in '0123456789abcdef'for c in rid):raise ValueError('参考图不存在')
            raw=(WORK/'references'/rid/'image.png').read_bytes()
        elif data.get('reference'):raw=base64.b64decode(data['reference'].split(',',1)[-1],validate=True)
        elif data.get('from_text') is True and data.get('action') == 'idle':
            context = data.get('character_context') or {}
            PROJECTS.get(context.get('id'))
            raw = None
        else:raise ValueError('请选择生成动作所用的角色参考图')
        if raw is not None:
            with Image.open(io.BytesIO(raw)) as im:
                if im.width*im.height>16_000_000:raise ValueError('参考图尺寸过大')
                im.convert('RGBA').save(folder/'reference.png')
        job={'id':jid,'prompt':prompt,'parent_id':data.get('parent_id'),'status':'queued','created_at':time.time(),'events':[],'action':str(data.get('action','custom'))[:30],'kind':str(data.get('kind','pose'))[:20],'character_context':data.get('character_context'),'layout':data.get('layout')if isinstance(data.get('layout'),dict)else None};JOBS[jid]=job;record(job);Q.put(jid)
    return job


def generation_busy():
    return any(j['status'] in ('queued','running') for j in list(JOBS.values()))


def api_models(kind):
    if kind not in ('image','llm'):raise ValueError('无效模型类型')
    section=SETTINGS.raw()[kind]
    if not section.get('api_key'):raise ValueError('请先在「API 设置」中填写对应的 API Key')
    return fetch_models(section['base_url'],section['api_key'])


def api_test(data):
    target=data.get('target')
    if target not in ('image','llm'):raise ValueError('无效测试目标')
    cfg=SETTINGS.raw()[target]
    base=str(data.get('base_url') or cfg['base_url']).strip()
    key=str(data.get('api_key') or '').strip() or cfg['api_key']
    if not key:raise ValueError('请先填写 API Key')
    models=fetch_models(base,key)
    return {'ok':True,'target':target,'models':models,'message':'连接成功，发现 %d 个模型'%len(models)}


PRODUCTION=Production(WORK/'production',PROJECTS,JOBS,enqueue_generation,image_artifact,generation_busy)


def production_scheduler():
    while True:
        PRODUCTION.tick()
        time.sleep(1)


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self,status,data,kind='application/json'):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def authorized(self):
        cookie=http.cookies.SimpleCookie();cookie.load(self.headers.get('Cookie',''))
        return cookie.get('pixel_bridge') is not None and secrets.compare_digest(cookie['pixel_bridge'].value,TOKEN)
    def valid_host(self):return self.headers.get('Host') in ['127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port)]
    def do_GET(self):
        if self.path.startswith('/?'):self.path='/'
        if not self.valid_host():return self.respond(403,{'error':'Invalid host'})
        if self.path=='/':
            body=(ROOT/'bridge/workbench.html').read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Set-Cookie','pixel_bridge='+TOKEN+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if self.path in ['/workbench.css','/workbench.js','/beginner.css','/beginner.js','/character.js','/character.css','/atelier.css','/atelier.js','/simple-editor.css','/simple-editor.js','/delivery.css','/delivery.js','/production.js','/production.css','/settings.css','/settings.js']:
            kind='text/css' if self.path.endswith('.css') else 'application/javascript'
            return self.respond(200,(ROOT/'bridge'/self.path[1:]).read_bytes(),kind)
        if self.path=='/health':return self.respond(200,{'service':'pixel-codex-bridge','transport':SETTINGS.raw().get('provider','custom'),'ready':True,'generation_verified':any(j.get('status')=='completed' for j in JOBS.values())})
        if not self.authorized():return self.respond(401,{'error':'Open the workbench first'})
        if self.path=='/config':return self.respond(200,SETTINGS.masked())
        if self.path=='/models/image':
            try:return self.respond(200,api_models('image'))
            except (BridgeError,ValueError,OSError) as e:return self.respond(400,{'error':str(e)})
        if self.path=='/models/llm':
            try:return self.respond(200,api_models('llm'))
            except (BridgeError,ValueError,OSError) as e:return self.respond(400,{'error':str(e)})
        if self.path=='/catalog':
            local=[{'id':k,'image_url':'/catalog/'+k+'.png'} for k in ('bow','staff') if (WORK/'catalog'/(k+'.png')).is_file()]
            return self.respond(200,[{'id':'greatsword','image_url':'/catalog/greatsword.png'}]+local)
        if self.path in ['/catalog/greatsword.png','/catalog/bow.png','/catalog/staff.png']:
            path=WORK/'catalog'/self.path.split('/')[-1]
            if self.path=='/catalog/greatsword.png' and not path.is_file():
                path=KNIGHT_SAMPLE/'idle'/'poster.png'
            if path.is_file():return self.respond(200,path.read_bytes(),'image/png')
        if self.path.startswith('/production/'):
            try:return self.respond(200,PRODUCTION.get(self.path.split('/')[-1]))
            except (ValueError,OSError):return self.respond(404,{'error':'工程不存在'})
        if self.path=='/projects':return self.respond(200,PROJECTS.list())
        if self.path.startswith('/project/'):
            try:return self.respond(200,PROJECTS.get(self.path.split('/')[-1]))
            except (ValueError,OSError):return self.respond(404,{'error':'工程不存在'})
        if self.path=='/examples':
            manifest=KNIGHT_SAMPLE/'manifest.json'
            return self.respond(200,json.loads(manifest.read_text())if manifest.is_file()else [])
        if self.path.startswith('/example/'):
            bits=self.path.strip('/').split('/')
            if len(bits)==3 and bits[1]in ['idle','run','dash','light','heavy','jump','hurt','knockdown']and bits[2]in ['atlas.png','poster.png']:
                path=KNIGHT_SAMPLE/bits[1]/bits[2]
                if path.is_file():return self.respond(200,path.read_bytes(),'image/png')
        if self.path=='/jobs':return self.respond(200,sorted(JOBS.values(),key=lambda j:j['created_at'],reverse=True))
        if self.path=='/references':
            return self.respond(200,[json.loads(f.read_text())for f in sorted((WORK/'references').glob('*/meta.json'),reverse=True)])
        if self.path.startswith('/reference/'):
            rid=self.path.split('/')[-1]
            if len(rid)==32 and all(c in '0123456789abcdef'for c in rid):
                path=WORK/'references'/rid/'image.png'
                if path.is_file():return self.respond(200,path.read_bytes(),'image/png')
        if self.path.startswith('/export/'):
            bits=self.path.strip('/').split('/')
            if len(bits)==3 and len(bits[1])==32 and all(c in '0123456789abcdef'for c in bits[1])and bits[2]in ['preview.gif','atlas.png','animation.json','assets.zip']:
                path=WORK/'exports'/bits[1]/bits[2]
                kind={'gif':'image/gif','png':'image/png','json':'application/json','zip':'application/zip'}[bits[2].split('.')[-1]]
                if path.is_file():return self.respond(200,path.read_bytes(),kind)
        if self.path.startswith('/image/'):
            jid=self.path.removeprefix('/image/') if hasattr(str,'removeprefix') else self.path[7:]
            job=JOBS.get(jid)
            if job and job.get('status')=='completed':
                path=image_artifact(job)
                if path.is_file():return self.respond(200,path.read_bytes(),'image/png')
        self.respond(404,{'error':'Not found'})
    def do_POST(self):
        if not self.valid_host() or not self.authorized():return self.respond(403,{'error':'Unauthorized'})
        origin=self.headers.get('Origin')
        if origin and origin!='http://'+self.headers.get('Host',''):return self.respond(403,{'error':'Invalid origin'})
        if self.path not in ['/production','/jobs','/references','/references/gif-frames','/exports','/projects','/projects/knight','/projects/master','/projects/idle-gif','/projects/save','/projects/clone','/projects/freeze','/projects/export','/config','/config/test']:return self.respond(404,{'error':'Not found'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=(80 if self.path.startswith('/projects') or self.path=='/production'else 17 if self.path=='/references/gif-frames'else 16)*1024*1024:raise ValueError('文件过大或请求为空')
            data=json.loads(self.rfile.read(size))
            if self.path=='/config':return self.respond(200,SETTINGS.update(data))
            if self.path=='/config/test':return self.respond(200,api_test(data))
            if self.path=='/production':return self.respond(200,PRODUCTION.command(data))
            if self.path=='/projects/master':return self.respond(201,PROJECTS.save(create_from_master(data)))
            if self.path=='/projects/idle-gif':return self.respond(201,save_idle_gif(PROJECTS.get(data['id']), PROJECTS, data))
            if self.path=='/projects/knight':
                project=PROJECTS.save(create_knight(KNIGHT_SAMPLE))
                PRODUCTION.add_sample(project)
                return self.respond(201,project)
            if self.path=='/projects':return self.respond(201,PROJECTS.save(data))
            if self.path=='/projects/save':return self.respond(200,PROJECTS.save(data['project'],data['project']['id'],data['expected_revision']))
            if self.path=='/projects/clone':
                p=PROJECTS.get(data['id']);p['parent_id']=p['id'];p['name']=str(data.get('name',p['name']+' · 副本'))[:80];return self.respond(201,PROJECTS.save(p))
            if self.path=='/projects/freeze':
                p=data['project'];p['spec']['palette']=palette_for([im for a in p['actions'].values()for im in render_action(a)],p['spec'].get('paletteLimit',64));p['spec']['frozen']=True;p['spec']['version']=p['spec'].get('version',0)+1
                return self.respond(200,PROJECTS.save(p,p['id'],data['expected_revision']))
            if self.path=='/projects/export':
                p=PROJECTS.get(data['id']);eid=uuid.uuid4().hex;manifest=export_character(p,WORK/'exports'/eid);return self.respond(201,{'zip_url':'/export/'+eid+'/assets.zip','actions':len(manifest['actions'])})
            if self.path=='/references/gif-frames':return self.respond(200,gif_reference_frames(data.get('image')))
            if self.path=='/references':
                image=decode_image(data.get('image'));rid=uuid.uuid4().hex;folder=WORK/'references'/rid;folder.mkdir(parents=True)
                image.save(folder/'image.png');meta={'id':rid,'name':str(data.get('name','未命名角色'))[:60],'size':list(image.size),'image_url':'/reference/'+rid,'created_at':time.time()};(folder/'meta.json').write_text(json.dumps(meta,ensure_ascii=False));return self.respond(201,meta)
            if self.path=='/exports':
                eid=uuid.uuid4().hex;conf=export_animation(data,WORK/'exports'/eid)
                return self.respond(201,{'id':eid,'gif_url':'/export/'+eid+'/preview.gif','zip_url':'/export/'+eid+'/assets.zip','atlas_url':'/export/'+eid+'/atlas.png','config_url':'/export/'+eid+'/animation.json','frame_count':len(conf['frames']),'duration_ms':conf['duration_ms'],'palette_size':len(conf['palette'])})
            job=enqueue_generation(data)
            self.respond(202,job)
        except Conflict as e:self.respond(409,{'error':str(e)})
        except Exception as e:self.respond(400,{'error':str(e)})

def main():
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8898);args=p.parse_args()
    for f in WORK.glob('*/job.json'):
        try:
            j=json.loads(f.read_text())
            if j['status'] in ['queued','running']:j.update(status='failed',error='服务已重启，请重新提交。');record(j)
            recover_timed_out_job(j)
            JOBS[j['id']]=j
        except (ValueError,KeyError):pass
    threading.Thread(target=worker,daemon=True).start()
    threading.Thread(target=production_scheduler,daemon=True).start()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);print('Pixel Workbench http://127.0.0.1:'+str(args.port),flush=True);server.serve_forever()

if __name__=='__main__':main()
