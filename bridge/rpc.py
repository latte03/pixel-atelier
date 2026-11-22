"""Native Codex JSON-RPC client. No token access or image API fallback."""
import base64,json,queue,shutil,subprocess,threading,time
from pathlib import Path
from PIL import Image

class BridgeError(RuntimeError):pass

def inspect_sprite_png(path):
    """Decode the result and require both a visible subject and transparent pixels."""
    try:
        with Image.open(path) as image:
            if image.format != 'PNG':
                raise BridgeError('生成结果须为 PNG')
            low, high = image.convert('RGBA').getchannel('A').getextrema()
            if low != 0 or high == 0:
                raise BridgeError('生成结果需要有可见主体和真正透明的背景')
            return list(image.size)
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise BridgeError('无法读取生成的 PNG') from error


class CodexClient:
    def __init__(self,on_event=None,timeout=40):
        self.on_event=on_event or (lambda e:None);self.timeout=timeout;self.counter=0;self.q=queue.Queue()
        self.proc=subprocess.Popen(['codex','app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        threading.Thread(target=self._read,daemon=True).start()
        threading.Thread(target=lambda:[None for _ in self.proc.stderr],daemon=True).start()
        try:
            self.request('initialize',{'clientInfo':{'name':'pixel_character_bridge','title':'Pixel Character Bridge','version':'0.1.0'},'capabilities':{'experimentalApi':True}})
            self.send({'method':'initialized'})
        except Exception:
            self.close();raise
    def _read(self):
        for line in self.proc.stdout:
            try:self.q.put(json.loads(line))
            except ValueError:pass
        self.q.put({'method':'bridge/processExited'})
    def send(self,obj):self.proc.stdin.write(json.dumps(obj)+'\n');self.proc.stdin.flush()
    def next(self,timeout=None):
        try:return self.q.get(timeout=timeout or self.timeout)
        except queue.Empty:raise BridgeError('Codex response timed out')
    def observe(self,m):
        method=m.get('method','');p=m.get('params',{});item=p.get('item',{})
        if 'id' in m and method:self.send({'id':m['id'],'error':{'code':-32601,'message':'Client tools and command approvals are not supported by this image-only bridge.'}})
        if method=='bridge/processExited':raise BridgeError('Codex process exited')
        if method=='error':self.on_event({'type':'upstream','message':p.get('error',{}).get('message','Generation service error'),'retrying':p.get('willRetry',False)})
        if item.get('type')=='imageGeneration':self.on_event({'type':'imageGeneration','status':item.get('status'),'failure':item.get('failure')})
    def request(self,method,params):
        self.counter+=1;rid=self.counter;self.send({'id':rid,'method':method,'params':params});end=time.monotonic()+self.timeout
        while time.monotonic()<end:
            m=self.next(max(.1,end-time.monotonic()))
            if m.get('id')==rid and 'method' not in m:
                if m.get('error'):raise BridgeError(json.dumps(m['error'],ensure_ascii=False))
                return m.get('result',{})
            self.observe(m)
        raise BridgeError('Codex RPC timeout: '+method)
    def generate(self,reference,prompt,output,timeout=240):
        out=Path(output).resolve();out.mkdir(parents=True,exist_ok=True)
        models=self.request('model/list',{}).get('data',[])
        model=next((m.get('model') for m in models if m.get('isDefault')),None)
        if not model:raise BridgeError('The Codex account did not return an available default model.')
        self.on_event({'type':'model','model':model})
        thread=self.request('thread/start',{'model':model,'cwd':str(out),'ephemeral':True,'approvalPolicy':'never','sandbox':'workspace-write','config':{'features.image_generation':True},'developerInstructions':'Image-only native Codex integration. Use ONLY built-in image generation. Never use image API keys, external image services, Python/SVG drawing or CLI fallback. If image generation is unavailable, explain and stop. Follow the user prompt and apply the attached reference when provided. Generate a truly transparent PNG.'})
        tid=thread['thread']['id']
        inputs = [{'type':'text','text':prompt}]
        if reference is not None:
            inputs.append({'type':'localImage','path':str(Path(reference).resolve())})
        self.request('turn/start',{'threadId':tid,'input':inputs})
        end=time.monotonic()+timeout
        images, messages, rejected = [], [], []
        ordinal = 0

        def result(completion):
            return {'model':model,'thread_id':tid,'images':[str(x) for x in images],
                    'completion':completion}

        def reject(error):
            rejected.append(str(error))
            self.on_event({'type':'artifact','status':'rejected','message':str(error)})

        while time.monotonic()<end:
            try:m=self.next(min(5,max(.1,end-time.monotonic())))
            except BridgeError:continue
            self.observe(m);p=m.get('params',{});item=p.get('item',{})
            if m.get('method')=='item/agentMessage/delta':messages.append(p.get('delta',''))
            if m.get('method')=='item/completed' and item.get('type')=='imageGeneration':
                if item.get('status')!='completed' or item.get('failure'):
                    reject('Native image generation failed: '+json.dumps(item.get('failure'),ensure_ascii=False))
                    continue
                target=out/('result-%d.png'%ordinal)
                ordinal+=1
                saved=item.get('savedPath')
                raw=item.get('result','')
                try:
                    if saved and Path(saved).is_file():
                        shutil.copyfile(saved,target)
                    elif isinstance(raw,str) and raw:
                        target.write_bytes(base64.b64decode(raw.split(',',1)[-1] if raw.startswith('data:') else raw,validate=True))
                    else:
                        raise BridgeError('Codex 已完成图片生成，但没有返回 PNG 文件')
                    inspect_sprite_png(target)
                except (OSError, ValueError, BridgeError) as error:
                    reject(error)
                else:
                    images.append(target)
            if m.get('method')=='turn/completed':
                turn=p.get('turn',{})
                if turn.get('status')=='failed':
                    if images:
                        return result('artifact_recovered')
                    raise BridgeError((turn.get('error') or {}).get('message','Codex turn failed'))
                if images:
                    return result('turn_completed')
                raise BridgeError(rejected[-1] if rejected else 'No native image generation occurred. '+''.join(messages)[-1600:])
        if images:
            return result('artifact_recovered')
        if rejected:
            raise BridgeError('生成超时，未收到可用 PNG。最后一次检查：'+rejected[-1])
        raise BridgeError('Generation timed out; no success has been recorded.')
    def close(self):
        self.proc.terminate()
        try:self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:self.proc.kill()
