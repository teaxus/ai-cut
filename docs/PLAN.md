# ai-cut 实现方案与计划（v1.1 草案，2026-10-25）

> v1.1：项目名、目录名由 open-ai-cut 改为 **ai-cut**（用户 2026-10-25 决定，避开 "OpenAI" 商标联想）；代码命名空间统一用 `aicut`。

> 状态：**待用户落实**。落实之前不动代码。本文每条事实都标来源；"判断"= 方案权衡，"待验"= 还没在本机闭环证实。
> 事实底座：`docs/research/upstream-survey-v0.2.17.md`（Opus 子代理只读调查，434 行，逐条 file:line）。

## 0. 一句话结论

**不重写。** OpenChatCut 上游**已经是 C/S 架构**（Electron 43 桌面版，三平台安装包，自带更新器）。ai-cut 做成"薄壳派生版"：fork 上游、只碰 6–9 个上游文件、其余全部放新文件；再补三样上游没有的东西——**一键把 skill + MCP 装进所有 agent 的安装器**、**AI 驱动的上游同步升级工作流**、**自己的品牌/更新源/打包流水线**。

## 1. 前提修正：上游不是 B/S

你看到的 `localhost:5199` 是上游的 Web 开发形态（`npm run dev`）。桌面版早就在仓库里，而且每个版本都发：

| 事实 | 依据 |
|---|---|
| Electron 主进程 + 内嵌 HTTP 服务，挂的是和 Web **同一套**服务端插件 | `package.json:9`（`main: desktop-dist/main.mjs`）、`desktop/` 90 个文件、`desktop/embedded-server.ts:99-103` |
| 每个 Release 带 mac arm64/x64 dmg+zip、Windows NSIS exe、Linux AppImage、更新元数据 | `gh release view v0.2.17`：安装包 555–776 MB |
| 自带 electron-updater（win/linux 应用内更新；mac 只提示去发布页） | `desktop/update-service.ts:19-22` |
| 前端是 **React**，不是 Vue | `src/App.tsx`、`src/Editor.tsx` |
| 许可证 **AGPL-3.0-or-later** | `LICENSE`、`package.json:6` |
| 已有对外 skill（`skills/openchatcut`，经 `npx skills add 0xsline/OpenChatCut` 安装）和应用内「连接」按钮（写 Claude Code / Cursor / Antigravity / Qoder / Codex 的 MCP 配置） | `README.md:329-445`、`server/external-agent/client-connect.ts:117-255` |
| 节奏：2026-08-11 到 10-15 发了 18 个版本；7/20 起 1097 个提交 | `gh release list`、调查报告 §11 |

所以 skill 自带的 Vue 脚手架**不用**，只借它的打包工具链（`build.sh`、`tools/pkghost-*`、GitHub Actions 模板）。前端保持 React——改成 Vue 等于重写，并且永远跟不上上游。

## 2. 你的要求 → 方案落点

| 你的要求 | 落点 | 说明 |
|---|---|---|
| 和 OpenChatCut 功能一样的 C/S 版 | 直接继承上游桌面版 | 功能零损失，130 个 MCP 工具、内置 agent、本地 ASR、渲染全在 |
| 上游升级时能通过 AI 升级特征 | `tools/upstream-sync.sh` + 仓库内 skill `aicut-upstream-sync` + 接入点清单 | 见 §6.3 |
| App 自带 skill 安装、装进所有类型 agent | 新功能「Agent 接入」：注册表驱动的安装器（MCP 配置 + skill 目录），复用上游已有的 `client-connect` | 见 §6.2 |
| 项目在 `/Users/teaxus/AILearning/ai-cut` | 该目录就是 fork 的检出根（目前只有 `docs/`） | 已加入本会话 |
| 设计需要哪些 Opus / Sonnet 子代理 | §7 | Fable 只做控制、评审、验收 |

## 3. 方案选型

