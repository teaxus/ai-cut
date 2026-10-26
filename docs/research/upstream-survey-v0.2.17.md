# OpenChatCut v0.2.17 上游调查 —— 派生版 open-ai-cut 的事实底座

- 调查对象：`/Users/teaxus/ai_agent_playground/openchatcut/app`，HEAD `7fa4b79`（2026-10-21 "chore(build): upgrade TypeScript to 7"），`package.json:4` 版本 0.2.17。
- 方法：只读（读文件、`find | xargs grep`、`node -e` 解析 JSON、`gh api` 只读查询上游 GitHub）。**没有**运行 install / build / dev / desktop / 测试，也没有启动任何服务；所以"能不能跑"类结论都是代码 + 上游 CI/Release 证据，**本机未实测**。
- 本地仓库是 **depth=1 浅克隆**（`git rev-parse --is-shallow-repository` = true，`git log` 只有 1 个提交），`git log --since` 统计做不了。热点统计改用 GitHub API 拉取 2026-07-01 以来全部 1100 个提交的文件列表（除初始提交外 1097 个），原始数据在 `/private/tmp/claude-501/-Users-teaxus-ai-agent-playground/889dbd28-1851-4332-a544-a8f82b63cd4a/scratchpad/gh/`（`commits.tsv`、`commit-files.tsv`、`cf-dated.tsv`）。
- 标注约定："待验"= 推断或文档说法，未在代码里闭环证实；"判断"= 方案层面的权衡，不是事实。

## 结论摘要

1. **桌面版已经完整存在，并且上游每个版本都在发布**：Electron 主进程 + 内嵌 HTTP 服务（与 Web 共用同一套服务端插件）+ electron-builder 四平台打包 + electron-updater + CI 冒烟测试。v0.2.13–v0.2.17 每个 Release 都带 dmg/zip（arm64、x64）、NSIS exe、AppImage 和 latest-*.yml（`gh api releases`），安装包 555–776 MB。短板：macOS 包没有签名/公证（`README.md:260`），macOS 没有应用内自动更新（`desktop/update-service.ts:19-22`）。
2. **"必改"的上游文件最少 6 个**（含 1 个 verify、1 个二进制图标）：`src/ui/upstreamUpdate.ts`、`src/ui/upstreamUpdate.verify.ts`、`index.html`、`public/openchatcut-icon.png`、`src/components/icons.tsx`、`src/components/DashboardHeaderLinks.tsx`。另有 3 个"建议改"：默认语言、端口/数据目录隔离、聊天栏品牌字样。打包身份和更新源可以做成**新增**的 wrapper 配置文件，上游打包配置一行不动。
3. **最大的升级冲突风险是 `package.json`**：1097 个上游提交里有 306 个改了它（28%），近 30 天 54 次；`test:serial` 是单行 9279 字符、内含 195 个 verify。门禁又规定新增的 `*.verify.*` 必须登记到这里。只要改 scripts，几乎每次同步都会冲突。第二梯队：`server/plugins/index.ts`（66 次）、`desktop/main.ts`（60 次）、`settingsSchema.ts`（52 次）、`keystore-names.ts`（近 30 天 9 次）。战略层面的风险：上游写明了计划改成"TS UI + 插件系统 + C++ 后端"（`config/README.md` 末节）。
4. 数据根目录 `~/.openchatcut` 写死在约 10 处。派生版如果和上游装在同一台机器并同时运行，会共用项目库、MCP token 和端口记忆文件（判断：必须决定共用还是隔离）。
5. 许可：AGPL-3.0-or-later。内置 Agent Skills 来自 GPL-3.0-only 项目。**Remotion 不是开源许可**：个人和 ≤3 人的营利组织免费，规模更大的公司需要公司授权（`node_modules/remotion/LICENSE.md`）。代码里没有 Pro/License 门控。

---

## A. 桌面版（Electron）架构

### 1. 内嵌服务、端口、MCP、同源校验、preload

#### 1.1 启动链路

| 步骤 | 做什么 | 证据 |
|---|---|---|
| 入口 | Electron `main` = `desktop-dist/main.mjs`（由 `desktop/bootstrap.ts` 打包）；先把 V8 堆上限调到 6 GB，再 `await import('./app-main.mjs')`，加载失败时弹双语错误框 | `package.json:9`、`package.json:69`、`desktop/bootstrap.ts:23,25-47` |
| 切 cwd | 打包态先 `process.chdir(userData)`，让 `.env.local` 和默认上传目录落在可写区 | `desktop/chdir-first.ts:8-12`、`desktop/main.ts:1` |
| 单实例 | 按 profile 区分单实例锁（isolated dev 会把 userData 改到 profile 目录下） | `desktop/main.ts:453-462`、`desktop/runtime-profile.ts:10-25` |
| 资产预检 | 打包态检查 `resources/dist/index.html`、`resources/remotion-bundle/index.html`、chrome-headless-shell（可选），Windows 另查 ffmpeg | `desktop/main.ts:331-345`、`desktop/runtime-preflight.ts:34-54` |
| 渲染运行时 | 把 remotion bundle 复制到 `userData/remotion-bundle-<ver>`，定位 headless shell，把 compositor 镜像到 userData；通过环境变量传给渲染器 | `desktop/packaged-runtime.ts:33-62` |
| 内嵌服务 | `startEmbeddedServer(DIST_DIR)`：`node:http` + MiniConnect 路由；**把整套 `serverPlugins({ projectStoreHttp: true })` 原样挂上**（用假的 ViteDevServer，只提供 `middlewares.use`、`httpServer`、`config.logger`），最后挂静态资源 `/media/uploads` 和 `dist/` | `desktop/embedded-server.ts:74-119`、`desktop/mini-connect.ts:1-81`、`desktop/static-files.ts:50-77` |
| 开发态旁路 | 设了 `CC_DESKTOP_DEV_URL`（必须是 loopback）时直接加载 Vite 开发服务器，不起内嵌服务 | `desktop/page-origin.ts:48-67`、`desktop/main.ts:346-351` |
| IPC | `registerDesktopHandlers`、`installProjectStoreIpc`、`installEditorAuthIpc`、`installDesktopUpdateIpc`、`installDirectoryWatchIpc`、agent 本地媒体/路径导入、`installDesktopInferenceIpc`，全部绑定 trustedOrigin | `desktop/main.ts:352-399` |
| 窗口 | `contextIsolation: true`、`nodeIntegration: false`、`backgroundThrottling: false`（保证 MCP bridge 心跳）；`loadURL(origin + '/')` | `desktop/main.ts:413-442` |

**"同一套 Vite/h3 插件代码？"**：是同一套代码，但没有用 h3。插件全部是 Vite 的 `configureServer` + Connect 风格中间件。Web 开发时 Vite 原生挂载（`config/vite.config.ts:150`）；桌面版用 MiniConnect 冒充 ViteDevServer 挂载（`desktop/embedded-server.ts:88-103`）。约束是插件只能依赖 `middlewares.use` 和 `config.logger`（`desktop/embedded-server.ts:3-4,87`）。

#### 1.2 端口

| 宿主 | 策略 | 证据 |
|---|---|---|
| 桌面打包态 | 先用**上次成功的端口**（`~/.openchatcut/mcp-port`），其次规范端口 **5199**，都被占时取随机端口并记住；只绑定 `127.0.0.1` | `desktop/embedded-port.ts:7,22-27,66-105`、`desktop/embedded-server.ts:109-118` |
| 桌面 isolated dev | 端口记忆在 `~/.openchatcut/dev-profiles/<uuid>/mcp-port` | `desktop/embedded-port.ts:23-25` |
| Web dev（`npm run dev`） | 固定 5199、`strictPort: true`（被占用就直接启动失败） | `config/vite.config.ts:152-153` |

所以如果桌面 App 先启动占住了 5199，`npm run dev` 会起不来；反过来，桌面会退到随机端口并把它记住（待验：没有实测并发场景）。

#### 1.3 外部 MCP 端点：URL、token、发现方式

