<p align="center"><img src="assets/aicut/icon.png" width="96" alt="AI Cut"></p>

<h1 align="center">AI Cut</h1>

<p align="center">本地优先、可被 AI agent 直接操作的视频剪辑桌面应用（macOS / Windows）。<br>
A local-first desktop video editor that AI coding agents can drive directly.</p>

AI Cut 是 [OpenChatCut](https://github.com/0xsline/OpenChatCut)（AGPL-3.0-or-later）的派生版。编辑器、内置 Agent、
外部 agent 用的 MCP 编辑工具、本地语音识别、渲染导出全部来自上游，AI Cut 在上面加了三样东西：

| | 内容 |
|---|---|
| **一键接入各种 AI agent** | 顶栏插头按钮 →「外部 Agent 接入 (MCP)」：自动检测本机的 Claude Code、Codex、Cursor、Gemini CLI 等，把 AI Cut 的 MCP 服务（带令牌）和使用技能 `ai-cut` 一起装进去；装、更新、卸载都在一个窗口里，改配置前自动备份。命令行版：`./tools/aicut-agents.sh` |
| **跟着上游升级** | 上游每发一个版本，`./tools/upstream-sync.sh` 负责合并、门禁、生成"上游新增特性"报告；仓库里的 `.claude/skills/aicut-upstream-sync` 让 AI agent 按同一流程完成升级 |
| **独立的桌面版身份** | 自己的名字、图标、更新源、数据目录（`~/.ai-cut`）与端口（5299），可以和上游 OpenChatCut 同时装、同时开 |

## 安装

从本仓库的 Releases 下载：macOS（Apple Silicon / Intel 各一个 dmg）、Windows（x64 安装包）。
macOS 包没有 Apple 开发者签名，第一次打开时到「系统设置 → 隐私与安全性」里点「仍要打开」。

## 让你的 agent 用上 AI Cut

1. 打开 AI Cut，点顶栏的插头按钮。
2. 检测到的 agent 会列出来，点「全部安装 / 更新」或逐个「安装」。
3. 重启对应的 agent。之后对它说"用 AI Cut 打开我的工程，把第 8 秒加一个音效"之类即可。

不能自动写入的 agent（配置文件带注释、或只能在它自己的界面里加 MCP 的）会显示要粘贴的配置。
支持哪些 agent、每个写到哪里、依据哪份官方文档：`shared/aicut/agents.json` 与 `docs/research/agent-registry.md`。

## 数据放在哪

| 内容 | 位置 |
|---|---|
| 工程库、媒体、生成记录、MCP 令牌与端口 | `~/.ai-cut/`（设置里可改数据目录） |
| 设置与密钥 | macOS `~/Library/Application Support/AI Cut/.env.local`；Windows `%APPDATA%\AI Cut\.env.local` |
| 语音识别模型、内容插件、自定义技能 | 与上游共用 `~/.openchatcut/`（避免重复下载） |
| 「Agent 接入」的安装记录与配置备份 | `~/.ai-cut/agent-installs.json`、`~/.ai-cut/agent-backups/` |

## 从源码构建

需要 Node.js 24、git；macOS 另需 cmake（编译 whisper.cpp）。Windows 包要在 Windows 机器上打（通过 SSH 打包主机）。

```bash
./tools/setup-repo.sh --install     # 配好 git（upstream、rerere、合并驱动）并安装依赖
./tools/doctor.sh                   # 检查环境
./tools/test.sh --all               # 上游全部门禁 + 派生测试
./tools/build.sh --mac --dir        # 本机打一个 .app（release-aicut/）
./tools/build.sh --win --pkg g1     # 在 Windows 打包主机上打安装包
```

开发约定（不改 `package.json`、接入点登记、测试命名等）见 [CLAUDE.md](CLAUDE.md)；方案与决策见 [docs/](docs/)。

## 许可与致谢

AI Cut 以 **GNU AGPL v3 或更新版本** 发布（见 [LICENSE](LICENSE)），与上游相同。
本项目基于 [0xsline/OpenChatCut](https://github.com/0xsline/OpenChatCut)，版权归 OpenChatCut Contributors；
派生版改动过的上游文件与改动日期列在 [NOTICE-AICUT.md](NOTICE-AICUT.md)。
"OpenChatCut" 名称与图标属于上游，AI Cut 不代表上游，也未获其背书。

依赖与素材的其他许可（Remotion 公司许可条件、GitHub Copilot CLI、部分字体与音效等）见 [NOTICE-AICUT.md](NOTICE-AICUT.md)。