| 做法 | 功能对齐 | 跟上游升级 | AI 自动化友好 | 结论 |
|---|---|---|---|---|
| A. 用 skill 脚手架重写（Electron + Vue） | 要重做编辑器、agent、渲染、原生推理……永远追不上 | 无法跟 | — | **否** |
| B. 上游作 submodule/subtree 原样放着 + overlay + patch 队列（VSCodium/Brave 做法） | 全继承 | 上游单版本改几百个文件，patch 队列每次大面积失效 | 中（AI 要改 .patch 的上下文） | 否（判断） |
| **C. fork + 按版本 `git merge` 上游 + 自有代码严格隔离在新文件 + 少量一行钩子** | 全继承 | 每版一次 merge，冲突集中在已知的几个钩子行 | **高**（标准 git 冲突，意图可文档化） | **选 C** |

Gemini 调研（无来源，作线索）和我的判断一致：对快速迭代的 React 项目，patch 队列代价远高于 merge；关键是把自有代码的"接触面"压到最小、每个接触点写明意图，让 AI 解冲突时有据可依。

## 4. 总体架构

```
ai-cut/                      ← fork 根，git remote: upstream = 0xsline/OpenChatCut，基线 tag v0.2.17
├── (上游全部文件，原样)            ← 不改，merge 时 "theirs" 优先
├── 接入点（≤ 12 个上游文件）        ← 每处 1 行钩子或 1 个常量，登记在 docs/integration-points.md
├── server/plugins/aicut/…           ← 派生服务端插件（安装器 API 等）
├── server/external-agent/aicut/…    ← 安装器核心（注册表、写入器、探测）
├── src/components/settings/aicut/…  ← 派生设置页分区
├── src/i18n/dict/{en,it,ru}/aicut.ts← 派生词条（中文是 key，英文必须有）
├── desktop/aicut/…                  ← 派生 Electron 入口（环境注入：数据目录、端口、token）
├── config/aicut-electron-builder.config.mjs ← wrapper：import 上游配置再覆盖 appId/productName/publish/icon
├── assets/aicut/…                   ← 派生图标、字标
├── tools/*.sh                     ← 人跑的入口（-h 双语、校验环境、相对自身定位）
├── .github/workflows/aicut-*.yml    ← 派生 CI/打包（上游 ci.yml / desktop.yml 原样保留，不触发）
├── .claude/skills/aicut-upstream-sync/ ← 升级工作流 skill（给 Claude Code 等用）
├── aicut-tests/                     ← 派生测试（不用 .verify 后缀，避开上游登记门禁）
└── docs/                          ← 本文、接入点清单、决策记录、升级报告、验收记录
```

要点（都来自调查报告 §10）：
- 上游 `.gitignore` 忽略 `docs/`、`.claude/`、`CLAUDE.md`、`AGENTS.md`、`/scripts/*`（`.gitignore:60-93`）→ 在 `.gitignore` 末尾追加反向规则（1 个接入点），派生脚本一律放 `tools/` 不放 `scripts/`。
- 上游门禁：所有 `*.verify.*` 必须登记进 `package.json`（`scripts/verify-gate-coverage.verify.mjs:63-69`），而 `package.json` 是冲突第一源（306/1097 次改动）→ 派生测试用 `*.test.ts` + 自己的 shell 入口；**`package.json` 一行不改**。
- 上游门禁：非测试源码 ≤ 500 行、`t('中文')` 必须有英文词条、生成的工具目录必须一致 → 派生代码同样遵守，这样上游 `npm test` 在派生仓库里照样全绿。

## 5. 接入点清单（初版，开发时在 `docs/integration-points.md` 维护）

