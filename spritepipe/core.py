"""Portable whole-frame processing. No model API, network calls or body-part assembly."""
import hashlib
import html
import json
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageSequence


class PipelineError(ValueError):
    pass


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def local_path(root, name):
    if not isinstance(name, str) or not name or Path(name).is_absolute():
        raise PipelineError("Asset paths must be nonempty project-relative paths.")
    root = Path(root).resolve()
    path = (root / name).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise PipelineError("Asset path escapes project directory: " + name)
    return path


def positive_int(v):
    return type(v) is int and v > 0


def pair(v, positive=False):
    return isinstance(v, list) and len(v) == 2 and all(type(x) is int and (not positive or x > 0) for x in v)


def load_profile(root):
    root = Path(root).resolve()
    try:
        profile = json.loads((root / "profile.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise PipelineError("Cannot read profile.json: " + str(e))
    if not isinstance(profile, dict) or profile.get("schema_version") != "0.1":
        raise PipelineError("Expected portable profile schema_version 0.1.")
    if profile.get("route") != "whole_character":
        raise PipelineError("This builder requires route=whole_character.")
    palette = profile.get("palette", {})
    if not isinstance(palette, dict):
        raise PipelineError("palette must be an object.")
    if palette.get("status") != "frozen":
        raise PipelineError("Freeze the palette after master review before building.")
    colors = palette.get("colors", [])
    if not isinstance(colors, list) or not 1 <= len(colors) <= 255 or any(not isinstance(c, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in colors):
        raise PipelineError("palette.colors requires 1..255 RGB hex colors; GIF reserves index0 for transparency.")
    if len(set(c.lower() for c in colors)) != len(colors):
        raise PipelineError("Palette colors must be unique.")
    actions = profile.get("actions", {})
    if not isinstance(actions, dict) or not actions:
        raise PipelineError("Specify at least one action.")
    for key, action in actions.items():
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", key) or not isinstance(action, dict):
            raise PipelineError("Action IDs must match [a-z][a-z0-9_-]*.")
        validate_action(root, key, action)
    return profile


def validate_action(root, key, a):
    for name in ["grid", "frame_size"]:
        if not pair(a.get(name), positive=True):
            raise PipelineError(key + ": " + name + " needs two positive integers.")
    w, h = a["frame_size"]
    if not pair(a.get("pivot")) or not (0 <= a["pivot"][0] < w and 0 <= a["pivot"][1] < h):
        raise PipelineError(key + ": pivot must be inside frame_size.")
    durations = a.get("durations_ms")
    if not isinstance(durations, list) or not durations or len(durations) > a["grid"][0] * a["grid"][1] or not all(positive_int(t) and t % 10 == 0 for t in durations):
        raise PipelineError(key + ": durations_ms must cover 1..grid cells, positive multiples of10ms for exact GIF timing.")
    scale = a.get("source_scale")
    if type(scale) not in (int, float) or not 0 < scale <= 16:
        raise PipelineError(key + ": source_scale must be a fixed positive number <=16.")
    offsets = a.get("offsets")
    if not isinstance(offsets, list) or len(offsets) != len(durations) or not all(pair(x) for x in offsets):
        raise PipelineError(key + ": provide one integer [x,y] offset per whole pose.")
    if type(a.get("safety_margin_px", 1)) is not int or not 0 <= a.get("safety_margin_px", 1) < min(w, h) / 2:
        raise PipelineError(key + ": invalid safety_margin_px.")
    if type(a.get("alpha_threshold", 220)) is not int or not 1 <= a.get("alpha_threshold", 220) <= 255:
        raise PipelineError(key + ": alpha_threshold must be1..255.")
    if type(a.get("preview_scale", 4)) is not int or not 1 <= a.get("preview_scale", 4) <= 16:
        raise PipelineError(key + ": preview_scale must be an integer1..16.")
    if not isinstance(a.get("events", {}), dict):
        raise PipelineError(key + ": events must be an object.")
    strikes = a.get("events", {}).get("strikes", [])
    if not isinstance(strikes, list):
        raise PipelineError(key + ": events.strikes must be a list.")
    for name in ["loop_preview", "loop_runtime", "boundary_equal"]:
        if name in a and type(a[name]) is not bool:
            raise PipelineError(key + ": " + name + " must be a boolean.")
    for n in strikes:
        if type(n) is not int or not 0 <= n < len(durations):
            raise PipelineError(key + ": strikes uses zero-based frame indices.")
    local_path(root, a.get("source"))


def palette_rgb(profile):
    return [tuple(bytes.fromhex(c[1:])) for c in profile["palette"]["colors"]]


def map_palette(image, colors, threshold):
    rgba = image.convert("RGBA")
    cache = {}
    result = []
    for r, g, b, alpha in rgba.getdata():
        if alpha < threshold:
            result.append((0, 0, 0, 0))
            continue
        rgb = (r, g, b)
        if rgb not in cache:
            cache[rgb] = min(colors, key=lambda c: sum((x - y) ** 2 for x, y in zip(c, rgb)))
        result.append(cache[rgb] + (255,))
    rgba.putdata(result)
    return rgba


def canonical(image):
    return bytes(channel for p in image.convert("RGBA").getdata() for channel in (p if p[3] else (0, 0, 0, 0)))


def indexed(image, colors):
    rgb_to_index = {c: i + 1 for i, c in enumerate(colors)}
    p = Image.new("P", image.size, 0)
    flat = [0, 0, 0] + [v for c in colors for v in c]
    p.putpalette(flat + [0] * (768 - len(flat)))
    p.putdata([rgb_to_index[v[:3]] if v[3] else 0 for v in image.convert("RGBA").getdata()])
    p.info["transparency"] = 0
    return p


def build_action(root, key, a, profile, force=False):
    root = Path(root).resolve()
    out = local_path(root, "output/" + key)
    if out.exists() and not force:
        raise PipelineError("Output exists; choose a new project/action version or use --force to archive it: " + key)
    source = local_path(root, a["source"])
    if not source.is_file():
        raise PipelineError("Source PNG missing: " + a["source"])
    with Image.open(source) as img:
        if img.format != "PNG":
            raise PipelineError("Source must be a PNG sheet.")
        sheet = img.convert("RGBA")
    cols, rows = a["grid"]
    if sheet.width < cols or sheet.height < rows:
        raise PipelineError("Source sheet is smaller than grid.")
    colors = palette_rgb(profile)
    frames, records, start = [], [], 0
    for i, duration in enumerate(a["durations_ms"]):
        x, y = i % cols, i // cols
        rect = (round(x * sheet.width / cols), round(y * sheet.height / rows), round((x + 1) * sheet.width / cols), round((y + 1) * sheet.height / rows))
        cell = sheet.crop(rect)
        bbox = cell.getchannel("A").point(lambda v: 255 if v >= a.get("alpha_threshold", 220) else 0).getbbox()
        if bbox is None:
            raise PipelineError(key + ": empty source pose " + str(i))
        if bbox[0] == 0 or bbox[1] == 0 or bbox[2] == cell.width or bbox[3] == cell.height:
            raise PipelineError(key + ": source pose touches its cell edge; repair source clipping before export, frame " + str(i))
        size = tuple(max(1, round(v * a["source_scale"])) for v in cell.size)
        scaled = cell.resize(size, Image.Resampling.NEAREST)
        pose = map_palette(scaled, colors, a.get("alpha_threshold", 220))
        dx, dy = a["offsets"][i]
        visible = pose.getbbox()
        fw, fh = a["frame_size"]
        margin = a.get("safety_margin_px", 1)
        if visible is None or dx + visible[0] < margin or dy + visible[1] < margin or dx + visible[2] > fw - margin or dy + visible[3] > fh - margin:
            raise PipelineError(key + ": visible pose crosses output safety margin, frame " + str(i))
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        canvas.alpha_composite(pose, (dx, dy))
        frames.append(canvas)
        records.append({"index": i, "file": "frames/%02d.png" % i, "duration_ms": duration, "start_ms": start, "pivot": a["pivot"], "root_motion": [0, 0], "whole_frame_offset": [dx, dy], "source_rect": list(rect), "rect": [i % 4 * fw, i // 4 * fh, fw, fh]})
        start += duration
    (root / "output").mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=root / "output"))
    try:
        (stage / "frames").mkdir()
        fw, fh = a["frame_size"]
        atlas = Image.new("RGBA", (fw * 4, fh * ((len(frames) + 3) // 4)), (0, 0, 0, 0))
        for img, record in zip(frames, records):
            img.save(stage / record["file"])
            atlas.paste(img, tuple(record["rect"][:2]))
        atlas.save(stage / "atlas.png")
        pv = a.get("preview_scale", 4)
        gif_frames = [indexed(img.resize((fw * pv, fh * pv), Image.Resampling.NEAREST), colors) for img in frames]
        options = dict(save_all=True, append_images=gif_frames[1:], duration=a["durations_ms"], transparency=0, disposal=2, optimize=False)
        if a.get("loop_preview", True):
            options["loop"] = 0
        gif_frames[0].save(stage / "preview.gif", **options)
        config = {"id": key, "character_revision": profile.get("character_revision"), "weapon_revision": profile.get("weapon_revision"), "whole_character": True, "parts_assembly": False, "weapon_assembly": False, "source": a["source"], "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source_scale": a["source_scale"], "source_grid": a["grid"], "alpha_threshold": a.get("alpha_threshold", 220), "palette": profile["palette"]["colors"], "frame_size": a["frame_size"], "preview_scale": pv, "pivot": a["pivot"], "safety_margin_px": a.get("safety_margin_px", 1), "duration_ms": start, "loop_runtime": a.get("loop_runtime", False), "loop_preview": a.get("loop_preview", True), "boundary_equal": a.get("boundary_equal", False), "events": a.get("events", {}), "frames": records, "review": {"visual": "pending", "engine": "pending", "user": "pending"}}
        write_json(stage / "animation.json", config)
        if out.exists():
            archive = local_path(root, "archive/" + key + "-" + uuid.uuid4().hex[:12])
            archive.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(out), str(archive))
        stage.rename(out)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return config


def check_action(root, key, expected):
    root = Path(root).resolve()
    d = local_path(root, "output/" + key)
    failures = []
    def fail(code, frame=None):
        failures.append({"code": code, **({"frame": frame} if frame is not None else {})})
    try:
        conf = json.loads((d / "animation.json").read_text(encoding="utf-8"))
        profile = json.loads((root / "profile.json").read_text(encoding="utf-8"))
        for field in ["frame_size", "pivot"]:
            if conf.get(field) != expected[field]: fail("manifest_" + field)
        if conf.get("character_revision") != profile.get("character_revision") or conf.get("weapon_revision") != profile.get("weapon_revision"):
            fail("stale_character_or_weapon_revision")
        source = local_path(root, expected["source"])
        if not source.exists() or hashlib.sha256(source.read_bytes()).hexdigest() != conf.get("source_sha256"):
            fail("source_changed_since_build")
        if conf.get("source_scale") != expected["source_scale"]: fail("manifest_source_scale")
        if conf.get("source") != expected["source"] or conf.get("source_grid") != expected["grid"]: fail("manifest_source_layout")
        if conf.get("alpha_threshold") != expected.get("alpha_threshold", 220): fail("manifest_alpha_threshold")
        if conf.get("preview_scale") != expected.get("preview_scale", 4): fail("manifest_preview_scale")
        if conf.get("loop_runtime") != expected.get("loop_runtime", False) or conf.get("loop_preview") != expected.get("loop_preview", True): fail("manifest_loop_policy")
        if conf.get("boundary_equal") != expected.get("boundary_equal", False): fail("manifest_boundary_policy")
        if conf.get("palette") != profile["palette"]["colors"]: fail("manifest_palette")
        if conf.get("events") != expected.get("events", {}): fail("manifest_events")
        if not conf.get("whole_character") or conf.get("parts_assembly") or conf.get("weapon_assembly"): fail("wrong_route")
        fw, fh = expected["frame_size"]
        allowed = set(palette_rgb(profile))
        with Image.open(local_path(d, "atlas.png")) as src: atlas = src.convert("RGBA")
        if atlas.size != (fw * 4, fh * ((len(expected["durations_ms"]) + 3) // 4)): fail("atlas_size")
        records = conf.get("frames", [])
        if len(records) != len(expected["durations_ms"]): fail("frame_count")
        frames, duration_sum = [], 0
        for i, duration in enumerate(expected["durations_ms"]):
            f = records[i]
            if f.get("index") != i: fail("frame_order", i)
            path = local_path(d, f["file"])
            with Image.open(path) as src: image = src.convert("RGBA")
            frames.append(image)
            if image.size != (fw, fh): fail("frame_size", i)
            data = list(image.getdata())
            if any(p[3] not in (0, 255) for p in data): fail("non_binary_alpha", i)
            if not any(p[3] for p in data) or not any(p[3] == 0 for p in data): fail("blank_or_opaque", i)
            if any(p[:3] not in allowed for p in data if p[3]): fail("palette", i)
            bbox, margin = image.getbbox(), expected.get("safety_margin_px", 1)
            if bbox and (bbox[0] < margin or bbox[1] < margin or bbox[2] > fw - margin or bbox[3] > fh - margin): fail("output_clipping", i)
            if f.get("pivot") != expected["pivot"] or f.get("root_motion") != [0, 0]: fail("pivot_or_root_motion", i)
            if f.get("whole_frame_offset") != expected["offsets"][i]: fail("manifest_offset", i)
            if f.get("duration_ms") != duration or f.get("start_ms") != duration_sum: fail("frame_timing", i)
            expected_rect = [i % 4 * fw, i // 4 * fh, fw, fh]
            if f.get("rect") != expected_rect: fail("atlas_rect", i)
            x, y, w, h = expected_rect
            if canonical(atlas.crop((x, y, x + w, y + h))) != canonical(image): fail("atlas_pixels", i)
            duration_sum += duration
        if conf.get("duration_ms") != duration_sum: fail("total_duration")
        if expected.get("boundary_equal", False) and canonical(frames[0]) != canonical(frames[-1]): fail("loop_boundary")
        pv = expected.get("preview_scale", 4)
        with Image.open(local_path(d, "preview.gif")) as gif:
            if gif.size != (fw * pv, fh * pv): fail("gif_size")
            if expected.get("loop_preview", True) and gif.info.get("loop") != 0: fail("gif_loop")
            if not expected.get("loop_preview", True) and "loop" in gif.info: fail("gif_loop")
            decoded = [(f.convert("RGBA").copy(), f.info.get("duration", 0)) for f in ImageSequence.Iterator(gif)]
        expected_timeline = []
        for frame, duration in zip(frames, expected["durations_ms"]):
            expected_timeline.extend([hashlib.sha256(canonical(frame.resize((fw * pv, fh * pv), Image.Resampling.NEAREST))).digest()] * (duration // 10))
        actual_timeline = []
        for frame, duration in decoded:
            if not positive_int(duration) or duration % 10: fail("gif_timing")
            actual_timeline.extend([hashlib.sha256(canonical(frame)).digest()] * (duration // 10))
        if actual_timeline != expected_timeline: fail("gif_pixels_timing_or_disposal")
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
        fail("unreadable_artifact: " + str(e))
    return {"action": key, "status": "PASS" if not failures else "FAIL", "errors": failures, "visual_review": "pending", "engine_review": "pending", "user_signoff": "pending"}


def render_gallery(root, profile):
    root = Path(root).resolve()
    cards, data = [], {}
    for key, a in profile["actions"].items():
        path = root / "output" / key / "animation.json"
        if not path.exists(): continue
        conf = json.loads(path.read_text(encoding="utf-8"))
        data[key] = conf
        cards.append('<section><h2>' + html.escape(key) + '</h2><img class="preview" src="' + key + '/preview.gif" alt="' + key + '"><p>' + str(conf["duration_ms"]) + 'ms / ' + str(len(conf["frames"])) + ' key poses</p><label>Frame <input type="range" min="0" max="' + str(len(conf["frames"]) - 1) + '" value="0" data-action="' + key + '"></label><div class="pose"><img id="pose-' + key + '" src="' + key + '/frames/00.png"></div><p id="info-' + key + '"></p></section>')
    payload = json.dumps(data, ensure_ascii=True).replace("<", "\\u003c")
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whole-character preview</title><style>*{box-sizing:border-box}body{margin:24px;background:#152130;color:#eee;font:16px system-ui}header{max-width:1100px;margin:auto}main{max-width:1100px;margin:24px auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}section{padding:18px;background:#25354b;border-radius:8px}img{image-rendering:pixelated;max-width:100%;display:block}.preview{width:100%;background:var(--pose-bg,#172433)}.pose{background:var(--pose-bg,#172433);min-height:160px}.pose img{width:100%}button{margin:4px;padding:8px}input{width:70%}p{line-height:1.5}body.check .pose,body.check .preview{background:repeating-conic-gradient(#ddd 0 25%,#aaa 0 50%)0/24px 24px}</style><header><h1>Whole-character asset preview</h1><p>Technical preview. Anatomy, weapon consistency, ground contact and gameplay require separate review.</p><button onclick="document.body.className='check'">Checker</button><button onclick="document.body.className='';document.body.style.setProperty('--pose-bg','#fff')">White</button><button onclick="document.body.className='';document.body.style.setProperty('--pose-bg','#000')">Black</button></header><main>CARDS</main><script>const actions=PAYLOAD;document.querySelectorAll('input[data-action]').forEach(r=>{function show(){const k=r.dataset.action,f=actions[k].frames[+r.value];document.getElementById('pose-'+k).src=k+'/'+f.file;document.getElementById('info-'+k).textContent='Frame '+(+r.value+1)+' / '+f.duration_ms+'ms / pivot '+f.pivot.join(',');}r.oninput=show;show();});</script></html>'''
    (root / "output" / "index.html").write_text(page.replace("CARDS", "".join(cards)).replace("PAYLOAD", payload), encoding="utf-8")


def build_project(root, action=None, force=False):
    profile = load_profile(root)
    if action and action not in profile["actions"]: raise PipelineError("Unknown action: " + action)
    keys = [action] if action else list(profile["actions"])
    for key in keys: build_action(root, key, profile["actions"][key], profile, force)
    render_gallery(root, profile)
    return check_project(root, action)


def check_project(root, action=None):
    profile = load_profile(root)
    if action and action not in profile["actions"]: raise PipelineError("Unknown action: " + action)
    keys = [action] if action else list(profile["actions"])
    rows = [check_action(root, k, profile["actions"][k]) for k in keys]
    report = {"status": "TECHNICAL_VERIFIED" if all(r["status"] == "PASS" for r in rows) else "FAIL", "scope": "PNG, atlas, palette, frame metadata and GIF timeline only", "visual_review": "pending", "engine_review": "pending", "user_signoff": "pending", "results": rows}
    write_json(Path(root) / "output" / "qa-report.json", report)
    return report


def init_project(root, demo=False):
    root = Path(root)
    if root.exists(): raise PipelineError("Destination already exists; choose a new directory.")
    root.mkdir(parents=True)
    (root / "source").mkdir()
    profile = {"schema_version": "0.1", "id": "calibration-demo" if demo else "my-character", "character_revision": "diagnostic-v1" if demo else "master-v1", "weapon_revision": "none-diagnostic" if demo else "weapon-v1", "route": "whole_character", "palette": {"status": "frozen" if demo else "pending", "colors": ["#24354b", "#ffd166", "#5ed9dd", "#ffffff"] if demo else []}, "actions": {"idle": {"source": "source/idle.png", "grid": [4, 1], "source_scale": 1, "frame_size": [48, 48], "pivot": [24, 40], "offsets": [[8, 8]] * 4, "durations_ms": [160, 80, 80, 160], "alpha_threshold": 220, "preview_scale": 4, "safety_margin_px": 2, "loop_preview": True, "loop_runtime": True, "boundary_equal": True, "events": {}}}}
    write_json(root / "profile.json", profile)
    if demo:
        sheet = Image.new("RGBA", (128, 32), (0, 0, 0, 0))
        draw = ImageDraw.Draw(sheet)
        for i in range(4):
            x = i * 32
            # Geometric calibration fixture, deliberately not a generated game character.
            draw.rectangle((x + 11, 8, x + 20, 25), fill="#24354b")
            draw.rectangle((x + 12, 9, x + 19, 14), fill="#ffd166")
            draw.line((x + 13, 24, x + 18, 24), fill="#ffffff")
            if i in (0, 3): draw.rectangle((x + 22, 17, x + 24, 19), fill="#5ed9dd")
            if i == 1: draw.rectangle((x + 5, 17, x + 7, 19), fill="#5ed9dd")
            if i == 2: draw.rectangle((x + 15, 3, x + 17, 5), fill="#5ed9dd")
        sheet.save(root / "source" / "idle.png")
    (root / "README.md").write_text("# " + profile["id"] + "\n\n" + ("Synthetic calibration fixture: no game character, private reference or third-party art is included.\n" if demo else "Add your approved whole-character source sheet, freeze the palette and fill profile.json.\n"), encoding="utf-8")
    return profile
