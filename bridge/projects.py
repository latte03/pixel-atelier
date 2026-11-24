"""Local character projects: atomic revisions, whole-pose recipes and shared palette."""
import base64,copy,io,json,math,re,threading,time,uuid,zipfile
from pathlib import Path
from PIL import Image
try:from .editor import decode_image,export_animation,validate_events,open_gif
except ImportError:from editor import decode_image,export_animation,validate_events,open_gif
GUARD=threading.RLock()
ARCHER_TEMPLATE=Path(__file__).resolve().parents[1]/'templates'/'seven-direction-archer.json'
class Conflict(ValueError):pass

def image_data(im):
    b=io.BytesIO();im.save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()

def palette_for(images,count=64):
    pixels=[]
    for im in images:
        # Bounded, deterministic sampling across every action.
        step=max(1,im.width*im.height//12000)
        pixels.extend(p[:3]for p in list(im.getdata())[::step]if p[3]>=220)
    if not pixels:raise ValueError('没有可见像素，无法冻结色板')
    im=Image.new('RGB',(len(pixels),1));im.putdata(pixels);q=im.quantize(colors=count,method=Image.Quantize.MEDIANCUT);pal=q.getpalette()
    return list(dict.fromkeys('#%02x%02x%02x'%tuple(pal[i*3:i*3+3])for i in sorted(set(q.getdata()))))

def validate(p):
    if not isinstance(p,dict)or p.get('format')!='pixel-atelier-character/1':raise ValueError('请选择角色工程JSON')
    if not isinstance(p.get('name'),str)or not 1<=len(p['name'])<=80:raise ValueError('工程名称须为1至80字')
    spec=p.get('spec',{});n=spec.get('frameSize');pivot=spec.get('pivot')
    if type(n)is not int or n not in [128,160,192,224,256,320]:raise ValueError('工程画布尺寸无效')
    if not isinstance(pivot,list)or len(pivot)!=2 or any(type(v)is not int or not 0<=v<n for v in pivot):raise ValueError('工程锚点无效')
    if spec.get('paletteLimit',64)not in [32,64,128,255]:raise ValueError('角色色板数量无效')
    pal=spec.get('palette',[])
    if not isinstance(pal,list)or len(pal)>255 or any(not isinstance(c,str)or not re.fullmatch('#[0-9a-fA-F]{6}',c)for c in pal):raise ValueError('工程色板无效')
    if spec.get('frozen')and not pal:raise ValueError('冻结规格必须包含色板')
    for key in ['identity','weapon','style']:
        if not isinstance(spec.get(key,''),str)or len(spec.get(key,''))>1500:raise ValueError('角色规格描述过长')
    actions=p.get('actions',{})
    if not isinstance(actions,dict)or len(actions)>16:raise ValueError('最多保存16个动作')
    for aid,a in actions.items():
        if not re.fullmatch('[a-z][a-z0-9_-]{0,29}',aid):raise ValueError('动作ID无效')
        if not isinstance(a,dict)or not isinstance(a.get('source'),str):raise ValueError('动作缺少源图')
        label=a.get('label',aid)
        if not isinstance(label,str)or not 1<=len(label.strip())<=80:raise ValueError('动作名称须为1至80字')
        draft=a.get('draft',False)
        if type(draft)is not bool:raise ValueError('动作草稿标记无效')
        if draft:
            if a['source'] or a.get('recipe') or a.get('overrides'):raise ValueError('草稿动作不能包含帧数据')
            if not isinstance(a.get('prompt',''),str)or len(a.get('prompt',''))>6000:raise ValueError('动作提示词无效')
            continue
        r=a.get('recipe',{});c=r.get('cols');rows=r.get('rows');count=r.get('count');fs=r.get('frameSize')
        if any(type(v)is not int for v in [c,rows,count,fs])or not 1<=c<=8 or not 1<=rows<=8 or not 1<=count<=min(64,c*rows)or fs not in [128,160,192,224,256,320]:raise ValueError('动作排版无效')
        if type(r.get('scale'))not in [int,float]or not math.isfinite(r['scale'])or not 0<r['scale']<=8:raise ValueError('动作缩放无效')
        for pair in [r.get('baseOffset'),r.get('pivot')]+r.get('offsets',[]):
            if not isinstance(pair,list)or len(pair)!=2 or any(type(v)is not int or abs(v)>20000 for v in pair):raise ValueError('动作偏移无效')
        if len(r.get('offsets',[]))!=count or len(r.get('durations',[]))!=count or any(type(t)is not int or not 10<=t<=2000 or t%10 for t in r['durations']):raise ValueError('动作时长或偏移数量无效')
        validate_events(r.get('events', {}), count)
        overrides=a.get('overrides',{})
        if not isinstance(overrides,dict)or any(not str(i).isdigit()or not 0<=int(i)<count for i in overrides):raise ValueError('替换帧索引无效')
    basis = p.get('masterBasis')
    if basis is not None:
        if not isinstance(basis, dict) or not isinstance(basis.get('action'), str):
            raise ValueError('待机母版来源无效')
        action = basis['action']
        frame = basis.get('frame')
        if (not re.fullmatch(r'idle(?:_v[0-9]+)?', action) or action not in actions
                or type(frame) is not int or not 0 <= frame < actions[action]['recipe']['count']
                or not isinstance(p.get('master'), str) or not p['master']):
            raise ValueError('待机母版须关联工程中的有效待机帧')
    return p

def render_action(a):
    if a.get('draft'):raise ValueError('动作尚未保存帧')
    im=decode_image(a['source']);r=a['recipe'];fs=r['frameSize'];out=[]
    for i in range(r['count']):
        override=a.get('overrides',{}).get(str(i))
        if override:
            frame=decode_image(override)
            if frame.size!=(fs,fs):raise ValueError('替换帧必须与原生画布同尺寸')
            ox,oy=r['offsets'][i];b=frame.getchannel('A').point(lambda a:255 if a>=220 else 0).getbbox()
            if not b or ox+b[0]<0 or oy+b[1]<0 or ox+b[2]>fs or oy+b[3]>fs:raise ValueError('替换帧空白或超出画布')
            shifted=Image.new('RGBA',(fs,fs));shifted.paste(frame,(ox,oy));frame=shifted
        else:
            c=r['cols'];rows=r['rows'];x=round(i%c*im.width/c);y=round(i//c*im.height/rows);right=round((i%c+1)*im.width/c);bottom=round((i//c+1)*im.height/rows)
            pose=im.crop((x,y,right,bottom));sz=(round(pose.width*r['scale']),round(pose.height*r['scale']))
            if min(sz)<1 or max(sz)>8000:raise ValueError('采样尺寸无效')
            pose=pose.resize(sz,Image.Resampling.NEAREST);ox=round(r['baseOffset'][0]+r['offsets'][i][0]);oy=round(r['baseOffset'][1]+r['offsets'][i][1]);b=pose.getchannel('A').point(lambda a:255 if a>=220 else 0).getbbox()
            if not b:raise ValueError('第%d帧没有可见主体'%(i+1))
            if ox+b[0]<0 or oy+b[1]<0 or ox+b[2]>fs or oy+b[3]>fs:raise ValueError('第%d帧超出画布'%(i+1))
            frame=Image.new('RGBA',(fs,fs));frame.paste(pose,(ox,oy))
        out.append(frame)
    return out

class ProjectStore:
    def __init__(self,root):self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
    def path(self,pid):
        if not isinstance(pid,str)or not re.fullmatch('[a-f0-9]{32}',pid):raise ValueError('工程ID无效')
        return self.root/pid/'project.json'
    def get(self,pid):return json.loads(self.path(pid).read_text())
    def list(self):
        return sorted([{'id':p['id'],'name':p['name'],'revision':p['revision'],'updated_at':p['updated_at'],'actions':len(p['actions']),'parent_id':p.get('parent_id'),'frozen':p['spec'].get('frozen',False)}for p in [json.loads(f.read_text())for f in self.root.glob('*/project.json')]],key=lambda p:p['updated_at'],reverse=True)
    def save(self,data,pid=None,expected=None):
        p=copy.deepcopy(validate(data))
        with GUARD:
            old=self.get(pid)if pid else None
            if old and old['revision']!=expected:raise Conflict('工程已被其他页面更新；请先下载本地副本，再重新打开工程，避免覆盖。')
            pid=pid or uuid.uuid4().hex;path=self.path(pid);path.parent.mkdir(exist_ok=True)
            if old:
                history=path.parent/'history';history.mkdir(exist_ok=True);(history/('%06d.json'%old['revision'])).write_text(json.dumps(old,ensure_ascii=False))
            p.update(id=pid,revision=(old['revision']+1 if old else 1),updated_at=time.time());p['created_at']=old.get('created_at')if old else time.time()
            tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(p,ensure_ascii=False));tmp.replace(path)
            return p

def save_idle_gif(project, store, data):
    """Fit a GIF with one shared transform and preserve its timed playback."""
    spec = project['spec']
    size = spec['frameSize']
    pivot = spec['pivot']
    selected = data.get('index')
    with open_gif(data.get('image')) as gif:
        if type(selected) is not int or not 0 <= selected < gif.n_frames:
            raise ValueError('请选择待机参考帧')
        extents = []
        for i in range(gif.n_frames):
            gif.seek(i)
            extent = gif.convert('RGBA').getchannel('A').getbbox()
            if extent:
                extents.append(extent)
        if not extents:
            raise ValueError('GIF 没有可见角色')
        left, top = (min(b[k] for b in extents) for k in (0, 1))
        right, bottom = (max(b[k] for b in extents) for k in (2, 3))
        width, height = right - left, bottom - top
        scale = min(1, 2 * (min(pivot[0], size - pivot[0]) - 2) / width, (pivot[1] - 2) / height)
        if scale <= 0:
            raise ValueError('当前锚点没有足够空间，请先调整角色规格')
        dimensions = [max(1, round(value * scale)) for value in (width, height)]
        position = (pivot[0] - dimensions[0] // 2, pivot[1] - dimensions[1])
        frames, durations = [], []
        reference_index = None
        last = None
        loop = 'loop' in gif.info
        for i in range(gif.n_frames):
            gif.seek(i)
            pose = gif.convert('RGBA').crop((left, top, right, bottom)).resize(dimensions, Image.Resampling.NEAREST)
            if not pose.getchannel('A').getbbox():
                raise ValueError(f'GIF 第 {i+1} 帧在画布上为空，请先清理空白帧或放大工程画布')
            duration = gif.info.get('duration', 0) or 100
            pixels = pose.tobytes()
            if pixels == last and durations[-1] < 2000:
                extra = min(2000 - durations[-1], duration)
                durations[-1] += extra
                duration -= extra
            if i == selected and not duration:
                reference_index = len(frames) - 1
            while duration:
                if len(frames) >= 64:
                    raise ValueError('待机超过 64 个可编辑帧，请先精简关键姿势')
                if i == selected and (reference_index is None or pixels != last):
                    reference_index = len(frames)
                frame = Image.new('RGBA', (size, size))
                frame.paste(pose, position)
                frames.append(frame)
                durations.append(min(duration, 2000))
                duration -= durations[-1]
                last = pixels
    columns = min(8, len(frames))
    rows = (len(frames) + columns - 1) // columns
    atlas = Image.new('RGBA', (columns * size, rows * size))
    for i, frame in enumerate(frames):
        atlas.paste(frame, ((i % columns) * size, (i // columns) * size))
    action_id, label = 'idle', '待机'
    version = 2
    while action_id in project['actions']:
        action_id, label = f'idle_v{version}', f'待机 · v{version}'
        version += 1
    project['actions'][action_id] = {
        'label': label, 'source': image_data(atlas), 'prompt': '', 'review': 'pending', 'overrides': {},
        'recipe': {
            'cols': columns, 'rows': rows, 'count': len(frames), 'frameSize': size,
            'scale': 1, 'baseOffset': [0, 0], 'offsets': [[0, 0] for _ in frames],
            'durations': durations, 'pivot': pivot, 'colors': spec.get('paletteLimit', 64),
            'previewScale': 2, 'loop': loop,
        },
    }
    saved = store.save(project, project['id'], data['expected_revision'])
    return {'project': saved, 'action': action_id, 'reference_index': reference_index}


def create_archer_template(name=None):
    p=json.loads(ARCHER_TEMPLATE.read_text())
    validate(p)
    if name is not None and str(name).strip():p['name']=str(name).strip()[:80]
    return p


def create_from_master(data):
    """Prepare a complete initial project before committing it to the store."""
    name = data.get('name')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise ValueError('请填写 1 至 80 字的角色名字')
    name = name.strip()
    profile = data.get('profile', 'custom')
    if profile not in ('custom', 'greatsword', 'bow', 'staff'):
        raise ValueError('请选择有效的角色职业')
    im = decode_image(data['master'])
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] >= 220:
        raise ValueError('请上传带透明背景的角色 PNG')
    extent = alpha.point(lambda a: 255 if a >= 220 else 0).getbbox()
    if extent is None:
        raise ValueError('图片中没有可见角色')
    left, top, right, bottom = extent
    width, height = right - left, bottom - top
    padding = 2
    pose = im.crop((left - padding, top - padding, right + padding, bottom + padding))
    size, colors = 224, 64
    pivot = [size // 2, size - 16]
    scale = min(1, (size - 28) / max(width, height))
    offset = [
        round((size - width * scale) / 2 - padding * scale),
        pivot[1] - round((height + padding) * scale),
    ]
    action = {
        'label': '待机母版 · 单帧',
        'source': image_data(pose),
        'prompt': '原地待机，保持母版人物、装备与像素比例。',
        'review': 'pending',
        'overrides': {},
        'recipe': {
            'cols': 1, 'rows': 1, 'count': 1, 'frameSize': size, 'scale': scale,
            'baseOffset': offset,
            'pivot': pivot, 'offsets': [[0, 0]], 'durations': [100],
            'colors': colors, 'previewScale': 4, 'loop': True,
        },
    }
    rendered = render_action(action)[0]
    colors_used = palette_for([rendered.crop(rendered.getbbox())], colors)
    return {
        'format': 'pixel-atelier-character/1', 'name': name, 'master': data['master'],
        'spec': {
            'frameSize': size, 'pivot': pivot, 'paletteLimit': colors,
            'palette': colors_used, 'frozen': True, 'version': 1,
            'profile': profile, 'identity': '沿用参考图的人物比例、五官、服装与配色',
            'weapon': data.get('weapon') or '保持参考图的装备、结构与握持方式',
            'style': '完整人物像素逐帧，硬边、统一色板、透明背景',
        },
        'actions': {'idle': action},
    }


def create_knight(example_dir):
    example_dir = Path(example_dir)
    manifest = example_dir/'manifest.json'
    if not manifest.is_file():
        raise ValueError('缺少女骑士示例文件，请重新下载完整仓库')
    examples = json.loads(manifest.read_text())
    size, pivot = 224, [112, 196]
    actions, images = {}, []
    for example in examples:
        action_id = example['id']
        with Image.open(example_dir/action_id/'atlas.png') as source:
            atlas = source.convert('RGBA')
        images.append(atlas)
        frames = example['frames']
        actions[action_id] = {
            'label': example['name'], 'source': image_data(atlas), 'prompt': '',
            'review': 'pending', 'overrides': {},
            'recipe': {
                'cols': example['cols'], 'rows': example['rows'], 'count': example['count'],
                'frameSize': size, 'scale': 1, 'pivot': pivot,
                'baseOffset': [x-y for x,y in zip(pivot, example['pivot'])],
                'offsets': [[0,0] for _ in frames], 'durations': [f['duration_ms'] for f in frames],
                'colors': 64, 'previewScale': 2, 'loop': True,
            },
        }
    master = image_data(render_action(actions['idle'])[0])
    return {
        'format': 'pixel-atelier-character/1', 'name': '女骑士 · 我的角色工程',
        'template_origin': 'local-knight-v1', 'master': master, 'actions': actions,
        'masterBasis': {'action': 'idle', 'frame': 0},
        'spec': {
            'frameSize': size, 'pivot': pivot, 'paletteLimit': 64, 'palette': palette_for(images),
            'frozen': True, 'version': 1, 'profile': 'greatsword',
            'identity': '金发、深蓝发带、银色与深蓝盔甲、红色腰布，保持参考图头身比例',
            'weapon': '双手特大巨剑，剑柄笔直，保持刀身长度、宽度和握持位置',
            'style': '完整人物像素逐帧，硬边、有限色板、透明背景',
        },
    }


def export_character(p,folder):
    validate(p);spec=p['spec']
    if not spec.get('frozen'):raise ValueError('请先冻结角色规格与色板')
    actions={aid:a for aid,a in p['actions'].items()if not a.get('draft')}
    if not actions:raise ValueError('工程没有可导出的动作')
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=False);manifest={'name':p['name'],'spec':spec,'review':'pending','actions':{}}
    for aid,a in actions.items():
        r=a['recipe']
        if r['frameSize']!=spec['frameSize']or r['pivot']!=spec['pivot']:raise ValueError(aid+'的画布或锚点与冻结规格不一致，请先校准')
        frames=render_action(a)
        conf=export_animation({'name':a.get('label',aid),'frames':[{'image':image_data(im),'duration_ms':r['durations'][i],'offset':r['offsets'][i]}for i,im in enumerate(frames)],'pivot':spec['pivot'],'colors':64,'fixed_palette':spec['palette'],'preview_scale':r.get('previewScale',2),'loop':r.get('loop',True),'recipe':r,'source':a['source']},folder/aid)
        manifest['actions'][aid]={'path':aid+'/animation.json','duration_ms':conf['duration_ms'],'frame_count':len(frames),'technical':conf['technical']}
    (folder/'character.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(folder/'project.json').write_text(json.dumps(p,ensure_ascii=False))
    with zipfile.ZipFile(folder/'assets.zip','w',zipfile.ZIP_DEFLATED)as z:
        for f in folder.rglob('*'):
            if f.is_file()and f.name!='assets.zip':z.write(f,str(f.relative_to(folder)))
    return manifest