| 类别 | 上游文件 | 改什么 | 上游改动频率（总/近30天） | 冲突策略 |
|---|---|---|---|---|
| 必改 | `src/ui/upstreamUpdate.ts:6-7` + `.verify.ts:24` | 更新检查/发布页 URL 指向派生仓库；版本比较兼容 `-aicut.N` | 3/0 | ours |
| 必改 | `index.html:5,8` | favicon、title | 0/0 | ours |
| 必改 | `public/openchatcut-icon.png` | 原地换图（Win/Linux 图标、favicon、应用内 BrandMark 都引用它） | 0/0 | ours |
| 必改 | `src/components/icons.tsx:143+` | 字标 SVG | 13/0 | ours |
| 必改 | `src/components/DashboardHeaderLinks.tsx:6-7` | 源码链接指向派生仓库（AGPL 源码入口）、去掉上游作者邮箱 | 1/0 | ours |
| 建议 | `src/i18n/locale.ts:25-45` | 默认语言跟系统（上游非 zh/it/ru 一律英文） | 16/3 | ours（小块） |
| 建议 | `desktop/embedded-port.ts:7,22-27` | 默认端口与端口记忆文件改为派生自己的（与上游并装时不抢 5199） | 3/0 | ours |
| 建议 | `src/components/chat/ChatPanelView.tsx:45` | 聊天栏折叠态品牌字样 | 19/0 | ours |
| 钩子 | `server/plugins/index.ts` 数组末尾 | `...aicutServerPlugins()` 1 行 | 66/11 | 保留 1 行 |
| 钩子 | `src/components/settings/settingsSchema.ts` 分区数组末尾 | 追加「Agent 接入」分区 1 行 | 52/6 | 保留 1 行 |
| 钩子 | `src/i18n/dict/en/index.ts`（it/ru 同） | `import aicut` 1 行 | 2/0 | 保留 1 行 |
| 钩子 | `.gitignore` 末尾 | `!docs/ !.claude/ !CLAUDE.md` | 低 | 保留块 |
| 不碰 | `package.json`、`config/electron-builder.config.mjs`、`.github/workflows/*`、`desktop/main.ts`、`preload.ts`、`skills/openchatcut/**`、`.mcp.json` | 用 wrapper 配置 / 自己的 workflow / 自己的 Electron 入口替代 | 306、10、28、60、30 | theirs |

打包元数据（名字、版本、desktopName）用 electron-builder 的 `extraMetadata` 在 wrapper 里覆盖（待验，上游 `config/electron-builder.config.mjs:31` 的 `CC_EB_TARGET` 读取方式让 wrapper 可以直接 import）。

## 6. 功能设计

### 6.1 外壳：品牌、更新源、数据隔离、版本号

| 项 | 设计 | 依据/备注 |
|---|---|---|
| 品牌 | 只改外壳：appId `com.teaxus.aicut`、productName、图标、title、字标、源码链接。源码深处 150 处 "OpenChatCut" 文案**不改**（i18n 用中文当 key，改文案 = 改 key，en/it/ru 三份字典连锁） | 报告 §9 末段；AGPL 不授予商标，外壳必须改名 |
| 更新源 | win/linux：electron-updater 指向派生仓库的 GitHub Releases（wrapper 的 `publish`）；mac：`upstreamUpdate.ts` 的两个 URL 改派生仓库 | `desktop/update-service.ts`、`src/ui/upstreamUpdate.ts:6-7` |
| 数据隔离 | 默认**与上游隔离**：派生 Electron 入口先设 `OPENCHATCUT_DATA_DIR=~/.ai-cut`、`OPENCHATCUT_SKILLS_DIR`、token 文件，再 `import` 上游主体；端口记忆改代码；**模型缓存 `~/.openchatcut/asr-models` 保留共用**（几百 MB 到几 GB，重复下载没意义） | 报告 §4.3、§9"可选（数据隔离）"行；入口注入方案待验 |
| 版本号 | `package.json` 不动；派生版本 = `<上游版本>-aicut.<N>`，由 wrapper `extraMetadata.version` 注入；`upstreamUpdate.ts` 的比较逻辑同步兼容（上游 semver 把预发布段算"更旧"） | 报告 §3.3 版本号坑 |
| Electron 入口 | `desktop/aicut/main.ts`：注入 env → `await import('../app-main.mjs')`；wrapper `extraMetadata.main` 指向它；多跑一次 esbuild | `desktop/bootstrap.ts:14-29`；待验，不行就退回改 `runtime-profile.ts` 等 4 个低频文件 |

### 6.2 「Agent 接入」安装器（新功能）

**目标**：App 内一键把 ① OpenChatCut 的 MCP 服务（`/api/external-mcp/mcp` + Bearer token）② skill 目录，装进本机**所有已安装**的 AI 编码 agent；可查看状态、重装、卸载；端口/token 变化后一键重新同步。

**现状可复用**（报告 §7）：上游 `server/external-agent/client-connect.ts` 已实现 Claude Code（`~/.claude.json`）、Cursor（`~/.cursor/mcp.json`）、Antigravity（`~/.gemini/antigravity/mcp_config.json`，`httpUrl`）、Qoder/Qoder-CN（`settings.json`）、Codex（`codex mcp add … --bearer-token-env-var`，并把 token 写进 `~/.zshrc`）、千问办公（只能复制 JSON）。JSON 合并只动 `openchatcut` 一项、原子写入、解析失败拒写——这套原则沿用。

