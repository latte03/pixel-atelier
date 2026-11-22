# 像素造物台 · Pixel Atelier

像素角色的本地动画工作台。用一张角色参考图制作一套游戏动作，逐帧微调后导出透明 GIF、PNG 帧、精灵图集和时序配置。

![女骑士下砸与上挑连段](examples/knight/combo.gif)

## 两种制作方式

- **逐步制作**。按待机、奔跑、闪身、连段、蓄力、跳跃、受击、倒地的顺序制作。每步可以播放、调整帧时长与位置、对比候选，选定版本后再继续。
- **托管模式**。上传角色参考图后依次生成八段动作。每步可暂停检查、微调或重做。完成后提供完整 ZIP。
- **统一角色工程**。从待机选一帧做母版，后续动作沿用同一角色设定。支持导入已有待机 GIF、原生像素倍率预览和命中／释放帧标记。

## 在本地跑起来

需要 Python 3.9 或更新版本。在终端执行：

```bash
git clone https://github.com/jinxingtaire/pixel-atelier.git
cd pixel-atelier
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python bridge/server.py
```

Windows PowerShell 可以用 `.venv\Scripts\Activate.ps1` 激活环境。打开 [本地工作台](http://127.0.0.1:8898/)，点 **「先拿女骑士样板试试手」**。八段动作随仓库提供，可以直接播放、微调并导出。试玩、导入和导出在本地完成，生成自己的新动作需要安装并登录支持内置生图的 Codex CLI。[独立工作台与可选 DSH 面板](bridge/README.md)

## 女骑士示例

金发双手巨剑女骑士有八段动作、共 80 个关键姿势。下砸命中后压低身体，再蹬腿转胯，把剑从低位带到头顶。源码里的示例保留透明图集、原生像素尺寸、帧时长和锚点，方便观察角色比例、武器长度和动作衔接。[示例素材与来源](examples/knight/README.md) · [制作复盘](examples/knight-retrospective.md)

## 工具和文档

- [工作台使用说明](docs/像素造物台-v0.5.md)
- [制作流程](docs/workflow.md)与[动作简报模板](templates/action-brief.md)
- [CLI 配置](docs/configuration.md)与[游戏接入约定](docs/engine-integration.md)

工作台在 `bridge/`。`spritepipe/` 是独立的资源构建和检查 CLI，可用合成校准图演示完整流水线：

```bash
python -m spritepipe demo work/calibration-demo
python -m spritepipe check work/calibration-demo
python -m unittest discover -s tests
```

导出配置可用来设置引擎中的播放时序和根节点。角色观感、攻击范围和打击反馈需要在游戏中复核。欢迎贡献带最小复现的修复和引擎适配。[贡献说明](CONTRIBUTING.md)

代码与文档采用 [MIT License](LICENSE)。工作台的私人项目、上传图、生成记录和导出保存在被 Git 忽略的 `work/` 目录。
