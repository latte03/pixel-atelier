"""Guided and unattended production share the same ordered character workflow."""
import json
import threading
import time
import math
import uuid
from pathlib import Path
from PIL import Image

try:
    from .editor import decode_image
    from .projects import export_character, image_data, palette_for, render_action
except ImportError:
    from editor import decode_image
    from projects import export_character, image_data, palette_for, render_action


REVIEW_SECONDS = 12

STEPS = {
    'idle': ('待机', '保持站姿和呼吸，头发衣物轻微起伏，脚底稳定，首尾接成循环。', [150,110,100,120,150,110,100,120], True),
    'run': ('奔跑', '交替蹬地、腾空和落脚，髋膝踝连续，身体前倾。角色原地跑，首尾循环。', [80]*8, True),
    'dash': ('闪身', '压低身位，后脚蹬地，前倾爆发，随后刹停并回稳；位移留给游戏。', [100,80,60,40,50,70,100,130], False),
    'light': ('连段', '根据参考装备设计两段连续攻击。近战先斜劈至低位，随即蹬腿转髋从低处上挑，再回收；远程或法术设计两段相连的释放。每段沿动作轨迹短暂显示特效。', [120,90,50,70,60,50,100,140], False),
    'heavy': ('蓄力', '稳住支撑脚、压低重心，拉开蓄力与快速释放的速度差。沿用角色原有装备，释放后有明显缓冲与收势。', [130,150,200,180,50,80,110,150], False),
    'jump': ('跳跃', '屈膝预备、蹬地、空中收腿、伸腿下落、接地缓冲、恢复。世界跳跃轨迹交给游戏。', [110,90,70,90,100,90,80,130], False),
    'hurt': ('受击', '短促冲击使肩胸后仰，屈膝缓冲，装备随手滞后，再收回重心。', [60,50,60,70,80,90,110,130], False),
    'knockdown': ('倒地', '依次失衡、侧倒、着地缓冲，保持最后的倒地姿势。', [80,60,60,70,90,110,160,260], False),
}


def generation_prompt(project, action, note=''):
    label, motion, _, _ = STEPS[action]
    spec = project['spec']
    default_style = (
        '2.5至3头身Q版硬边像素风格（Chibi Pixel Art），1px清晰深色像素外轮廓，'
        '简化面部（斗笠或刘海遮眼、只露简洁下颌，不画写实五官），大块复古像素色阶（32-64色），'
        '若参考图为写实原画，必须转化为Q版像素小人比例，严禁照搬写实八头身比例与平滑插画笔触'
    )
    return (
        f"为像素角色「{project['name']}」设计并绘制一段{label}动作。"
        f"人物设定：{spec.get('identity') or project['name']}。"
        f"装备：{spec.get('weapon') or '根据参考图识别并沿用原装备，无装备就保留徒手'}。"
        f"画风：{spec.get('style') or default_style}。"
        f"制作要求：{motion}\n"
        "先根据角色比例、原装备和重心设计八个连贯关键姿势，再一次生成一张透明 PNG 图表。"
        "固定 4 列 × 2 行，等宽等高，严格从左到右、从上到下。每格只有一名完整角色，统一视角、人物比例和根节点。"
        "保持同一张脸、发型、服装、握持方式和装备结构。没有换装，不新增道具。"
        "各格四周留空，容纳人物、武器和特效。输出真实透明背景，无地面、文字、格线或背景填充。"
        + (f"\n本轮修改：{note}" if note else '')
    )