**设计**：

| 层 | 内容 |
|---|---|
| 注册表 `agents.json` | 每个 agent：id、显示名、探测规则（全局配置目录 / 命令名）、skills 全局目录（来自 `vercel-labs/skills` 的 `docs/agents.md`，MIT，79 个 agent，已拷到 `docs/research/skills-cli-agents.md`）、MCP 配置文件路径与方言（`mcpServers` JSON / Codex TOML / Gemini 系 `httpUrl` / OpenCode `type: remote` / Zed `context_servers` / CLI 命令 / 仅复制）、**核实状态**（`verified` 带官方文档 URL 与日期；`unverified` 只提供"复制配置"） |
| 写入器 | 按方言一个适配器：读 → 备份 → 合并（只动自己的键）→ 原子写 → 回读校验 → 记录到 `~/.ai-cut/agent-installs.json`；卸载按记录还原；Codex 优先用 config.toml 的请求头字段而不是写 `~/.zshrc`（具体字段由子代理 D 按 Codex 官方文档核实） |
| skill 安装 | App 内置 `skills` CLI（npm 包 `skills` 1.7.4，MIT，无可编程 API，但支持 `skills add <本地目录> -g -a <agent> -y` 非交互），打包时 `asarUnpack`；用 Electron 自带 Node 跑；失败时回退到自带的目录复制器。安装的 skill 内容 = 上游 `skills/openchatcut`（名字、MCP 服务名 `openchatcut` 被上游 verify 钉死，不改，升级时自动跟进）+ 派生自己的 `ai-cut` 路由 skill（安装/诊断/升级） |
| 服务端 | `server/plugins/aicut/agent-installer.ts`：`GET /api/aicut/agents`（探测 + 状态）、`POST …/plan`（dry-run 列出将写哪些文件）、`POST …/install`、`POST …/uninstall`、`POST …/resync`；同源校验沿用上游 `trustedEditorRequest` |
| 界面 | 设置 → 「Agent 接入」：打开即列出本机探测到的 agent 与状态（已装/未装/配置过期/未核实），一键"全部安装"或逐个；每行就地显示结果与失败原因；未核实的 agent 显示"复制配置"而不是假装能装。**写代码前先过 `ui-ux-gate`**（交互规格 → Gemini 对标 → 反模式清单 → Opus 落地 → 可用性走查） |
| 命令行 | `tools/aicut-agents.sh {list,install,uninstall,resync} [--agent …]`：薄客户端调上面的 HTTP API（App 需在运行）；不改上游 `cli/` |
| 诚实原则 | "所有类型 agent" = 注册表里核实过的全部；核实靠逐个对照官方文档（子代理 D），不靠 Gemini 的表（三次问答均无来源，多处明显编造） |

本机现有 13 个 agent 配置目录（Claude Code、Codex、Cursor、Gemini CLI、Antigravity、Qoder、OpenCode、Windsurf、Kiro、Copilot、Cline、Lingma、Claude Desktop），验收时能真测这 13 个。

### 6.3 升级工作流（"上游升级时通过 AI 升级特征"）

| 步骤 | 工具 | 产出 |
|---|---|---|
| 1 检查 | `tools/upstream-sync.sh check` | 上游新 tag 列表、CHANGELOG 增量、触及接入点清单中文件的提交 |
| 2 合并 | `… start vX.Y.Z` | 分支 `sync/vX.Y.Z`，`git merge vX.Y.Z`（`rerere` 开启），冲突文件清单（机器可读） |
| 3 解冲突 | Claude Code 子代理按 skill `aicut-upstream-sync` 执行 | 规则：接入点文件按清单里的策略（钩子行保留、品牌 ours、其余 theirs）；意图不明时读 `docs/integration-points.md` 里的意图说明；生成文件（`assets/agent/openchatcut-tool-schemas.json`）不手工合，合并后重新 `generate:server-tool-catalog` |
| 4 门禁 | `… gate` | 上游 `npm run lint && npm test`（全部 verify）+ `aicut-tests` + `desktop:smoke` + wrapper 打包 `--dir` |
| 5 特性报告 | `… report vX.Y.Z` → `docs/upgrades/vX.Y.Z.md` | 上游 CHANGELOG 段落、MCP 工具目录 diff（新增/删除/参数变化）、内置 skill 与 `skills/openchatcut` diff、设置项 diff、被上游改动的接入点；AI 据此更新派生 skill 文案、注册表、README |
| 6 收尾 | `… finish` | 合回 `main`，打 tag `vX.Y.Z-aicut.1`，触发打包 |
| 预演 | 在真实用之前，用 **v0.2.16 → v0.2.17** 走一遍全流程 | 证明工具链有效，顺便产出第一份报告样例 |

