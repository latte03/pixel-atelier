# Pixel Atelier 本地工作台

在仓库根目录安装 `requirements.txt` 后运行：

```bash
python bridge/server.py --port 8898
```

打开 [127.0.0.1:8898](http://127.0.0.1:8898/)。首页的「先拿女骑士样板试试手」会从仓库的示例图集复制一个可编辑工程。试玩、编辑和导出可以独立运行。自己的角色可以从图片、已有待机 GIF 或角色描述开始。[八步操作说明](../docs/像素造物台-v0.5.md)

## 生成新动作

安装并登录支持内置生图的 Codex CLI。工作台通过本机 Codex App Server 生成透明 PNG 图像，读取当前登录环境返回的默认模型。实际供给取决于当前账号的模型能力。托管模式自动推进动作队列，每步保留预览时间，可暂停介入。遇到无法校验的图表或失败会停在对应动作。

上传、任务与角色数据保存在 `work/image-workbench/`，导出在其 `exports/` 目录。此工作目录被 Git 忽略。HTTP 服务仅监听回环地址，项目草稿和资产不会随源码发布。

## 可选 DSH 界面

本机安装 DSH 后可从仓库根目录运行：

```bash
python bridge/launch.py --open
```

工作台监听 8898，DSH 面板监听 8899。启动脚本使用 `work/dsh-home` 内的独立本地 profile。

## 任务状态

生成任务会写入结果 PNG、任务状态和可选参考图。超时时会检查已返回的透明 PNG。工作台使用确认有效的输出作为结果。健康检查 `GET /health` 的 `ready` 表示 HTTP 服务已启动，`generation_verified` 表示本机有已完成的生成任务。