| 项 | 事实 | 证据 |
|---|---|---|
| 路径 | `/api/external-mcp/mcp`（Streamable HTTP），桌面和 Web 都挂 | `server/plugins/external-agent.ts:139-148` |
| 桌面 URL | `http://127.0.0.1:<端口>/api/external-mcp/mcp`；设置页显示的 endpoint = `window.location.origin + '/api/external-mcp/mcp'` | `desktop/embedded-server.ts:118`、`src/components/settings/McpGuide.tsx:218` |
| 鉴权 | **必须**带 `Authorization: Bearer <token>`，否则 401 `invalid OpenChatCut MCP token` | `server/plugins/external-agent.ts:140-142`、`server/editor-auth.ts:46-48` |
| token 来源 | `OPENCHATCUT_MCP_TOKEN` 环境变量优先；否则读写 `~/.openchatcut/mcp-token`（43 字符 base64url，0600，首次生成后持久化，`wx` 排他创建防并发） | `server/editor-auth.ts:14-37`、`server/mcp-token.ts:23-85` |
| 渲染端怎么拿到 token | 桌面走 IPC `openchatcut:editor-credentials`；Web 走 `POST /api/external-agent/bootstrap`（同源 + 自定义头） | `shared/editor-auth-transport.ts:1`、`desktop/editor-auth-ipc.ts:7-12`、`src/agent/editor-credential.ts:12-22`、`server/plugins/external-agent.ts:69-84` |
| 外部 agent 怎么发现 | **没有自动发现协议**。① 文档约定默认 5199；② 设置 → MCP 页面显示 endpoint 和 token，可以复制；③ 一键「连接」把配置写进客户端配置文件（见 C.7）；④ 外部 skill 指导 agent 去设置页复制。`~/.openchatcut/mcp-port` 和 `mcp-token` 是本机状态文件，不是公开的发现接口（待验：agent 直接读这两个文件是否被支持） | `skills/openchatcut/references/getting-started.md:14-16`、`server/external-agent/client-connect.ts:1-5` |
| 远程暴露 | `OPENCHATCUT_EDITOR_URL` + `OPENCHATCUT_MCP_TOKEN` | `README.md:444-452`、`server/editor-auth.ts:55-65` |
| 坑 | 仓库根目录的 `.mcp.json` 没有带 Authorization（`.mcp.json:1-12`），按代码会 401；上游自己在注释里提到过同名 `openchatcut` 服务鉴权失败会被 Claude Code 缓存 | `server/claude-code/turn-runner.ts:33-43` |
| 文档滞后 | 外部 skill 的文档仍写"重启会换 token"（`skills/openchatcut/references/getting-started.md:99-102`），但代码已经持久化 token（`server/mcp-token.ts:36-46`） | 同左 |

#### 1.4 "invalid request origin"：同源校验机制

信任模型是"本机设备信任、无共享密钥"（`server/project-store-http-auth.ts:5-25`）：

| 层 | 规则 | 证据 |
|---|---|---|
| 全局写入闸 `requestShapeGatePlugin` | 第一个注册（`server/plugins/index.ts:66`），挂在 `/`。GET/HEAD/OPTIONS 直接放行；其余请求只在以下情况放行：① `/api/external-mcp/mcp` 且 Bearer 正确；② `/upload?handoff=…`（一次性上传令牌）；③ `projectStoreHttpAuthorized`。否则 403 `{"error":"invalid request origin"}` | `server/plugins/request-shape-gate.ts:12-23,31-48` |
| `projectStoreHttpAuthorized` | socket 是 loopback **且** Host 是 loopback 主机名（防 DNS rebinding）**且** `Sec-Fetch-Site` ∈ {same-origin, none} **且** `Origin` 的 host 等于 Host | `server/project-store-http-auth.ts:46-76` |
| 编辑器端点（上传、模型包、bridge） | `trustedEditorRequest`：loopback socket + Host 属于 localhost/127.0.0.1/[::1]（或等于 `OPENCHATCUT_EDITOR_URL`）+ Origin 精确匹配；读请求可以不带 Origin | `server/editor-auth.ts:67-103` |
| 桌面 IPC | 每个 handler 都校验 `event.senderFrame.url` 的 origin 等于内嵌服务 origin；导航和弹窗只允许同源，外链交给系统浏览器 | `desktop/page-origin.ts:19-46`、`desktop/main.ts:98-143` |

对派生版的影响（推断，待验）：非浏览器客户端（curl、自写 CLI）对写接口发 POST 时，必须**自己带上** `Origin: http://127.0.0.1:<port>` 和 `Sec-Fetch-Site: same-origin|none`，因为 `Sec-Fetch-Site` 缺失时判定为 false（`server/project-store-http-auth.ts:62-65`）。注释里说"curl sends `none`"与代码不符。

#### 1.5 preload 暴露的 API

`contextBridge.exposeInMainWorld('openChatCutDesktop', api)`（`desktop/preload.ts:265`），接口定义在 `desktop/preload.ts:86-120`。渲染端在 `src/desktop-api.d.ts:59-96` **手写了一份重复的类型声明**。渲染端有 24 个非测试文件使用 `window.openChatCutDesktop`。

| 分组 | 方法 |
|---|---|
| 文件/目录 | `getPathForFile`、`platform`、`selectDirectory`、`selectExportDirectory`、`selectExportFile`、`restoreExportDirectory`、`revealExport` |
| 媒体导入 | `importLocalMedia`、`prepareTransparentMovProxy`、`start/activate/acknowledge/stopImportDirectoryWatch`、`subscribeImportDirectory`、`importAgentPaths`、`browseLocalMedia` |
| 窗口 | `windowAction`、`zoomStep`、`subscribeUiScale`、`openTranscriptWindow`、`subscribeTranscriptWindow`、`requestTranscriptWindowPayload` |
| 数据/凭据 | `projectStore`（项目库走 IPC）、`editorCredentials`（MCP token） |
| `updates` | `getState`、`check`、`download`、`install`、`subscribe` |
| `inference` | `getCapabilities`、`setEnabled`、`preloadAsr`、`transcribe`、`semantic`、`clap`、`rhythm`、`cancel`、`subscribeProgress` |

没有通用的 `invoke(channel)` 透传，也没有通道白名单数组；每个 API 都是手写的固定对象（`desktop/preload.ts:136-263`）。

### 2. 渲染与二进制

| 二进制/资源 | 来源 | 按平台怎么准备 | 打包方式 | 运行时定位 |
|---|---|---|---|---|
| ffmpeg | npm `ffmpeg-static` 5.3.0（postinstall 下载宿主平台二进制） | 只有宿主平台，所以上游在各自平台的 runner 上分别打包（`.github/workflows/desktop.yml:53-84`） | `asarUnpack: node_modules/ffmpeg-static/**`（`config/electron-builder.config.mjs:105`） | `server/media-binaries.ts:33-38`（`OPENCHATCUT_FFMPEG`/`FFMPEG_PATH` 可覆盖，asar 路径改写为 unpacked） |
| ffprobe | npm `@ffprobe-installer/ffprobe` 2.1.2 + 平台子包 | 同上 | `asarUnpack @ffprobe-installer/**`（`:106`） | `server/media-binaries.ts:40-45` |
| Remotion compositor（含渲染用 ffmpeg/ffprobe） | npm `@remotion/compositor-<平台>`（renderer 的 optionalDependency） | 交叉打包时用 `npm pack` 补装目标平台包（`desktop/prepare-target.mts:72-92`）；打包时只保留目标平台（`config/electron-builder.config.mjs:23-32,94`） | `asarUnpack @remotion/compositor-*/**`；**首次启动镜像到** `userData/remotion-binaries-<ver>[-hardware]`，因为 renderer 要对解析到的路径 chmod/spawn | `desktop/remotion-binaries.ts:102-131`、`desktop/packaged-runtime.ts:53-61` |
| Chrome Headless Shell | Chrome for Testing CDN（`storage.googleapis.com/chrome-for-testing-public/<ver>/…`），版本取 `node_modules/.remotion/chrome-headless-shell/VERSION`，兜底 149.0.7790.0 | `desktop/prepare-target.mts:19,54-69`；CI 先跑 `ensureBrowser()`（`desktop.yml:100-101`） | `extraResources desktop-dist/chrome-headless-shell`（`config/electron-builder.config.mjs:119`） | `desktop/packaged-runtime.ts:11-24,51-52` → `CC_BROWSER_EXECUTABLE` |
| Remotion serve bundle | 构建期 `desktop/prebuild-remotion.mts` 预打包（打包产物里没有 src 和 webpack） | — | `extraResources desktop-dist/remotion-bundle`（`:118`）；首次启动复制到 userData | `desktop/packaged-runtime.ts:33-50` → `CC_REMOTION_BUNDLE` |
| whisper-cli / whisper-server（原生 ASR） | whisper.cpp v1.9.2：**macOS 从源码编译**（git clone + cmake + Metal）；win/linux 用官方 release 资产，并固定 size + sha256 | `scripts/sync-whisper-cli.mjs:1-69,276-296`（在 predev/prebuild 里运行，`package.json:23,29`） | 输出到 `public/whisper-cli/<plat>/` → Vite 复制进 `dist` → `extraResources dist` | `server/media-binaries.ts:53-68`（`OPENCHATCUT_WHISPER_CLI` 可覆盖）；`desktop/native-asr-worker.ts:2`（server 常驻，cli 兜底） |
| onnxruntime-node 1.22.0-rev | npm（一个包含所有平台；Linux x64 postinstall 会从 NuGet 下载 CUDA EP） | 打包时过滤掉非目标平台（`config/electron-builder.config.mjs:27-48`） | `asarUnpack onnxruntime-node/**`（`:108`） | 原生推理 worker 由 `utilityProcess.fork` 启动（`desktop/native-asr-service.ts:97-110`） |
| sqlite-vec | npm `sqlite-vec-<平台>` | 只保留目标平台（`:51-64`） | `asarUnpack sqlite-vec-*/**`（`:109`） | `node:sqlite` 扩展（`server/storage/sqlite-store.ts:7`） |
| MediaPipe | npm `@mediapipe/tasks-vision` 的 wasm + 2 个 tflite 模型（从 storage.googleapis.com 下载，固定 sha256） | `scripts/sync-mediapipe.mjs:11-73` | `public/mediapipe` → dist | 浏览器侧 |
| GitHub Copilot CLI | npm `@github/copilot-<平台>`（经 `@github/copilot-sdk`；koffi 是 sdk 的依赖） | — | `asarUnpack @github/copilot-*/**`、`koffi/**`（`:110-111`） | `server/copilot/client.ts` |
| capcut-cli（剪映草稿导出） | **不打包**，运行时 `npx --yes capcut-cli@0.26.0` | — | — | `server/external-agent/capcut-command.ts:14-21`（推断：用户机器上没有 npx 时这个功能不可用，待验） |