战略风险：上游已写明计划改成"TS UI + 插件系统 + C++ 后端"（`config/README.md` 末节）。真落地时接入点会整体重定位——这是本工作流存在的理由，也是"接触面必须小"的理由。

### 6.4 打包与分发

| 平台 | 做法 | 依据/备注 |
|---|---|---|
| macOS arm64 / x64 | 复用上游链路（`build` → `desktop:build:main` → `desktop:prebundle` → `prepare-target`），最后一步 electron-builder 换成 wrapper 配置；**分开打两个包**，不做 universal | skill 坑 A10；上游也是分开打 |
| Windows x64 | 在 **g1**（`~/.pkghost.yaml` 已配好）上远程打包：`./build.sh --pkg g1 --platform windows`；远端需 Node 24、git；whisper 用上游 release 资产不需编译 | skill `tools/pkghost-*`；内网直连，不走 VPN（VPN 丢包） |
| Linux | 默认不做（无验收设备；上游 x64 AppImage 仍可按需打） | 决策项 |
| 签名 | mac：同上游 ad-hoc（无 Developer ID）；本机打包若钥匙串有证书，设 `CSC_IDENTITY_AUTO_DISCOVERY=false`；Windows 无证书（SmartScreen 提示） | skill 坑 A5；决策项 |
| 网络 | 构建要访问 npm、storage.googleapis.com（Chrome for Testing、MediaPipe）、github.com（whisper.cpp 源码）；国内网络需代理 | 报告 §6 |
| 体积 | 上游安装包 555–776 MB（Chrome Headless Shell + compositor + onnxruntime + ffmpeg）；派生版同量级 | `gh release view` |
| 入口 | `./build.sh --mac [--arch both] / --pkg g1 --platform windows / --dir`，`-h` 双语 | 工作流规则 1 |

## 7. 子代理分工（Fable 只做控制）

| # | 角色 | 模型 | 阶段 | 输入 | 产出 | 验收（Fable 做） |
|---|---|---|---|---|---|---|
| A | 上游调查员 | Opus | 已完成 | 上游检出 | `docs/research/upstream-survey-v0.2.17.md` | 已复核要点 |
| B | 仓库奠基 | Sonnet | P1 | §4 布局、§5 清单 | 完整 clone（非浅）基线 v0.2.17 → `main`，`upstream` remote，`rerere`，`.gitignore` 反向规则，`tools/{dev,build,upstream-sync,aicut-agents}.sh` 骨架（-h 双语），`docs/integration-points.md`、`docs/decisions.md`，仓库 `CLAUDE.md`，`npm ci` | 目录结构、脚本 `-h` 可跑、`npm test` 上游门禁全绿 |
| C | 外壳与打包 | Opus | P3 | §5、§6.1、§6.4，skill `references/gotchas.md` | 6 个必改文件 + 3 个建议改、派生 Electron 入口、wrapper 打包配置、`build.sh` 适配、`aicut-desktop.yml`、Windows 远程打包接通 | diff 逐行看；mac `--dir` 产物能启动；g1 打出 exe |
| D | Agent 注册表核实 | Sonnet | P4（与 C 并行） | `docs/research/skills-cli-agents.md`、上游 `client-connect.ts`、各 agent 官方文档 | `agents.json`（每条带来源 URL、日期、核实状态）、每种方言的 fixture、核实表 | 抽查 5 个 agent 的来源；本机 13 个 agent 的路径逐个 `ls` 对 |
| E | 安装器后端 | Opus | P4（D 之后） | §6.2、`agents.json`、上游 `client-connect.ts` 与 `request-shape-gate` | `server/external-agent/aicut/*`、`server/plugins/aicut/agent-installer.ts`、`skills` CLI 打包集成、`aicut-tests/agent-installer.test.ts`、`tools/aicut-agents.sh` | 500 行门禁、`npm test` 全绿、本机 13 个 agent dry-run 与真装 |
| F | 安装器界面 | Opus | P4（E 之后；之前 Fable 先出 ui-ux-gate 交互规格） | 交互规格全文、E 的 API | 设置分区「Agent 接入」、i18n 词条（zh key + en）、`settingsSchema` 钩子 1 行 | 可用性走查（独立于功能测试）、`check-i18n` 全绿 |
| G | 升级工作流 | Opus | P5（P1 后即可开始预演，P3/P4 后定稿） | §6.3、`docs/integration-points.md` | `tools/upstream-sync.sh`（check/start/gate/report/finish）、`tools/feature-diff.sh`、`.claude/skills/aicut-upstream-sync/SKILL.md`、v0.2.16→v0.2.17 预演报告 | 预演产出 `docs/upgrades/v0.2.17.md`，门禁全绿 |
| H | 验证员 | Sonnet（后台） | P2 基线、P6 验收 | 各阶段产物 | `docs/verification/<日期>.md`：上游原样 dev 跑通、mac/win 包安装运行、MCP 从 Claude Code + Codex 端到端、安装器真装 13 个 agent 并回读 | Fable 复核证据，写「测试与验收结果」 |
| I | 文档 | Sonnet | P7 | 全部 | README（zh/en）、PACKAGING、用户手册、AGPL 修改声明与 NOTICE-AICUT | 对照 §10 合规项 |

