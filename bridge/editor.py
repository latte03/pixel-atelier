"""Transparent animation export, independent of model generation."""
import base64,io,json,zipfile,re
from pathlib import Path
from PIL import Image
try:
    from spritepipe.core import map_palette,indexed
except ImportError:
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from spritepipe.core import map_palette,indexed


def decode_image(value):
    if not isinstance(value,str) or len(value)>22_000_000:raise ValueError('图片为空或过大')
    raw=base64.b64decode(value.split(',',1)[-1],validate=True)
    with Image.open(io.BytesIO(raw)) as im:
        if im.format not in ['PNG','JPEG'] or im.width*im.height>16_000_000:raise ValueError('请选择不超过1600万像素的PNG或JPG')
        return im.convert('RGBA').copy()


def open_gif(value):
    if not isinstance(value, str) or len(value) > 16_800_000:
        raise ValueError('请选择 12 MB 以内的 GIF')
    raw = base64.b64decode(value.split(',', 1)[-1], validate=True)
    im = Image.open(io.BytesIO(raw))
    if im.format != 'GIF':
        im.close()
        raise ValueError('请选择 GIF 文件')
    pixels = im.width * im.height
    if pixels > 4_194_304 or im.n_frames > 900 or pixels * im.n_frames > 120_000_000:
        im.close()
        raise ValueError('GIF 过大或过长，请截取一小段待机动作')
    return im