**模型：运行时下载为主**

| 模型 | 方式 | 证据 |
|---|---|---|
| ASR（Whisper ONNX：tiny/base/small/medium/large-v3-turbo，+ 对应 GGML 给 whisper.cpp） | 运行时下载，固定 revision + 逐文件 sha256 | `shared/asr-models.ts:47-140` |
| 模型包：rhythm-lite（musetric/beat-this-onnx）、music-semantics-lite（Xenova/clap-htsat-unfused，约 34 MB）、visual-semantics-lite（Xenova/chinese-clip-vit-base-patch16，约 178 MB） | 运行时下载 | `shared/model-packs/catalog.ts:54-160` |
| 下载源顺序 | modelscope → huggingface → hf-cdn.sufy.com → hf-mirror.com | `server/plugins/hf-proxy.ts:31-53` |
| 缓存位置 | `~/.openchatcut/asr-models` | `shared/model-cache-path.ts:3-5`、`server/plugins/hf-proxy.ts:103-105` |
| 随包内置 | silero_vad.onnx（`public/models/silero-vad/`，在 git 里）、MediaPipe 两个 tflite（构建时同步） | 目录实物、`scripts/sync-mediapipe.mjs:20-33` |

### 3. 打包与更新

#### 3.1 `config/electron-builder.config.mjs` 要点

| 字段 | 值 | 行 |
|---|---|---|
| appId / productName / artifactName | `dev.openchatcut.app` / `OpenChatCut` / `${productName}-${version}-${arch}.${ext}` | 69-71 |
| 输出、压缩 | `release/`、`compression: 'maximum'` | 72-77 |
| publish（更新源） | `github` / owner `0xsline` / repo `OpenChatCut` / channel 按架构分 `latest-arm64` / `latest-x64` | 65,78-83 |
| files | 只放 `desktop-dist/{main,app-main,preload}`、4 个 native worker、package.json，加平台过滤规则 | 84-99 |
| asar / asarUnpack | `asar: true`；unpack 的是 ffmpeg-static、@ffprobe-installer、compositor、onnxruntime-node、sqlite-vec、@github/copilot-*、koffi | 100-112 |
| extraResources | `dist`（排除 `media/uploads`）、`remotion-bundle`、`chrome-headless-shell` | 113-120 |
| mac | dmg + zip；icon `assets/branding/openchatcut-icon.icns`；entitlements 开了 JIT、unsigned memory、禁用 library validation；**有 `CSC_LINK`/`CSC_NAME` 才启用 hardenedRuntime，否则 `identity: '-'` 做 ad-hoc 签名** | 66,122-135；`desktop/entitlements.mac.plist` |
| 公证 | 配置里**没有** notarize 字段。按 electron-builder 文档，环境里有 APPLE_* 凭据时会自动公证（待验）；上游 workflow 里没有任何签名/公证 secret | `.github/workflows/*.yml`（grep 不到 CSC_/APPLE_） |
| win | NSIS，`oneClick: false`，允许改安装目录；icon `public/openchatcut-icon.png`；没有证书时会触发 SmartScreen（`:17-18`） | 136-143 |
| linux | AppImage；`executableName: 'openchatcut'`；`syncDesktopName` 配合 `package.json:13` 的 `desktopName` | 144-152 |
| 交叉目标 | 由 `CC_EB_TARGET` 选择（`package.json:74-79` 的 `desktop:dist*` 脚本会设置它） | 31 |

#### 3.2 更新服务

| 场景 | 更新源/机制 | 证据 |
|---|---|---|
| Windows / Linux 打包态 | `electron-updater` 的 `autoUpdater`，读取 electron-builder 按 publish 生成的 app-update.yml，即 **GitHub Releases `0xsline/OpenChatCut`**；手动下载、手动安装，不允许降级和预发布 | `desktop/update-ipc.ts:1-31`、`desktop/update-service.ts:48-52` |
| macOS 打包态 | **不支持应用内更新**（`supportsDirectDesktopUpdates` 只放行 win32/linux），由渲染端调 GitHub API 查最新版并提示"前往发布页" | `desktop/update-service.ts:19-22`、`desktop/update-service.verify.ts:59` |
| Web / macOS 渲染端检查 | `https://api.github.com/repos/0xsline/OpenChatCut/releases/latest`，"前往"按钮打开 `https://github.com/0xsline/OpenChatCut/releases/latest`；用 semver 比较，带预发布段的版本算更低 | `src/ui/upstreamUpdate.ts:6-7,48-118,207,300` |
| 发布流水线 | `desktop.yml` 只能手动触发；在 v* tag 上跑时，四平台打包 + 安装后冒烟 + 校验资产 + 建 draft release + 核对 SHA256 + 发布 | `.github/workflows/desktop.yml:1-454` |

#### 3.3 派生版换成自己的更新源要改哪几处

| # | 位置 | 改什么 | 能否不改上游（判断） |
|---|---|---|---|
| 1 | `config/electron-builder.config.mjs:78-83` | publish 的 owner/repo（不在 GitHub 上时改用 `generic` provider） | **能**：新增 wrapper 配置 `import base from './electron-builder.config.mjs'` 后覆盖 publish/appId/productName/icon/executableName；`CC_EB_TARGET` 在上游模块求值时读取，wrapper 自动继承（`:31`） |
| 2 | `src/ui/upstreamUpdate.ts:6-7` | 两个 URL 常量（mac + web 的检查和"前往"） | **不能**：没有 env 覆盖 → 必改，连带 `src/ui/upstreamUpdate.verify.ts:24` |
| 3 | `desktop/update-packaging.verify.ts:25-31,160-230` | 断言 publish = 0xsline，并断言 desktop.yml 里的 `OpenChatCut` 路径 | 用 wrapper + 独立 workflow 时**不用改**（这个 verify 只读上游配置和上游 desktop.yml） |
| 4 | `.github/workflows/desktop.yml:152-175,202,344-346` | 写死了 `OpenChatCut.app`、`OpenChatCut.exe`、`OpenChatCut-${ver}-*.blockmap` | 新增派生自己的 workflow；上游这个文件只能手动触发，可以原样保留 |
| 5 | `desktop/update-service.ts:19-22` + verify `:59` | 如果要 macOS 应用内更新 | 需要 Developer ID 签名 + 公证，再改这两处 |
| 6 | `skills/openchatcut/SKILL.md:52-58`、`references/known-errors.md:61` | 外部 skill 的更新命令指向 0xsline | 可选 |

