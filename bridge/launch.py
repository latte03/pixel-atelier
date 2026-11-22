"""Start the loopback workbench and an isolated DSH profile."""
import argparse,json,os,re,subprocess,sys,time,urllib.request,webbrowser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser();p.add_argument('--open',action='store_true');args=p.parse_args()
    work=ROOT/'work';work.mkdir(exist_ok=True)
    def spawn(cmd,log,env=None):
        stream=(work/log).open('a');return subprocess.Popen(cmd,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stream,stderr=stream,start_new_session=True)
    try:
        with urllib.request.urlopen('http://127.0.0.1:8898/health',timeout=1) as r:
            if json.load(r).get('service')!='pixel-codex-bridge':raise RuntimeError('Port8898 belongs to another service')
    except OSError:spawn([sys.executable,'bridge/server.py','--port','8898'],'workbench-server.log')
    env=os.environ.copy();env['DSH_HOME']=str(work/'dsh-home')
    profile=work/'dsh-home/profiles/pixel-atelier'
    if not profile.exists():subprocess.run(['dsh','--profile','pixel-atelier','--from-default-profile','web','--dump-config'],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
    package=profile/'package.json';obj=json.loads(package.read_text());obj.setdefault('dependencies',{})['dsh-pixel-atelier']='file:'+str(ROOT/'bridge/dsh-plugin');package.write_text(json.dumps(obj,indent=2)+'\n')
    node=profile/'node_modules';node.mkdir(exist_ok=True);link=node/'dsh-pixel-atelier'
    if not link.exists():link.symlink_to(ROOT/'bridge/dsh-plugin',target_is_directory=True)
    patch=profile/'cordis.patch.yml'
    if not patch.exists() or patch.read_text().strip().endswith('[]'):patch.write_text('- insert:\n    - id: pixel-atelier\n      name: dsh-pixel-atelier\n')
    try:urllib.request.urlopen('http://127.0.0.1:8899/',timeout=1)
    except urllib.error.HTTPError:pass
    except OSError:spawn(['dsh','--profile','pixel-atelier','--no-open','--port','8899'],'dsh-server.log',env)
    url=None
    for _ in range(30):
        log=work/'dsh-server.log';match=re.findall(r'http://127\.0\.0\.1:8899/\?\S+',log.read_text() if log.exists() else '')
        if match:url=match[-1];break
        time.sleep(.5)
    print('Workbench: http://127.0.0.1:8898')
    print('DSH isolated profile: pixel-atelier; its startup log is work/dsh-server.log (contains local sign-in link).')
    if args.open:webbrowser.open(url or 'http://127.0.0.1:8898')

if __name__=='__main__':main()