def gif_reference_frames(value):
    """Return representative fully composited poses at the original frame indices."""
    with open_gif(value) as im:
        count = im.n_frames
        sample_count = min(12, count)
        indices = {round(i * (count - 1) / max(1, sample_count - 1)) for i in range(sample_count)}
        divisor = max(1, (max(im.size) + 1023) // 1024)
        frames = []
        for i in sorted(indices):
            im.seek(i)
            pose = im.convert('RGBA')
            if not pose.getchannel('A').getbbox():
                continue
            if divisor > 1:
                size = tuple(max(1, dimension // divisor) for dimension in pose.size)
                pose = pose.resize(size, Image.Resampling.NEAREST)
            result = io.BytesIO()
            pose.save(result, format='PNG')
            frames.append({
                'index': i, 'image': 'data:image/png;base64,' + base64.b64encode(result.getvalue()).decode(),
            })
        if not frames:
            raise ValueError('选取的 GIF 帧中没有可见角色，请检查画面')
        return {'count': count, 'frames': frames}


EVENT_TYPES = ('strikes', 'releases')


def validate_events(events, frame_count):
    if not isinstance(events, dict) or events.keys() - set(EVENT_TYPES):
        raise ValueError('动作事件支持 strikes 与 releases')
    result = {}
    for kind, indices in events.items():
        if not isinstance(indices, list) or any(type(i) is not int or not 0 <= i < frame_count for i in indices):
            raise ValueError('动作事件必须引用有效的零起始帧索引')
        if len(set(indices)) != len(indices):
            raise ValueError('同类动作事件不能重复标在同一帧')
        if indices:
            result[kind] = sorted(indices)
    return result


def export_animation(payload,folder):
    rows=payload.get('frames',[])
    if not isinstance(rows,list) or not 1<=len(rows)<=64:raise ValueError('请准备1至64帧动画')
    recipe = payload.get('recipe', {})
    if not isinstance(recipe, dict):
        raise ValueError('动作配方必须是对象')
    events = validate_events(recipe.get('events', {}), len(rows))
    frames=[];durations=[];records=[];start=0;size=None
    pivot=payload.get('pivot',[80,144])
    if not isinstance(pivot,list) or len(pivot)!=2 or not all(type(x)is int for x in pivot):raise ValueError('锚点必须是两个整数')
    for i,row in enumerate(rows):
        im=decode_image(row.get('image'))
        if im.width!=im.height or not 32<=im.width<=512:raise ValueError('原生帧应为32至512像素的正方形')
        if size and size!=im.size:raise ValueError('所有原生帧尺寸必须一致')
        size=im.size
        if not all(0<=x<size[k] for k,x in enumerate(pivot)):raise ValueError('锚点须位于画布内')
        duration=row.get('duration_ms',100)
        if type(duration)is not int or duration<10 or duration>2000 or duration%10:raise ValueError('帧时长应为10至2000ms，按10ms递增')
        frames.append(im);durations.append(duration)
        offset=row.get('offset',[0,0])
        if not isinstance(offset,list) or len(offset)!=2 or not all(type(x)is int for x in offset):raise ValueError('整帧偏移必须是两个整数')
        records.append({'index':i,'file':'frames/%02d.png'%i,'start_ms':start,'duration_ms':duration,'pivot':pivot,'root_motion':[0,0],'whole_frame_offset':offset,'rect':[i%4*size[0],i//4*size[1],*size]});start+=duration
    if len(frames)*size[0]*size[1]>6_600_000:raise ValueError('总像素过多，请减少帧数或原生尺寸')
    count=payload.get('colors',64)
    if count not in [32,64,128,255]:raise ValueError('请选择32、64、128或255色色板')
    fixed=payload.get('fixed_palette')
    if fixed is not None:
        if not isinstance(fixed,list)or not 1<=len(fixed)<=255 or any(not isinstance(c,str)or not re.fullmatch('#[0-9a-fA-F]{6}',c)for c in fixed):raise ValueError('冻结色板无效')
        colors=[tuple(bytes.fromhex(c[1:]))for c in fixed]
    else:
        # A single palette is derived from opaque pixels of the entire clip.
        samples=[]
        for im in frames:
            samples.extend(p[:3] for p in im.getdata() if p[3]>=220)
        if not samples:raise ValueError('动画没有可见主体')
        if len(samples)>180000:samples=samples[::max(1,len(samples)//180000)]
        palette_input=Image.new('RGB',(len(samples),1));palette_input.putdata(samples)
        q=palette_input.quantize(colors=count,method=Image.Quantize.MEDIANCUT);palette=q.getpalette()
        colors=list(dict.fromkeys(tuple(palette[i*3:i*3+3]) for i in sorted(set(q.getdata()))))
    frames=[map_palette(im,colors,220) for im in frames]
    warnings = []
    for i, im in enumerate(frames):
        alpha = im.getchannel('A')
        extent = alpha.getbbox()
        if extent is None:
            raise ValueError(f'第 {i+1} 帧是空白帧，请检查切帧范围')
        if alpha.getextrema()[0] != 0:
            warnings.append({'index': i, 'code': 'no_transparency'})
        elif extent[0] == 0 or extent[1] == 0 or extent[2] == im.width or extent[3] == im.height:
            warnings.append({'index': i, 'code': 'touches_canvas_edge'})
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=False);(folder/'frames').mkdir()
    for im,f in zip(frames,records):im.save(folder/f['file'])
    w,h=size;atlas=Image.new('RGBA',(w*4,h*((len(frames)+3)//4)),(0,0,0,0))
    for im,f in zip(frames,records):atlas.paste(im,tuple(f['rect'][:2]))
    atlas.save(folder/'atlas.png')
    preview_scale=payload.get('preview_scale',4)
    if type(preview_scale)is not int or not 1<=preview_scale<=4:raise ValueError('预览倍率应为1至4')
    gif=[indexed(im.resize((w*preview_scale,h*preview_scale),Image.Resampling.NEAREST),colors) for im in frames]
    kwargs={'save_all':True,'append_images':gif[1:],'duration':durations,'transparency':0,'disposal':2,'optimize':False}
    if payload.get('loop',True):kwargs['loop']=0
    gif[0].save(folder/'preview.gif',**kwargs)
    conf={'label':str(payload.get('name','角色动作'))[:80],'frame_size':[w,h],'pivot':pivot,'frames':records,'duration_ms':start,'whole_character':True,'parts_assembly':False,'weapon_assembly':False,'loop_preview':bool(payload.get('loop',True)),'palette':['#%02x%02x%02x'%c for c in colors],'preview_scale':preview_scale,'review':{'visual':'pending','engine':'pending','user':'pending'},'recipe':payload.get('recipe',{})}
    conf['events'] = events
    conf['event_timeline'] = [
        {'type': kind, 'index': f['index'], 'start_ms': f['start_ms']}
        for f in records for kind in EVENT_TYPES if f['index'] in events.get(kind, ())
    ]
    conf['technical'] = {'status': 'warnings' if warnings else 'passed', 'warnings': warnings}
    (folder/'animation.json').write_text(json.dumps(conf,ensure_ascii=False,indent=2))
    (folder/'palette.json').write_text(json.dumps(conf['palette']))
    if payload.get('source'):decode_image(payload['source']).save(folder/'source.png')
    with zipfile.ZipFile(folder/'assets.zip','w',zipfile.ZIP_DEFLATED)as z:
        for f in folder.rglob('*'):
            if f.is_file()and f.name!='assets.zip':z.write(f,str(f.relative_to(folder)))
    return conf