子代理简报统一包含：文件路径、要改什么、为什么、验收标准、"不许改 `package.json`、不许起用户的 dev server、测试不用 `.verify` 后缀、源码 ≤ 500 行、中文文案必须配英文词条"。界面任务只给 Opus，并把 ui-ux-gate 规格全文贴进简报。

## 8. 阶段与依赖顺序（只讲依赖和风险，不估工期）

| 阶段 | 内容 | 依赖 | 为什么先做 |
|---|---|---|---|
| P0 | 用户落实本方案与 §11 决策 | — | 名字、托管、签名影响 C 的产物 |
| P1 | 奠基（B） | P0 | 其他一切都在这个仓库上做 |
| P2 | **基线验证**（H）：上游原样 `desktop:dev` 跑通、mac `--dir` 打包、g1 打 Windows 包 | P1 | 先证明上游链路在本机/g1 能走通，再谈改动；过不了就先修环境（cmake、代理、Node 24） |
| P3 | 外壳与打包（C） | P2 | 产物身份确定后，后续验收才看得到"自己的 App" |
| P4 | Agent 接入安装器（D → E → F） | P1（不依赖 P3，可与 P3 并行） | 这是派生版最主要的新价值 |
| P5 | 升级工作流（G） | P1 预演；P3/P4 定稿 | 接入点全部落地后才能冻结清单 |
| P6 | 验收（H） | P3–P5 | 真机：本机 macOS + g1 Windows |
| P7 | 文档与首个发布（I；push 由用户确认） | P6 | AGPL 要求源码与安装包同时可得 |

## 9. 验收与真机测试计划

| 项目 | 怎么测 | 真机 |
|---|---|---|
| 功能对齐 | 上游 `npm test`（约 200 个 verify）全绿；`desktop:smoke`；用本会话已有的对比素材（`ai_agent_playground/对比_剪映_vs_OpenChatCut/`）在派生 App 里从 MCP 走一遍"导入 → 时间线 → 字幕 → 渲染" | macOS：本机 M4 Mac（真实目标环境） |
| Windows | g1 远程打包 → 安装包拷回 → 在 g1 上安装运行（GUI 步骤只能用户做，SSH 会话 0 无桌面；上游 CI 的 `CC_SMOKE` 静默冒烟可先试，待验） | Windows：g1 |
| 安装器 | 本机 13 个 agent：dry-run 计划 → 真装 → 回读文件 → 从 Claude Code 与 Codex 实际调一次 `openchatcut_status` → 卸载还原 | macOS 真机 |
| 升级工作流 | v0.2.16 → v0.2.17 预演全流程 | — |
| Linux | 不做 → 验收结论写"未完成" | 无设备 |