版本号相关的坑（判断）：渲染端用 `package.json` 的版本（`config/vite.config.ts:11,134`）和 release tag 做 semver 比较（`src/ui/upstreamUpdate.ts:89-97`）。`scripts/issue-template-version.verify.mjs:32-39` 要求 issue 模板的版本下拉框跟 `package.json` 一致。派生版改 `package.json` 版本号就会同时撞上冲突和这个门禁；用 `-oac.N` 这类预发布后缀，又会被判定为"比上游同号版本旧"。

### 4. 双宿主差异与数据目录

#### 4.1 插件注册方式

`server/plugins/index.ts:63-373` 的 `serverPlugins()` 返回一个**静态数组**（约 50 个插件，配置项是"从 keystore 实时读取的 getter"）。只有两个调用方：
- Web/dev：`config/vite.config.ts:150` 的 `plugins: [..., ...serverPlugins()]`
- 桌面：`desktop/embedded-server.ts:99-103` 遍历调用 `configureServer`

两边唯一的参数差异是 `projectStoreHttp: true`。`projectStorePlugin` 只在 `http === false` 时不挂载，所以两边实际都挂了（`server/plugins/project-store-plugin.ts:78-83`）。

#### 4.2 两种宿主的差异点

| 差异 | Web（Vite） | 桌面（Electron） | 证据 |
|---|---|---|---|
| 端口 | 5199 strict | 记忆端口 → 5199 → 随机 | `config/vite.config.ts:152-153`、`desktop/embedded-port.ts:66-105` |
| AssemblyAI 代理 | Vite `server.proxy` | 手写代理 + 先做同源授权 | `config/vite.config.ts:165-178`、`desktop/embedded-server.ts:38-72` |
| 静态资源 | Vite + `productAssetsPlugin` | `distStaticMiddleware` + `uploadsMiddleware`；`registerProductAssetRoot(resources/dist)` | `server/product-assets.ts:114-160`、`desktop/static-files.ts:50-77`、`desktop/embedded-server.ts:76` |
| cwd / 设置文件 | 检出目录 `.env.local` | 打包态 `userData/.env.local` | `desktop/chdir-first.ts:8-12`、`server/runtime-profile.ts:153` |
| 渲染端能力 | 无 `window.openChatCutDesktop` | 有：项目库走 IPC、原生推理、目录监听、导出目录授权、文字稿浮窗 | `src/persist/projectStoreTransport.ts:87-108`、`desktop/preload.ts:86-120` |
| 更新 | GitHub API 提示 | win/linux 用 electron-updater；mac 同 Web | §3.2 |
| Agent 本地路径访问 | 必须配置 `AGENT_IMPORT_ROOTS` 白名单 | 默认不限制 | `README.md:300-304` |
| 运行时 profile | `default` / `isolated-dev`（由 `OPENCHATCUT_DEV_PROFILE_ID` 决定） | 同一套逻辑，isolated 时 userData 也隔离 | `server/runtime-profile.ts:5-6,123-161`、`desktop/runtime-profile.ts:10-25` |

#### 4.3 数据目录与 dev-profiles

| 数据 | 打包桌面（default） | `npm run dev` / `desktop:dev`（isolated） | `dev:shared` | 证据 |
|---|---|---|---|---|
| 项目库 SQLite | `~/.openchatcut/project-store-v1.sqlite3` | `~/.openchatcut/dev-profiles/<uuid>/…` | `~/.openchatcut` | `server/runtime-profile.ts:131-160`、`server/storage/sqlite-store.ts:29` |
| 设置/密钥 | `userData/.env.local` | `<profile>/settings.env` | 检出目录 `.env.local` | `server/runtime-profile.ts:140,153` |
| 媒体 uploads | `userData/public/media/uploads`（`MEDIA_DIR` 或数据目录可改） | `<profile>/media/uploads` | `public/media/uploads` | `server/runtime-profile.ts:138,151`、`server/media-dir.ts:60-66` |
| MCP token / 端口记忆 | `~/.openchatcut/mcp-token`、`mcp-port` | `<profile>/` 下 | 同 default | `server/mcp-token.ts:23-28`、`desktop/embedded-port.ts:22-27` |
| 数据目录指针 | `~/.openchatcut/data-dir.json`（设置页"数据目录"写这里；isolated 时忽略） | 忽略 | 同 default | `server/data-dir.ts:16-54`、`server/runtime-profile.ts:96-121` |
| 用户技能 / 内容插件 | `~/.openchatcut/skills`、`~/.openchatcut/plugins` | **不分 profile** | 同 | `server/skills-files.ts:17-20`、`server/plugins/extension-store.ts:8` |
| 模型缓存 | `~/.openchatcut/asr-models` | 不分 profile | 同 | `shared/model-cache-path.ts:3-5` |
| Codex / Copilot 隔离 home | `~/.openchatcut/codex`、`~/.openchatcut/copilot` | 不分 profile | 同 | `server/codex/app-server.ts:12`、`server/copilot/client.ts:12` |
| Electron userData | mac：`~/Library/Application Support/OpenChatCut/` | `<profile>/electron-user-data` | 默认 | `README.md:304`、`desktop/runtime-profile.ts:14-15` |

dev-profiles 是什么：`scripts/dev-profile.mjs` 按 git 检出生成 UUID，存在 `<gitdir>/openchatcut-dev-profile.json`（`:11,134-154`），创建 `~/.openchatcut/dev-profiles/<uuid>/{electron-user-data,project-store-auth-v1,media/uploads,project-store-v1}`（`:107-123`），然后带 `OPENCHATCUT_DEV_PROFILE_ID` 环境变量启动 Vite 或 `--exec` 的命令（`:214-301`）。效果是每个检出和 worktree 的项目、凭据、媒体互不干扰（`README.md:286-290`）。

---

## B. 构建与验证工具链

### 5. scripts 分类、测试机制、门禁、CI

`package.json:17-93` 共 75 个 scripts：

| 类别 | 数量 | 脚本 |
|---|---|---|
| dev | 7 | `dev` / `dev:isolated`（= `scripts/dev-profile.mjs`）、`dev:shared`（裸 Vite，共享库）、对应的 `pre*` 钩子（同步 mediapipe/whisper，检查工具目录）、`preview` |
| build | 5 | `prebuild`（检查 shader 源 + 同步 mediapipe + 同步 whisper-cli + 检查工具目录）、`build` = `tsc -b && vite build`、`build:cli`、`generate:server-tool-catalog`、`update:model-capabilities` |
| desktop | 11 | `desktop:build:main`（esbuild 打 7 个 bundle）、`desktop:dev`（isolated profile 里跑 `desktop:dev:shared`）、`desktop:smoke`（`CC_SMOKE=1`）、`desktop:prebundle`、`desktop:prepare`、`desktop:dist`（mac arm64）、`:local`（`--dir`）、`:mac-x64`、`:win`、`:linux` |
| test | 5 | `pretest`（27 个 `npm run verify:*` 组 + 10 个直接 `tsx`）→ `test` = `node scripts/run-tests.mjs` → `posttest`（5 组）；`test:serial`（单行 195 个 verify）；`test:contrib-timeline-preview` |
| verify | 42 | `verify:*`（按领域分组：mcp、desktop-window、desktop-update、i18n、skills、agent-tools 等）、`verify:affected` |
| sync | 3 | `sync:mediapipe`、`sync:whisper-cli`、`sync:shader-sources` |
| 其他 | 2 | `lint`（oxlint）、`occ`（CLI） |
| release | 0 | package.json 里没有发布脚本；发布由 `.github/workflows/desktop.yml` 手动触发 |

**测试机制**