def fit_sheet(project, action, path, prompt, strict=True):
    with Image.open(path) as source:
        im = source.convert('RGBA')
    width, height = im.size
    cols, rows = 4, 2
    alpha = im.getchannel('A').point(lambda a: 255 if a >= 220 else 0)
    boxes = []
    for i in range(cols * rows):
        x, y = round(i % cols * width / cols), round(i // cols * height / rows)
        r, b = round((i % cols + 1) * width / cols), round((i // cols + 1) * height / rows)
        box = alpha.crop((x, y, r, b)).getbbox()
        if not box:
            raise ValueError(f'第 {i+1} 格为空，请检查图表或重新生成')
        if strict and (box[0] == 0 or box[1] == 0 or box[2] == r-x or box[3] == b-y):
            raise ValueError(f'第 {i+1} 格有像素贴边，请确认排版或重新生成')
        boxes.append(box)
    left, top = (min(b[i] for b in boxes) for i in (0, 1))
    right, bottom = (max(b[i] for b in boxes) for i in (2, 3))
    spec = project['spec']
    size = spec['frameSize']
    px, py = spec['pivot']
    horizontal = min(px, size-px) * 2 - 8
    vertical = py - 6
    scale = min(8, horizontal/(right-left), vertical/(bottom-top))
    if action!='idle' and project.get('masterBasis'):
        master = decode_image(project['master']).getchannel('A').point(lambda a: 255 if a >= 220 else 0).getbbox()
        if master:
            scale=min(scale,(master[3]-master[1])/(boxes[0][3]-boxes[0][1]))
    if scale <= 0:
        raise ValueError('当前锚点未给角色留出足够空间')
    _, _, timings, loop = STEPS[action]
    recipe = {
        'cols': cols, 'rows': rows, 'count': 8, 'frameSize': size, 'scale': scale,
        'baseOffset': [round(px-(left+right)*scale/2), round(py-bottom*scale)],
        'offsets': [[0,0] for _ in timings], 'durations': timings, 'pivot': [px,py],
        'colors':spec.get('paletteLimit',64), 'previewScale': 2, 'loop':loop,
    }
    return {'label':STEPS[action][0], 'source':image_data(im), 'recipe':recipe,
            'overrides':{}, 'prompt':prompt, 'review':'pending'}


class Production:
    def __init__(self, root, projects, jobs, enqueue, artifact, busy):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.projects, self.jobs, self.enqueue, self.artifact, self.busy = projects, jobs, enqueue, artifact, busy
        self.guard = threading.RLock()

    def path(self, pid):
        return self.root / (self.projects.path(pid).parent.name + '.json')

    def read(self, pid):
        path = self.path(pid)
        if path.is_file():
            return json.loads(path.read_text())
        return {'id':pid, 'mode':'guided', 'running':False, 'attempts':{}, 'accepted':{}, 'pending':None, 'export':None, 'error':''}

    def save(self, state):
        path = self.path(state['id'])
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(state, ensure_ascii=False))
        temp.replace(path)

    def add_sample(self, project):
        with self.guard:
            state = self.read(project['id'])
            state['accepted'] = {action: {'job':None,'source':'sample'} for action in STEPS}
            self.save(state)

    @staticmethod
    def next_action(state):
        return next((a for a in STEPS if a not in state['accepted']), None)

    def summary(self, state, project):
        pending = self.jobs.get(state['pending'])
        review = None
        if state['running'] and pending and pending['status']=='completed':
            review = max(0,math.ceil(pending.get('finished_at',time.time()) + REVIEW_SECONDS - time.time()))
        return {
            'review_in':review,
            **state, 'active':self.next_action(state), 'revision':project['revision'],
            'steps':[
                {'id':a,'label':s[0],'motion':s[1],
                 'existing':[k for k in project['actions'] if k==a or k.startswith(a+'_v')],
                 'versions':[
                     {k:j.get(k) for k in ('id','status','image_url','error')}
                     for jid in state['attempts'].get(a,[]) if (j:=self.jobs.get(jid))
                 ]}
                for a,s in STEPS.items()
            ],
            'has_art':bool(project.get('master') or (self.root/(state['id']+'.png')).exists()),
        }

    def get(self, pid):
        with self.guard:
            return self.summary(self.read(pid), self.projects.get(pid))

    def reference(self, project):
        if project.get('master'):
            return project['master']
        path = self.root/(project['id']+'.png')
        if path.exists():
            with Image.open(path) as im:
                return image_data(im)
        return None

    def generate(self, state, project, action, note):
        reference = self.reference(project)
        if not reference and action!='idle':
            raise ValueError('先定稿待机，建立统一的角色母版')
        job = self.enqueue({
            'prompt':generation_prompt(project, action, note), 'action':action, 'kind':'sheet',
            'layout':{'cols':4,'rows':2,'count':8}, 'reference':reference, 'from_text':not reference,
            'character_context':{'id':project['id'],'spec_version':project['spec']['version']},
        })
        state['attempts'].setdefault(action,[]).append(job['id'])
        state['pending'] = job['id']
        state['error'] = ''

    def job_action(self, state, project, action, jid, strict=True):
        job = self.jobs.get(jid)
        if jid not in state['attempts'].get(action,[]) or not job or job['status']!='completed':
            raise ValueError('请选择已经完成的这个动作版本')
        return fit_sheet(project,action,self.artifact(job),job['prompt'],strict)

    def accept(self, state, project, action, clip, index, jid=None):
        if action not in state['accepted'] and action!=self.next_action(state):
            raise ValueError('请按动作顺序确认')
        if not isinstance(clip,dict) or not isinstance(clip.get('recipe'),dict):
            raise ValueError('动作版本无效')
        recipe = clip['recipe']
        spec = project['spec']
        if recipe['frameSize']!=spec['frameSize'] or recipe['pivot']!=spec['pivot']:
            raise ValueError('动作画布或锚点与角色规格不一致')
        frames = render_action(clip)
        if len(frames)<2:
            raise ValueError('请选择可播放的动作版本，至少两帧')
        if action=='idle':
            if type(index) is not int or not 0<=index<len(frames):
                raise ValueError('请选择待机母版帧')
            master = image_data(frames[index])
            if project.get('master')!=master:
                spec['version']+=1
                state['accepted'] = {k:v for k,v in state['accepted'].items() if k=='idle'}
                state['attempts'] = {k:v for k,v in state['attempts'].items() if k=='idle'}
                state['pending']=None
            project['master'] = master
            project['masterBasis'] = {'action':'idle','frame':index}
        project['actions'][action] = {**clip,'label':STEPS[action][0]}
        saved = self.projects.save(project,project['id'],project['revision'])
        state['accepted'][action]={'job':jid,'source':'auto' if state['running'] else 'manual'}
        pending=self.jobs.get(state['pending'])
        if pending and pending['action']==action:
            state['pending']=None
        state['error']=''
        state['export']=None
        return saved

    def package(self, state, project):
        if state['export']:
            return project
        if self.next_action(state):
            raise ValueError('先完成全部八个动作')
        chosen={k:project['actions'][k] for k in STEPS}
        spec=project['spec']
        colors=palette_for((im for a in chosen.values() for im in render_action(a)),spec.get('paletteLimit',64))
        if spec['palette']!=colors or not spec['frozen']:
            spec.update(palette=colors,frozen=True,version=spec['version']+1)
            project=self.projects.save(project,project['id'],project['revision'])
        export_id=uuid.uuid4().hex
        export_character({**project,'actions':chosen},self.root.parent/'exports'/export_id)
        state['export']='/export/'+export_id+'/assets.zip'
        state['running']=False
        return project

    def edit(self, state, project, action, data):
        jid=data.get('job')
        if jid:
            return self.job_action(state,project,action,jid,strict=False)
        key=data.get('existing')
        if isinstance(key,str) and (key==action or key.startswith(action+'_v')) and key in project['actions']:
            return project['actions'][key]
        raise ValueError('请选择动作版本')

    def command(self, data):
        pid=data['id']
        op=data.get('op')
        with self.guard:
            project=self.projects.get(pid)
            state=self.read(pid)
            if op=='pause':
                state['running']=False
            elif op=='guided':
                state.update(mode='guided',running=False)
            elif op in ('start','resume'):
                if data.get('reference'):
                    reference=decode_image(data['reference'])
                    reference.thumbnail((1536,1536),Image.Resampling.NEAREST)
                    reference.save(self.root/(pid+'.png'))
                if not self.reference(project):
                    raise ValueError('托管模式需要上传一张角色参考图')
                job=self.jobs.get(state['pending'])
                if state['error'] or job and job['status']=='failed':
                    state['pending']=None
                state.update(mode='managed',running=True,error='')
            elif op=='reference':
                reference=decode_image(data.get('reference'))
                reference.thumbnail((1536,1536),Image.Resampling.NEAREST)
                reference.save(self.root/(pid+'.png'))
            elif op=='export':
                project=self.package(state,project)
            else:
                action=data.get('action')
                if action not in STEPS:
                    raise ValueError('无效动作')
                if op=='generate':
                    if state['running']:
                        raise ValueError('先暂停托管再重新生成')
                    if action!=self.next_action(state) and action not in state['accepted']:
                        raise ValueError('请按动作顺序制作')
                    note=str(data.get('note',''))[:1400]
                    self.generate(state,project,action,note)
                elif op=='preview':
                    return {'clip':self.edit(state,project,action,data)}
                elif op=='edit':
                    state['running']=False
                    self.save(state)
                    return {'clip':self.edit(state,project,action,data), 'state':self.summary(state,project)}
                elif op=='accept':
                    if state['running']:
                        raise ValueError('先暂停托管再确认版本')
                    if data.get('revision') != project['revision']:
                        raise ValueError('工程已更新，请重新打开该版本')
                    clip=data.get('clip')
                    if clip is None:
                        clip=self.edit(state,project,action,data)
                    project=self.accept(state,project,action,clip,data.get('frame',0),data.get('job'))
                else:
                    raise ValueError('无效操作')
            self.save(state)
            return self.summary(state,project)

    def tick(self):
        for path in sorted(self.root.glob('*.json')):
            with self.guard:
                try:
                    state=json.loads(path.read_text())
                except (ValueError,OSError):
                    continue
                if not state['running']:
                    continue
                try:
                    project=self.projects.get(state['id'])
                    action=self.next_action(state)
                    job=self.jobs.get(state['pending'])
                    if job and job['status'] in ('running','queued'):
                        continue
                    if not action:
                        self.package(state,project)
                    elif job and job['status']=='completed' and job['action']==action:
                        if not job.get('finished_at') or time.time()-job['finished_at'] < REVIEW_SECONDS:
                            continue
                        clip=self.job_action(state,project,action,job['id'])
                        self.accept(state,project,action,clip,0,job['id'])
                    elif job and job['status']=='failed':
                        raise ValueError(job.get('error') or '生成失败')
                    elif not self.busy():
                        self.generate(state,project,action,'')
                    else:
                        continue
                except Exception as error:
                    state.update(running=False,error=str(error))
                self.save(state)