交付时按用户规则写「测试与验收结果」（真机测试三态）和「本次产生的数据」。

## 10. 风险与合规

| 风险 | 影响 | 对策 |
|---|---|---|
| `package.json` 冲突（28% 上游提交） | 每次同步必冲突 | 一行不改；元数据走 `extraMetadata`，脚本走 `tools/`，测试不用 `.verify` |
| 上游重构（TS UI + 插件系统 + C++ 后端） | 接入点整体失效 | 接触面 ≤ 12 处、全部登记意图；同步工作流按清单重定位 |
| AGPL 义务 | 分发安装包必须同时提供派生源码；保留版权声明；改过的文件要有修改说明 | 公开仓库 + Release 附源码 tag；应用内源码链接指派生仓库；NOTICE-AICUT |
| 商标 | AGPL 不授权 "OpenChatCut" 名字/图标 | 外壳全部改名换图；文案保留 "基于 OpenChatCut" 的致谢，不暗示背书 |
| Remotion 许可 | 个人/≤3 人营利组织免费，更大公司要公司授权 | 使用方自行确认（判断，非法律意见） |
| Copilot CLI、5 款"免费商用"字体、无许可说明的音效/LUT/语音样本 | 再分发条件待验 | 子代理 I 列清单；必要时从派生包里剔除 |
| 名字 | 原名 open-ai-cut 读起来像 "OpenAI"（判断）；已改为 ai-cut | 已解决（2026-10-25） |
| 构建环境 | mac 编译 whisper.cpp 需 git+cmake；二进制从 googleapis/github 下载；安装包 700 MB 级；g1 需 Node 24 | P2 先验；国内网络走代理 |
| 与上游并装 | 共用 `~/.openchatcut` 和 5199 端口 | §6.1 数据隔离 + 自己的端口 |
| Codex 接入把 token 写进 `~/.zshrc`（上游做法） | 侵入用户 shell 配置 | 改用 Codex 配置文件的请求头字段（子代理 D 核实字段名） |
| 本机 Mac 已有签名证书时打包卡时间戳 | 本地 `--dir` 失败 | `CSC_IDENTITY_AUTO_DISCOVERY=false`（skill 坑 A5） |

## 11. 待决事项（默认选择；不改就按默认做）

| # | 事项 | 默认 | 备选 |
|---|---|---|---|
| 1 | 产品名 / 仓库名 | **已定**：仓库与目录 `ai-cut`，显示名 `AI Cut`，appId `com.teaxus.aicut` | — |
| 2 | 托管 | GitHub 公开仓库 `teaxus/ai-cut`（AGPL 源码可得 + Releases 作更新源；可镜像到内网 Gogs） | 仅内网 Gogs（则更新源改 `generic` provider，且分发时要另行提供源码） |
| 3 | 数据目录 | 与上游隔离（`~/.ai-cut`），模型缓存共用 | 全共用 |
| 4 | 默认端口 | 5299（记忆文件独立） | 沿用 5199 |
| 5 | macOS 签名/公证 | 不签（同上游，首次打开需手动允许） | 提供 Developer ID 后开启 hardenedRuntime + 公证 + mac 应用内更新 |
| 6 | Linux 包 | 不做 | 按需打 x64 AppImage |
| 7 | 保留 Web（B/S）模式 | 保留（零成本，上游开发链路需要） | 禁用 |
| 8 | 版本号 | `<上游>-aicut.<N>` | 独立计数 |
| 9 | 开发会话 | 落实后在本会话继续（目录已加入） | 在 `/Users/teaxus/AILearning/ai-cut` 新开会话，从本文接手 |

## 12. 本轮产出

| 文件 | 内容 |
|---|---|
| `docs/PLAN.md` | 本文 |
| `docs/research/upstream-survey-v0.2.17.md` | Opus 调查报告（事实底座） |
| `docs/research/skills-cli-agents.md` | `vercel-labs/skills` 的 79 个 agent 技能目录表（MIT，已注明来源） |

调研中 Gemini 的三次问答（agent 配置路径、fork 维护做法、MCP 配置与 Pro）均未返回来源，只作线索；凡写进本文的路径都另有代码或文档依据，未核实的已标"待验"。