| 机制 | 事实 | 证据 |
|---|---|---|
| 怎么发现 verify | **不扫描目录**：`run-tests.mjs` 读 `test:serial`，按 `&&` 切分，以 4 并发（`TEST_CONCURRENCY`，上限 8）每段起一个子进程 | `scripts/run-tests.mjs:16-22,30-57` |
| 门禁 1：verify 必须被运行 | 磁盘上每个 `*.verify.{tsx,mts,cjs,mjs,ts,js}`（排除 node_modules 和点目录）都必须出现在展开后的 `pretest + test:serial + posttest` 链里；**故意不设白名单** | `scripts/verify-gate-coverage.verify.mjs:1-11,22-69` |
| 门禁 2：登记双向一致 | 每个 git 跟踪的 verify 都要在某个 script 里出现；script 里点名的 verify 也必须被 git 跟踪 | `scripts/verify-registration.verify.mjs:25-59` |
| 门禁 3：500 行上限 | 所有已跟踪和未忽略的源码文件（ts/tsx/mts/cjs/mjs/js，不含 verify/check/test/spec/.d.ts）必须 ≤500 行（只豁免两个字典文件） | `scripts/verify-gate-coverage.verify.mjs:94-114` |
| 门禁 4：CI 结构 | 断言 `ci.yml` 有 pull_request 触发，并且有 macOS 的 frame-sync 任务 | `scripts/verify-gate-coverage.verify.mjs:78-92` |
| 门禁 5：i18n | 每个 `t('中文')` 都要有英文词条；`.tsx` 里不能裸渲染中文 | `scripts/check-i18n.mjs:123-141,284-353` |
| 门禁 6：工具目录 | 生成的 `assets/agent/openchatcut-tool-schemas.json` 必须和源码一致（`--check`） | `package.json:21-22` |
| 门禁 7：外部 skill | `skills/openchatcut/SKILL.md` 的 frontmatter 必须是 `name: openchatcut`，版本必须等于 `OPENCHATCUT_SKILL_BASELINE` | `server/external-agent/external-skill.verify.mjs:11-23`、`server/external-agent/mcp.ts:55` |
| 门禁 8：issue 模板版本 | bug 模板版本下拉框的第一项必须是当前 `package.json` 版本 | `scripts/issue-template-version.verify.mjs:32-39` |
| 源码正则断言 | `desktop.verify.ts` 用正则检查 `main.ts` 源码（`backgroundThrottling:false`、单实例锁和 GPU 回退顺序、浮窗 payload） | `desktop/desktop.verify.ts:116-127` |
| "新源码必须配 verify"？ | **没有强制**，只有 README 约定"非平凡逻辑加可执行检查"；强制的是"verify 必须登记" | `README.md:596-597` |
| 日常增量 | `verify:affected` 按改动文件就近挑 verify；改 `package.json`、`config/`、`shared/`、`assets/`、`public/`、`.github/` 时要求跑全量 | `scripts/run-affected-verifies.mjs:1-23` |

`.gitignore` 的相关约束：`/scripts/*` 默认忽略，只放行 `sync-mediapipe.mjs` 和 `*.verify.mjs`（`.gitignore:83-93`）；`CLAUDE.md`、`AGENTS.md`、`.claude/`、`docs/` 全部忽略（`:60-71`）。

**CI（`.github/workflows`）**

| workflow | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | PR、v* tag、手动 | Ubuntu：`npm ci`（跳过 ORT CUDA）+ apt ffmpeg + tag 和版本一致性校验 + lint + `npm test` + `verify:agent-skill` + build；macOS-15：3 个帧同步渲染校验（`ci.yml:27-83`） |
| `desktop.yml` | 仅手动 | validate（同 CI）→ 四平台矩阵打包 → 安装后冒烟（mac 挂载 DMG 并检查 zip 结构；Win 静默安装、`CC_SMOKE_MCP_RECOVERY`、卸载；Linux 用 xvfb 跑 AppImage）→ tag 时：校验资产 → draft → 上传 → 核对 SHA256 → 发布（`desktop.yml:17-454`） |
| `windows-{mcp-recovery,model-persistence,server-render,whisper-runtime}.yml` | 手动 + PR/push（按路径过滤） | Windows 专项回归 |

### 6. 构建环境要求

| 项 | 要求 | 证据 |
|---|---|---|
| Node | `>=24 <25`；`.nvmrc` = 24（本机 v24.15.0） | `package.json:14-16`、`.nvmrc` |
| 依赖实测版本（node_modules） | electron 43.8.3、electron-builder 26.15.7、electron-updater 6.8.9、@remotion/renderer 4.0.537、onnxruntime-node 1.22.0-rev、vite 8.3.5、typescript 7.0.2 | `node -e` 读取 package.json |
| macOS | whisper.cpp **需要从源码编译**：git + cmake（+ Xcode CLT，待验），否则 `prebuild` 失败（exitCode=1），会挡住 `npm run build`；可以用 `OPENCHATCUT_WHISPER_CLI` 指定现成二进制。本机 `public/whisper-cli/darwin-arm64/` 已有带 provenance 的产物 | `scripts/sync-whisper-cli.mjs:4-6,276-296,364-411` |
| macOS 签名 | 有 `CSC_LINK`/`CSC_NAME` 就走正式证书 + hardenedRuntime，否则 ad-hoc；公证见 §3.1（待验）；上游发布的包没签名、没公证 | `config/electron-builder.config.mjs:66,128-135`、`README.md:260` |
| Linux | `npm install` 会从 NuGet 下载几百 MB 的 ORT CUDA EP，用 `ONNXRUNTIME_NODE_INSTALL=skip` 跳过；Chrome for Testing 只有 x64，所以桌面 Linux 只支持 x64 | `README.md:266`、`ci.yml:37-42`、`desktop/prepare-target.mts:35-37` |
| Windows | 没有证书会触发 SmartScreen；上游在 Windows runner 上原生打包 | `config/electron-builder.config.mjs:17-18`、`desktop.yml:71-77` |
| 网络 | npm、storage.googleapis.com（Chrome for Testing + MediaPipe 模型）、github.com（whisper.cpp）、NuGet（Linux） | 上面各脚本 |
| 测试 | 系统 ffmpeg（CI 用 apt 或 brew 安装） | `ci.yml:43-44,73-74` |

`MACOS-RENDER-TUNING.md` 要点：M4 Max 上 4K/60 HEVC 纯视频片段，4 个渲染 worker 比自动选择的 13 个快约 26–28%；1 个 worker 最慢，2 和 4 相差约 3%。作者明确说"4 只是临时的本地选择，不改任何平台的默认值"。调参用 `OPENCHATCUT_RENDER_CONCURRENCY=4`，注意 isolated profile 里已保存的 `settings.env` 会覆盖 shell 变量（`MACOS-RENDER-TUNING.md:17-56,58-64`）。

---

## C. 现有的"装进 agent"能力

### 7. 外部 skill（router）与各模块职责

**`skills/openchatcut/` 结构**：`SKILL.md`（router，59 行）、`references/{getting-started,editing-workflow,known-errors}.md`、`agents/openai.yaml`（Codex 的界面元数据，并声明 MCP 依赖：streamable_http + `localhost:5199`）、`assets/openchatcut-icon.png`。

| 问题 | 事实 | 证据 |
|---|---|---|
| router 是什么 | 唯一的对外入口 skill，只做路由：安装/连接 → getting-started；编辑 → editing-workflow；报错 → known-errors。专项指导**留在运行中的编辑器里**，通过 MCP 工具 `load_skill` 按需加载 | `skills/openchatcut/SKILL.md:8-42` |
| 安装 | `npx skills add 0xsline/OpenChatCut`（第三方 skills CLI，装到各 agent 的 skills 目录；具体目录待验），然后对 agent 说 "Set up OpenChatCut" | `README.md:331-339` |
| "Set up" 时写了什么 | router 本身**不写文件**，由 agent 按 getting-started 执行：Codex 运行 `codex mcp add openchatcut --url … --bearer-token-env-var OPENCHATCUT_MCP_TOKEN`（写 `~/.codex/config.toml`）；Claude Code 运行 `claude mcp add --transport http -H "Authorization: Bearer <token>" openchatcut <url>`（写 `~/.claude.json`）。token 需要用户从设置页复制 | `skills/openchatcut/references/getting-started.md:18-56` |
| "26 个专项 skill" | 内置在 `src/agent/skills/<slug>/SKILL.md`，用 `import.meta.glob('./*/**/*', ?raw)` 自动收集；**目录实际有 30 个**，verify 也钉死是 30；README 说的 26 可能是口径不同（待验） | `src/agent/skills/plugin-skills.ts:9-38`、`src/agent/skills/skill-loading.verify.ts:49` |
| skill 版本基线 | MCP 服务公布 `OPENCHATCUT_SKILL_BASELINE = '2026-09-04.1'`，提示用户 `npx skills update openchatcut` | `server/external-agent/mcp.ts:55,198-202`、`server/external-agent/mcp-instructions.ts:4-8` |

**应用内的一键连接**：设置 → MCP（`McpGuide.tsx`）有「连接」按钮，调用 `POST /api/external-agent/connect-client`（`src/components/settings/McpGuide.tsx:27-72,109-125`、`server/plugins/external-agent.ts:115-126`）。各客户端写入位置：

