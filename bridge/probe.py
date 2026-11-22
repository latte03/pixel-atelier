"""Native Codex app-server smoke test. Uses local Codex login, never reads tokens."""
import argparse,base64,json,queue,subprocess,threading,time
from pathlib import Path


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--reference',required=True);ap.add_argument('--output',required=True);ap.add_argument('--timeout',type=int,default=240);args=ap.parse_args()
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    ref=Path(args.reference).resolve();assert ref.is_file()
    proc=subprocess.Popen(['codex','app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    messages=queue.Queue();events=[];pending={};counter=0
    def reader():
        for line in proc.stdout:
            try:messages.put(json.loads(line))
            except ValueError:pass
    def discard_stderr():
        for line in proc.stderr:pass
    threading.Thread(target=reader,daemon=True).start();threading.Thread(target=discard_stderr,daemon=True).start()
    def send(v):proc.stdin.write(json.dumps(v)+'\n');proc.stdin.flush()
    def observe(m):
        if 'method' not in m:return
        name=m['method'];params=m.get('params',{});item=params.get('item',{})
        event={'method':name}
        if item.get('type')=='imageGeneration':
            event['item']={k:v for k,v in item.items() if k not in ['result']}
            result=item.get('result','')
            if isinstance(result,str) and result and params.get('item',{}).get('status')=='completed':
                try:
                    data=result.split(',',1)[1] if result.startswith('data:') else result
                    decoded=base64.b64decode(data,validate=True)
                    if decoded.startswith(b'\x89PNG'):
                        path=out/('image-%d.png'%sum(x.get('method')=='image_saved' for x in events));path.write_bytes(decoded);events.append({'method':'image_saved','path':str(path)})
                except (ValueError,TypeError):pass
            if item.get('savedPath'):event['savedPath']=item['savedPath']
            print(json.dumps(event,ensure_ascii=False),flush=True)
        elif name in ['turn/completed','error','item/agentMessage/delta']:
            if name=='item/agentMessage/delta':event['delta']=params.get('delta','')[:1600]
            else:event['params']=params
            print(json.dumps(event,ensure_ascii=False),flush=True)
        events.append(event)
        if 'id' in m:send({'id':m['id'],'error':{'code':-32601,'message':'This image-only client does not execute client-side tools or approve commands.'}})
    def request(method,params):
        nonlocal counter
        counter+=1;rid=counter;send({'id':rid,'method':method,'params':params});end=time.monotonic()+30
        while time.monotonic()<end:
            m=messages.get(timeout=max(.1,end-time.monotonic()))
            if m.get('id')==rid and 'method' not in m:
                if 'error' in m:raise RuntimeError(json.dumps(m['error']))
                return m.get('result',{})
            observe(m)
        raise TimeoutError(method)
    receipt={'transport':'native_codex_app_server_stdio','reference':str(ref),'image_generation_calls':0,'status':'running'}
    try:
        init=request('initialize',{'clientInfo':{'name':'pixel_character_bridge','title':'Pixel Character Bridge','version':'0.1.0'},'capabilities':{'experimentalApi':True}})
        receipt['server']=init.get('userAgent');send({'method':'initialized'})
        models=request('model/list',{}).get('data',[]);receipt['availableModels']=[m.get('model') for m in models];selected=next((m.get('model') for m in models if m.get('isDefault')),None);receipt['selectedModel']=selected;print(json.dumps({'availableModels':receipt['availableModels'],'selectedModel':selected}),flush=True)
        thread=request('thread/start',{**({'model':selected} if selected else {}),'cwd':str(out),'approvalPolicy':'never','sandbox':'workspace-write','ephemeral':True,'config':{'features.image_generation':True},'developerInstructions':'You are an image-generation integration test. Use ONLY the built-in image generation tool. Never use an API key, external image API, shell drawing, Python image drawing, or fallback CLI. If built-in image generation is unavailable, report that clearly and stop. Generated content should be a transparent PNG.'})
        tid=thread['thread']['id'];receipt['threadId']=tid
        for step,prompt in enumerate([
            'Use the attached image as the exact character identity reference. Generate ONE single full-body pixel-art pose of this same blonde armored girl and her silver greatsword in ready guard, with a genuinely transparent background. Keep body proportions, face, blue headband, red tabard and equipment. Do not make a sheet or GIF. Use the built-in image generation tool now. This is a real image generation test; return the generated PNG.',
            'Edit the image you just generated: change only the expression to one eye winking and a small cheerful smile. Preserve the character, pose, armor, weapon dimensions, pixel style and genuine transparency. Use the built-in image-generation tool and return the edited PNG.'
        ]):
            inputs=[{'type':'text','text':prompt}]
            if step==0:inputs.append({'type':'localImage','path':str(ref)})
            request('turn/start',{'threadId':tid,'input':inputs});end=time.monotonic()+args.timeout
            while time.monotonic()<end:
                try:m=messages.get(timeout=min(5,max(.1,end-time.monotonic())))
                except queue.Empty:
                    if proc.poll() is not None:raise RuntimeError('App-server exited')
                    continue
                observe(m)
                if m.get('method')=='turn/completed':break
            else:raise TimeoutError('generation turn')
            count=sum(x.get('item',{}).get('type')=='imageGeneration' and x.get('item',{}).get('status')=='completed' for x in events)
            receipt['image_generation_calls']=count
            if count<step+1:
                receipt['status']='upstream_turn_failed' if m.get('params',{}).get('turn',{}).get('status')=='failed' else 'native_image_generation_unavailable';receipt['turnError']=m.get('params',{}).get('turn',{}).get('error');break
            receipt['status']='generation_and_edit_completed' if step==1 else 'first_generation_completed'
        return receipt
    except Exception as e:
        receipt['status']='error';receipt['error']=str(e);return receipt
    finally:
        (out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
        (out/'events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill()
        print(json.dumps(receipt,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
