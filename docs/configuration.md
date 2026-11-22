# CLI配置与输出

仓库版本0.1.0。CLI的`profile.json`使用`schema_version=0.1`。`templates/character-brief.json`是制作设计简报，使用独立的`brief_version`；它不能直接作为可执行profile。

## 命令

```bash
python -m spritepipe init work/my-character
python -m spritepipe demo work/calibration-demo
python -m spritepipe build work/my-character
python -m spritepipe build work/my-character --action idle
python -m spritepipe check work/my-character
python -m spritepipe check work/my-character --action idle
python -m spritepipe build work/my-character --action idle --force
```

`init/demo`要求目标目录不存在。`build`默认不覆盖已有动作输出；`--force`在成功写出新文件后把该动作旧输出移入`archive/<id>-<unique>/`。源图不修改。一次构建多个动作时，每个动作独立提交；后面的动作失败不会回滚前面已成功的输出。

退出码：0=操作完成/技术通过；1=产物检查失败；2=参数、源文件或配置错误。

## 最小可执行配置

下面的数值仅用于32×32源格的示例，不是通用角色标准。运行`demo`可获得对应的可重建几何源图。

```json
{
  "schema_version": "0.1",
  "id": "my-character",
  "character_revision": "master-v1",
  "weapon_revision": "weapon-v1",
  "route": "whole_character",
  "palette": {
    "status": "frozen",
    "colors": ["#24354b", "#ffd166", "#5ed9dd", "#ffffff"]
  },
  "actions": {
    "idle": {
      "source": "source/idle.png",
      "grid": [4, 1],
      "source_scale": 1,
      "frame_size": [48, 48],
      "pivot": [24, 40],
      "offsets": [[8, 8], [8, 8], [8, 8], [8, 8]],
      "durations_ms": [160, 80, 80, 160],
      "alpha_threshold": 220,
      "preview_scale": 4,
      "safety_margin_px": 2,
      "loop_preview": true,
      "loop_runtime": true,
      "boundary_equal": true,
      "events": {}
    }
  }
}
```

## 字段含义

| 字段 | 约束 |
|---|---|
| source | 项目内相对路径PNG，源图应已有透明通道；禁止绝对路径和逃出项目的路径 |
| grid | [列,行]；等分格按行读取，边界取整，支持宽格；空白尾格不必全部使用 |
| durations_ms | 前N个源格各自时长；正数、10ms的整数倍，以便GIF时间精确表达 |
| source_scale | 整张源动作表共用的缩放倍率，保持每格纵横比；不按人物包围盒缩放 |
| frame_size | 该动作原生输出宽高，允许不同动作有不同留白 |
| pivot | 逻辑根节点在输出帧内的坐标，左上角为原点；它不是自动测得的可见脚尖 |
| offsets | 每一帧缩放后完整源格的左上角在输出画布中的位置；整像素平移 |
| palette | 先审核母版再标记frozen；1..255个不重复RGB颜色，GIF额外保留透明索引0 |
| alpha_threshold | 整理规则，低于阈值清透明，其余映射到冻结色板并置255；处理后要视觉复核 |
| safety_margin_px | 输出可见像素不得进入的边缘保护区；源格本身碰边也会被构建拒绝 |
| preview_scale | 1..16整数倍放大；原生PNG尺寸保持不变 |
| boundary_equal | 仅在明确要求首尾完全同图时设true；跑步完整步态通常不强制此项 |
| loop_runtime / loop_preview | 游戏播放建议和预览GIF循环分别表达；具体游戏状态机仍需适配 |
| events.strikes | 0起始的关键姿势索引；不会把整个GIF作为一次持续命中 |

仅源图没有在格边界出现可见像素，无法保证内部没有画错的断剑。模型错误仍需要视觉检查。

## 输出

每个`output/<action>/`包含：

- `frames/*.png`：原生RGBA整身帧。
- `atlas.png`：4列图集；不足4列留透明空格。
- `animation.json`：尺寸、来源哈希、每帧rect/pivot/root_motion/duration/start_ms、事件及审核状态。
- `preview.gif`：透明索引0、disposal=2、按各姿势独立时长；实际编码帧可因相邻相同图合并。

`output/index.html`可离线打开，逐帧滑条直接引用PNG，无网络请求。`output/qa-report.json`记录技术检查，视觉、引擎和用户确认保留pending。

## 检查范围

构建时检查源格是否为空/碰边，以及变换后的可见像素是否超出输出保护区。检查命令核对源图哈希、配置、原生帧、图集像素与GIF解码后按10ms展开的完整RGBA时间线，可发现透明清除残影、时序或倍率错误。

检查不会自动测量肩肘腕、角色身份、逐帧剑长、步态足底接触、真实武器碰撞或游戏手感，也不验证事件的玩法语义。报告为TECHNICAL_VERIFIED时还需继续视觉与引擎验收。