| 客户端 | 写入位置 | 形式 | 证据 |
|---|---|---|---|
| Claude Code | `~/.claude.json` 的 `mcpServers.openchatcut` | `{type:'http', url, headers:{Authorization:'Bearer …'}}` | `server/external-agent/client-connect.ts:117-119,143` |
| Cursor | `~/.cursor/mcp.json` | 同上 | `:144` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `{httpUrl, headers}` | `:145,273-275` |
| Qoder | `~/.qoder/settings.json`，以及**已安装时**的 `~/.qoder-cn/settings.json`（都不存在时只建 `.qoder`） | 同 Claude 形式 | `:138-155`、`README.md:400-423` |
| Codex | 调用 `codex mcp add openchatcut --url … --bearer-token-env-var OPENCHATCUT_MCP_TOKEN`（`~/.codex/config.toml`）；token 写进 **`~/.zshrc`** 的 `export OPENCHATCUT_MCP_TOKEN=…`（Windows 写 HKCU\Environment） | | `:196-255` |
| 千问办公 | **不写文件**：只能复制 JSON（`type: 'streamable-http'`），由用户粘贴到"连接器 → 自定义 MCP" | | `src/components/settings/mcpClientConfig.ts:1-20`、`README.md:425-442` |

JSON 合并方式：只动 `openchatcut` 这一项，原子写入（临时文件 + rename），解析失败时拒绝写入（`client-connect.ts:76-136`）。

**相关模块职责**

| 模块 | 职责 | 证据 |
|---|---|---|
| `server/skills-files.ts` | 纯 fs 工具：`~/.openchatcut/skills/<slug>/SKILL.md` 的发现、镜像、删除（`OPENCHATCUT_SKILLS_DIR` 可改位置） | `server/skills-files.ts:1-20,64-116` |
| `server/plugins/skill-files.ts` | `/api/skills`：kv 里的自定义技能和磁盘 SKILL.md 双向镜像 | `:1-5,113` |
| `server/plugins/skill-install.ts` | `/api/skills/install`：从 GitHub 下载整个 skill 仓库（API，限流时回退 git clone） | `:1-6,187` |
| `server/plugins/skill-exec.ts` | 在本机执行 skill 自带脚本：二进制白名单、不经 shell、cwd 锁在 skill 目录 | `:1-23,175` |
| `src/agent/skills/` | 内置技能的正文、目录和加载逻辑（progressive disclosure） | `plugin-skills.ts:1-60`、`skills-catalog.ts` |
| `server/external-agent/` | MCP 服务（`mcp.ts`）、工具暴露、编辑会话和草稿、broker（MCP 调用 ↔ 打开的编辑器长轮询）、离线运行时（编辑器没开也能读写）、剪映导出、客户端连接 | 目录内共 59 个文件 |
| `server/plugins/external-agent.ts` | 挂载 `/api/external-agent/*`（bootstrap、connect-client、jianying-export、bridge）和 `/api/external-mcp/mcp` | `:86-151` |
| `server/plugins/external-agent-bridge-routes.ts` | bridge 路由：`/import-token`、`/upload-receipt`、`/register`、`/unregister`、`/poll`、`/cancellation`、`/result`、`/tools` | `:336-351` |
| `server/plugins/extension-store.ts` | `/api/plugins`：内容插件包（`openchatcut-plugin@1`：MG、转场、特效、LUT 等**数据包**，不含代码）存放在 `~/.openchatcut/plugins` | `:8-11,209`、`src/plugins/types.ts:1-8` |

### 8. 借用本机 Claude Code / Codex / Copilot CLI 的订阅

**是的**：内置 Agent 可以驱动本机官方 CLI，用用户自己的订阅登录态，OpenChatCut 不碰 OAuth 凭据。

| 提供方 | 机制（一句话） | 证据 |
|---|---|---|
| Codex（ChatGPT 订阅） | 启动官方 `codex app-server --listen stdio://`（JSON-RPC，编辑工具以 dynamicTools 形式桥接），使用隔离的 `CODEX_HOME=~/.openchatcut/codex`，隔离区没有登录时复制 `~/.codex/auth.json`，并关闭 shell、浏览器、插件等功能；最低 0.146.0 | `server/codex/app-server.ts:12-46,234-264`、`server/codex/installation.ts:10`、`server/plugins/codex-agent.ts:449`、`README.md:295` |
| Claude Code（Claude 订阅） | 每轮启动一个 `claude -p … --output-format stream-json --mcp-config <临时> --strict-mcp-config --restricted`，MCP 指回自己的 `/api/external-mcp/mcp`（服务名 `openchatcut-builtin`，带 Bearer），禁用 Bash/Read/Edit/Web 等；最低 2.1.263 | `server/claude-code/turn-runner.ts:10-58,280-302`、`server/claude-code/installation.ts:16`、`server/plugins/claude-code-agent.ts:274` |
| Copilot（GitHub Copilot 订阅） | `@github/copilot-sdk` 的 CopilotClient，`COPILOT_HOME=~/.openchatcut/copilot`，用户在终端 `copilot login`；最低 1.0.0 | `server/copilot/client.ts:1-30`、`server/copilot/installation.ts:15`、`src/components/settings/settingsAgentProviders.ts:79` |

---

## D. 补丁面与升级风险

改动频率统计口径：2026-07-20（初始提交）到 2026-10-21 共 1097 个上游提交，不含初始提交。"30 天"指 2026-09-25 以后。

### 9. 派生版必然要改的上游文件

| 级别 | 文件:行 | 内容 | 能否只新增文件替代 | 上游改动（总 / 30 天） |
|---|---|---|---|---|
| **必改** | `src/ui/upstreamUpdate.ts:6-7` | mac/web 的更新检查 URL 和"前往发布页" URL | 不能（没有 env） | 3 / 0 |
| **必改** | `src/ui/upstreamUpdate.verify.ts:24` | 断言上面的 URL | 跟着改 | 3 / 0 |
| **必改** | `index.html:5,8` | favicon 路径、`<title>OpenChatCut</title>`（Electron 文档：页面 title 会覆盖窗口标题，待验） | 不能 | 0 / 0 |
| **必改** | `public/openchatcut-icon.png`（二进制） | Win/Linux 图标、favicon、应用内 BrandMark（`src/components/icons.tsx:136-140`，`<img>` 在 :138）都按这个路径引用 | 原地替换内容 | 0 / 0 |
| **必改**（去上游品牌时） | `src/components/icons.tsx:143+`（`OpenChatCutWordmark` SVG） | Dashboard 和聊天栏的字标 | 不能 | 13 / 0 |
| **必改**（判断，AGPL） | `src/components/DashboardHeaderLinks.tsx:6-7` | 源码仓库链接 + 作者邮箱；AGPL 的源码提供入口应指向派生版源码 | 不能 | 1 / 0 |
| 建议改 | `src/i18n/locale.ts:25-45` | 默认语言：保存过的选择优先，其次系统语言（zh/it/ru），**其余一律英文**（`:31,33`）；要默认中文就改这里 | 不能 | 16 / 3 |
| 建议改（与上游并装并发时） | `desktop/embedded-port.ts:7,22-27` | 端口 5199 和记忆文件 `~/.openchatcut/mcp-port` 是共用的；文件里自己的注释也说共用一个记忆槽会在每次抢端口时来回跳（`:12-15`） | 不能 | 3 / 0 |
| 建议改 | `src/components/chat/ChatPanelView.tsx:45` | 聊天栏折叠态的 "OpenChatCut" 字样 | 不能 | 19 / 0 |
| 可选 | `assets/branding/openchatcut-icon.icns`、`assets/favicon.svg` | mac 图标、站点 svg 图标 | icns 可以由 wrapper 配置指向新文件 | 0 / 0 |
| 可选 | `desktop/main.ts:417,477`、`desktop/bootstrap.ts:35`、`desktop/runtime-preflight.ts:64-71` | 窗口标题和启动失败对话框文案（mac 的标题栏隐藏，`desktop/window-frame.ts:12`） | 不能 | 60/0、1/0、2/1 |
| 可选（数据隔离） | `~/.openchatcut` 写死的位置：`server/runtime-profile.ts:135,144,182-183`、`server/data-dir.ts:17,48`、`server/mcp-token.ts:25-26`、`desktop/embedded-port.ts:24-25`、`server/skills-files.ts:19`、`server/plugins/extension-store.ts:8`、`shared/model-cache-path.ts:4`、`server/codex/app-server.ts:12`、`server/copilot/client.ts:12`、`scripts/dev-profile.mjs:108` | 部分可以在派生入口里先设 env 再 import 上游主体来替代：`OPENCHATCUT_DATA_DIR`（项目库 + 媒体，`runtime-profile.ts:96-121`）、`OPENCHATCUT_MCP_TOKEN`（`editor-auth.ts:36`）、`OPENCHATCUT_SKILLS_DIR`（keystore 会读 `process.env`，`keystore.ts:70`、`keystore-names.ts:188`）。端口记忆、插件、模型、codex、copilot 没有 env 可用（待验） | 大多数 1–7 / 0–3 |
| 不建议改 | `package.json:2-13`（name、version、description、author、desktopName） | 改了每次同步都冲突，还会撞 issue 模板版本门禁。打包元数据可以用 electron-builder 的 `extraMetadata` 覆盖（待验） | wrapper | 306 / 54 |
| 不建议改 | `config/electron-builder.config.mjs:69-83,125,138,146,149`；`.github/workflows/desktop.yml`；`desktop/update-packaging.verify.ts` | 改用新增 wrapper 配置 + 自己的 workflow，这三个文件就不用动 | 能 | 10/0、28/4、15/0 |
| 不建议改 | `skills/openchatcut/**`、`.mcp.json`、`server/external-agent/mcp.ts:55,199` | 外部 skill 名和 MCP 服务名 `openchatcut` 被 `external-skill.verify.mjs:11-23` 钉死 | 另建新 skill 目录 | 9/2 … |

UI 文案里的品牌字样规模：非测试的 `src` 文件里有 43 个文件、77 处 "OpenChatCut"（不含 i18n）；server/shared/desktop/cli/remotion 里 33 个文件、73 处；en 字典 24 处、it 字典 12 处。因为 i18n 用**中文原文当 key**，改中文文案等于改 key，en/it/ru 字典要一起改（`src/i18n/locale.ts:107-113`）。判断：全量去品牌的代价很高，建议只改外壳（打包身份、图标、title、字标、源码链接）。

**合计（判断）**：采用 wrapper 打包配置时，必改的上游文件是 6 个（其中 1 个 verify、1 个二进制），建议改 3 个；新增文件约 3–4 个（wrapper 打包配置、派生打包的 shell 入口、派生 workflow，可选派生 Electron 入口）。不用 wrapper、在上游打包配置上原地改的话，再加 `config/electron-builder.config.mjs`、`desktop/update-packaging.verify.ts`、`.github/workflows/desktop.yml` 共 3 个。

### 10. 只新增文件就能接入的扩展点

| 扩展点 | 能否只新增文件 | 事实 / 最小钩子（判断） | 证据 |
|---|---|---|---|
| 服务端插件 | **不能** | `serverPlugins()` 是静态数组，dev 和桌面都只调用它。最小钩子：在 `index.ts` 数组末尾加一行 `...oacServerPlugins()`，派生插件全部放进新文件 | `server/plugins/index.ts:63-373`（66 / 11 次改动） |
| 仅 Web/dev 的 Vite 配置 | 能 | 新建 vite 配置 import 上游后追加插件（`--config` 指向新文件）。但**桌面内嵌服务器不读 vite 配置**，所以桌面仍然需要上面那个钩子 | `config/vite.config.ts:86-150`、`desktop/embedded-server.ts:99` |
| 设置页分区 | **不能** | `SETTINGS_CATEGORIES` 是静态数组；新配置键还要加进 `KEY_NAMES` 白名单（`SETTABLE` 只认白名单） | `src/components/settings/settingsSchema.ts:89`（52 / 6）、`server/keystore-names.ts:7`（12 / 9）、`server/keystore.ts:31,233` |
| i18n 词条 | 一半 | `check-i18n` 会收集 `src/i18n/dict/en/` 下**所有** `.ts` 的 default export，所以新增 `en/oac.ts` 能通过检查；但运行时的 EN 字典由 `en/index.ts` 静态 `Object.assign` 组装，要加 1 行 import（it、ru 同理）。中文就是 key，新 UI 必须提供英文 | `scripts/check-i18n.mjs:123-141,311-331`、`src/i18n/dict/en/index.ts:21-25`（2 / 0）、`src/i18n/dictRegistry.ts:34-59` |
| 内置技能 | 能（运行时） | `import.meta.glob` 自动发现新目录，但 `skill-loading.verify.ts:49` 钉死 30 个，要改 verify；替代办法是放进用户技能目录 `~/.openchatcut/skills`（运行时扫描） | `src/agent/skills/plugin-skills.ts:12`、`server/skills-files.ts:64-65` |
| 内容插件（MG/转场/特效/LUT） | 能（零代码） | 安装 `openchatcut-plugin@1` 数据包 | `server/plugins/extension-store.ts:8-9`、`src/plugins/types.ts:8` |
| 扩展中心资源源 | 能 | 构建时设 `VITE_RESOURCE_REGISTRY_URL`（默认 `openchatcut.com/api/resources/extensions`） | `src/library/ExtensionCenter.tsx:23-24` |
| Electron IPC | **不能**（待验替代方案） | handler 写死在 `boot()` 里，`trustedOrigin` 只在 boot 内部可得；preload 是固定对象，类型在 `src/desktop-api.d.ts` 里重复声明。原地改要动 3 个文件：`main.ts`（60 次改动，且被 `desktop.verify.ts` 用正则检查源码）、`preload.ts`（30）、`desktop-api.d.ts`（21）。替代方案（待验）：自建 Electron 入口，在 `import('./app-main.mjs')` 前后用 `session.registerPreloadScript` 注入第二个 preload，再自行注册 IPC | `desktop/main.ts:352-399`、`desktop/preload.ts:136-265`、`desktop/bootstrap.ts:25-29` |
| Electron 入口 / 环境注入 | 能（待验） | bootstrap 动态 import 主体，派生入口可以先设 env（数据目录、token、技能目录），打包时用 `extraMetadata.main` 指向新入口；需要额外跑一次 esbuild | `desktop/bootstrap.ts:14-29`、`package.json:9,69` |
| 打包配置 | 能 | wrapper 配置覆盖 appId/productName/publish/icon/executableName；派生打包脚本复用上游的 `build`、`desktop:build:main`、`desktop:prebundle`、`prepare-target`，只把最后一步 electron-builder 的 `--config` 换掉 | `config/electron-builder.config.mjs:31,68`、`package.json:74-79` |
| CI | 能 | 新增派生 workflow；**不要改** `ci.yml`（被 `verify-gate-coverage.verify.mjs:80-92` 断言）和 `desktop.yml`（被 `update-packaging.verify.ts:160+` 断言） | 同左 |
| 派生自己的测试 | 能（有条件） | 文件一旦命名 `*.verify.*` 就必须登记进 `package.json`（门禁 1 和 2），也就会撞 `package.json`。用别的后缀（比如 `*.test.ts`，门禁不扫）+ 自己的 shell 入口可以避开；但 500 行上限对所有非测试源码都生效 | `scripts/verify-gate-coverage.verify.mjs:36-69,94-114` |
| 派生文档 | 注意 | `.gitignore` 忽略了 `docs/`、`CLAUDE.md`、`AGENTS.md`、`.claude/`；`/scripts/*` 也默认忽略 | `.gitignore:60-93` |

### 11. 上游活跃度与冲突风险

**最近 10 个版本**（日期取自 CHANGELOG；提交数和文件数按 Release 发布时间窗口统计）

| 版本 | 日期 | CHANGELOG 条目 | 窗口提交数 | 触及文件数 |
|---|---|---|---|---|
| 0.2.17 | 2026-10-15 | 7 | 18 | 76 |
| 0.2.16 | 2026-10-07 | 12 | 44 | 212 |
| 0.2.15 | 2026-09-29 | 42 | 197 | 673 |
| 0.2.14 | 2026-09-04 | 7 | 24 | 101 |
| 0.2.13 | 2026-08-31 | 1 | 4 | 12 |
| 0.2.12 | 2026-08-31 | 25 | 63 | 235 |
| 0.2.11 | 2026-08-25 | 1 | 7 | 26 |
| 0.2.10 | 2026-08-24 | 5 | 42 | 307 |
| 0.2.9 | 2026-08-20 | 4 | 9 | 98 |
| 0.2.8 | 2026-08-20 | 5 | 6 | 60 |
| Unreleased | → 2026-10-21 | 4（含 TypeScript 7、AI SDK 7.0.148、React 19.3、Vite 8.3 升级；Electron 45 和 Remotion 有意保持固定） | 19 | — |

月度提交数：7 月（7/20 起）124、8 月 676、9 月 238、10 月（到 21 日）62。节奏是 8 月爆发，之后放缓，但仍然每周多个提交，大约每 1–3 周一个版本（`CHANGELOG.md:9-50`、`gh api releases`）。

**改动最频繁的 20 个文件**（不含初始提交）

| # | 文件 | 次数 | # | 文件 | 次数 |
|---|---|---|---|---|---|
| 1 | `package.json` | 306 | 11 | `server/keystore.ts` | 57 |
| 2 | `CHANGELOG.md` | 141 | 12 | `src/i18n/dict/en/chat.ts` | 55 |
| 3 | `src/i18n/dict/en/settings.ts` | 86 | 13 | `src/Editor.tsx` | 53 |
| 4 | `README.md` | 84 | 14 | `src/components/settings/settingsSchema.ts` | 52 |
| 5 | `README_ZH.md` | 78 | 15 | `src/i18n/dict/en/components.ts` | 49 |
| 6 | `src/index.css` | 77 | 16 | `src/i18n/dict/ru/index.ts` | 48 |
| 7 | `assets/agent/openchatcut-tool-schemas.json`（生成文件） | 75 | 17 | `src/media/MediaPoolPanel.tsx` | 47 |
| 8 | `server/plugins/index.ts` | 66 | 18 | `src/components/settings/vendorIcons.tsx` | 47 |
| 9 | `package-lock.json` | 66 | 19 | `src/agent/systemPrompt.ts` | 45 |
| 10 | `desktop/main.ts` | 60 | 20 | `server/key-probes.ts` | 44 |

近 30 天的前几名：`package.json` 54、`ru/index.ts` 23、README 20、CHANGELOG 19、`openchatcut-tool-schemas.json` 17、`en/settings.ts` 14、`it/settings.ts` 13、`key-probes.ts` 12、`server/plugins/index.ts` 11、`keystore-names.ts` 9。

**补丁最可能撞上游的地方**（按风险排序）

| 风险 | 位置 | 原因 |
|---|---|---|
| 极高 | `package.json` 的 scripts | 28% 的上游提交都改它；`test:serial`（`package.json:60`）和 `pretest`（`:40`）是超长单行，任何登记 verify 的改动都会产生整行冲突。对策（判断）：派生测试不叫 `*.verify.*`，派生构建走自己的 shell 入口，不改 scripts |
| 高 | `server/plugins/index.ts`、`settingsSchema.ts`、`keystore-names.ts`、`en/settings.ts`（加新服务或新设置时） | 都是上游"每接一个厂商就改一次"的列表文件。对策：每个文件只留一行钩子，钩子放在列表末尾这种稳定位置（判断） |
| 高 | `openchatcut-tool-schemas.json` | 派生版加 agent 工具就要重新生成；生成文件冲突的解法是合并后重新运行 `generate:server-tool-catalog` |
| 中 | `desktop/main.ts`、`preload.ts`、`desktop-api.d.ts` | 60/30/21 次（近 30 天都是 0），而且 `main.ts` 被源码正则断言 |
| 低 | 品牌必改文件：`upstreamUpdate.ts`（3）、`index.html`（0）、图标（0）、`DashboardHeaderLinks.tsx`（1）、`icons.tsx`（13）、`locale.ts`（16）、`embedded-port.ts`（3） | 这些都很少变 |
| 结构性 | 500 行门禁导致上游经常拆文件（0.2.17 就拆了 `key-probes.ts`，`CHANGELOG.md:42-43`） | 补丁所在的代码块可能整体搬到新文件 |
| 战略 | `config/README.md` 末节 "Planned architecture (TS UI + plugin system, C++ backend)" | 上游已定方向，没有时间表；落地时目录和插件机制会重组。如果出现官方插件系统，派生版的钩子补丁可能被取代或失效（判断） |
| 操作 | 本地是 depth=1 浅克隆 | 做 merge/rebase 前需要 `git fetch --unshallow` 或重新完整 clone |

### 12. 许可证与合规

| 项 | 事实 | 证据 |
|---|---|---|
| 主许可证 | GNU AGPL v3（"or later"） | `LICENSE:1-2`、`package.json:6`、`README.md:586-590` |
| 内置 Agent Skills | 改编自 ChatCut-Inc/agent-plugin，原项目是 **GPL-3.0-only**，NOTICE 只覆盖该目录 | `src/agent/skills/NOTICE.md:1-18` |
| 字体 | OFL-1.1（Noto Sans SC、得意黑、抖音美好体、清松手写体 ×2）；另外 **5 款不是开源字体**（"免费商用"条款：胡晓波 ×3、庞门正道 ×2），转发条款待验 | `assets/fonts/LICENSES.md`、`assets/fonts/OFL-1.1.txt` |
| 其他资产 | `sound-effects/`（39）、`voice-samples/`（35，含 doubao-*.mp3）、`luts/`（Canon、Sony 官方 LUT）、`audio/track-*.mp3`、`vendor-icons/`（厂商商标）**都没有许可说明文件**，来源和许可待验 | `find assets -iname '*licen*'` 只找到字体相关的文件 |
| 关键依赖 | **Remotion License**：个人、≤3 人的营利组织、非营利组织免费；更大的营利组织需要公司授权；不允许"复制或修改 Remotion 来售卖自己的衍生品"。ffmpeg-static 是 GPL-3.0-or-later，ffprobe-installer 是 LGPL-2.1。**GitHub Copilot CLI 是专有许可**：只允许不修改、作为应用一部分再分发，并附带它的 License。onnxruntime、electron、sqlite-vec、transformers.js、mediapipe 是 MIT 或 Apache | `node_modules/remotion/LICENSE.md`、`node_modules/@github/copilot/LICENSE.md`、各包 package.json 的 license 字段 |
| 闭源/Pro 门控 | **代码里没有**（grep `licenseKey`、`isPro`、`openchatcut.com/pro`、`激活码` 只命中 README 的链接）。README 顶部链接到 "OpenChatCut Pro · Desktop edition"（openchatcut.com/pro），像是另一个商业版，与本仓库代码无关（待验） | `README.md:21` |
| 连接上游的远程服务 | 扩展中心资源源 `openchatcut.com/api/resources/extensions`（可覆盖）；更新检查走 GitHub API | `src/library/ExtensionCenter.tsx:23-24`、`src/ui/upstreamUpdate.ts:6` |
| 网络面 | 主服务只监听 127.0.0.1；手机上传是临时 LAN 服务，绑定 `0.0.0.0` 随机端口，带会话令牌 | `desktop/embedded-port.ts:73`、`server/mobile-upload-service.ts:214,276` |

**AGPL 对派生版的要求（判断，不是法律意见）**
1. 分发安装包时，必须向接收者提供**对应源码**：派生版修改后的全部源码，加上构建和安装用的脚本（AGPL §1 对 Corresponding Source 的定义、§6）。最简单的做法是公开派生仓库，并在 Release 附上对应 tag 的源码。
2. 保留上游版权和许可声明；修改过的文件要有醒目的修改说明和日期（§5a）；整个派生作品继续以 AGPL-3.0-or-later 发布（§5c）。
3. 有用户通过网络远程交互时（比如把内嵌服务或 MCP 暴露到局域网或公网），要给这些用户提供获取源码的途径（§13）。应用内的"源码"链接（`DashboardHeaderLinks.tsx:6`）应改为指向派生仓库。
4. `src/agent/skills/` 下的文件按 GPL-3.0-only 保留 NOTICE（GPLv3 §13 允许和 AGPLv3 组合）。
5. AGPL 不授予商标权：分发时不要用 "OpenChatCut" 名称和图标，也不要暗示上游背书或提供支持；作者邮箱 `DashboardHeaderLinks.tsx:7` 应替换或移除。
6. Remotion 的公司授权条件和 Copilot CLI 的再分发条件**独立于 AGPL**，派生版发行方要自行确认是否符合。

---

## 附：可复现的原始数据

- 提交列表：`/private/tmp/claude-501/-Users-teaxus-ai-agent-playground/889dbd28-1851-4332-a544-a8f82b63cd4a/scratchpad/gh/commits.tsv`（sha、日期、标题；1100 行）
- 每个提交的文件：`/private/tmp/claude-501/-Users-teaxus-ai-agent-playground/889dbd28-1851-4332-a544-a8f82b63cd4a/scratchpad/gh/commit-files.tsv`；带日期的版本是同目录下的 `cf-dated.tsv`
- 抓取脚本：`/private/tmp/claude-501/-Users-teaxus-ai-agent-playground/889dbd28-1851-4332-a544-a8f82b63cd4a/scratchpad/gh/fetch-files.sh`（`gh api repos/0xsline/OpenChatCut/commits/<sha>`，只读）
