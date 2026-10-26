# AI 编码 agent 注册表调研（2026-10-25）

产物：`/Users/teaxus/AILearning/ai-cut/shared/aicut/agents.json`（80 个 agent：A 组 15 项、B 组 17 项、其余 48 项只登记 skills 目录）。
本文是它的依据。结论一句话：A 组 13 个 agent 里，12 个能给出 MCP 的确切写法（11 个是官方页逐字核实，Claude Desktop 靠第三方桥接），灵码查不清；发现 11 处与上游 `client-connect.ts`、Gemini 或 vercel 表冲突（见文末汇总），最要紧的是 Antigravity（路径与字段都变了）。

## 怎么查的

- 本机只做了 `ls` 看文件名，以及用 `node` 打印 JSON 的顶层键名和 `mcpServers` 等容器下的服务名，没打印任何值，没改任何配置文件。另外对 `Qoder IDE.app` 的 bundle 做了只读的字符串检索（判断它读哪个 MCP 文件）。
- 路径与字段名全部来自 WebFetch 打开的官方文档页或官方 GitHub 仓库的文档，来源见各行。页面里没有逐字看到的，一律 `verified:false`。
- Gemini：前几次提问返回“输入框未就绪”，`gemini_restart` 后仍不通，所以前期查证直接走官方页（属于“Gemini 不可用”例外）；后来恢复，问了 Trae、Kiro/Copilot/Cline/Qoder/Roo 两题，回答全程无来源，只当线索，与官方页冲突处见各节。
- 本机“已装?”的判断：不能只看目录。`pencil` 这个 MCP 同时出现在 Gemini、Antigravity、OpenCode、Kiro、Claude Desktop 的配置里，说明有个安装器给多个 agent 的配置目录都写过文件（推断，待验），所以目录/文件存在不等于 agent 装了。

## 总表（A、B 组）

`~` = 用户主目录（Windows 为 `%USERPROFILE%`）。MCP 列的“核实”指路径与字段名是否在官方页逐字看到。

| agent | 已装?（本机证据） | 全局 skills 目录 | MCP 方式 | 核实 | 主要来源 |
|---|---|---|---|---|---|
| Claude Code | 已装（`claude` 在 PATH，`~/.claude`） | `~/.claude/skills` | json：`~/.claude.json` → `mcpServers`，`{type:http,url,headers}` | MCP ✓ skills ✓ | code.claude.com/docs/en/mcp、/skills |
| Codex | 目录在、有会话数据；`codex` 不在 PATH | `~/.agents/skills`（本机另有 `~/.codex/skills`） | toml-codex：`~/.codex/config.toml` → `[mcp_servers.ai-cut]`，`url` + `http_headers` | MCP ✓ skills ✓ | developers.openai.com/codex/config-reference、/skills |
| Cursor | 存疑：`~/.cursor` 仅 `argv.json`、`extensions`，无应用本体、无 `mcp.json` | `~/.cursor/skills` | json：`~/.cursor/mcp.json` → `mcpServers`，`{url,headers}` | MCP ✓ skills ✓ | cursor.com/docs/context/mcp、/skills |
| Gemini CLI | 疑似未装：`gemini` 不在 PATH，`settings.json` 只有 `mcpServers.pencil` | `~/.gemini/skills`（别名 `~/.agents/skills`） | json：`~/.gemini/settings.json` → `mcpServers`，`{httpUrl,headers}` | MCP ✓ skills ✓ | GitHub google-gemini/gemini-cli docs/tools/mcp-server.md |
| Antigravity（App/IDE/CLI） | 存疑：只有 `~/.gemini/antigravity/mcp_config.json`（仅 pencil），无应用本体 | App/IDE：`~/.gemini/config/skills`（旧：`~/.gemini/antigravity/skills`）；CLI：`~/.gemini/antigravity-cli/skills` | json：`~/.gemini/config/mcp_config.json` → `mcpServers`，`{serverUrl,headers}`；旧路径存在则同写 | MCP ✓ skills ✓（与上游冲突） | antigravity.google/docs/mcp、/skills |
| Qoder（国际版） | 已装：`Qoder IDE.app` 1.29.0，`~/.qoder` | `~/.qoder/skills`（本机已有 `kh-pm`） | json：`~/.qoder/settings.json` → `mcpServers`，`{type:http,url,headers}`；`~/.qoder/mcp.json` 存在则同写 | MCP ✓ skills ✓（本机文件与文档不符，待验） | docs.qoder.com/cli/mcp-reference.md、/cli/Skills |
| Qoder CN | 未装（无 `~/.qoder-cn`） | `~/.qoder-cn/skills`（文档另写 `~/.lingma/skills`） | json：`~/.qoder-cn/settings.json` → `mcpServers`，同上 | MCP ✓ skills ✗ | docs.qoder.cn/cli/mcp-reference.md、/cli/settings-reference.md |
| OpenCode | 疑似未装：`opencode` 不在 PATH，仅 `opencode.json`（pencil） | `~/.config/opencode/skills` | json：`~/.config/opencode/opencode.json` → `mcp`，`{type:remote,url,headers,enabled}` | MCP ✓ skills ✓ | opencode.ai/docs/mcp-servers/、/config/、/skills |
| Windsurf | 疑似未装：仅 `~/.codeium/windsurf/mcp_config.json`（空） | `~/.codeium/windsurf/skills`（或 `~/.config/devin/skills`） | json：`~/.codeium/windsurf/mcp_config.json` → `mcpServers`，`{serverUrl,headers}` | MCP ✓ skills ✓ | docs.devin.ai/cli/reference/configuration/read-config-from.md、/desktop/cascade/mcp |
| Kiro（IDE/CLI） | 疑似未装：仅 `~/.kiro/settings/mcp.json`（pencil） | `~/.kiro/skills` | json：`~/.kiro/settings/mcp.json` → `mcpServers`，`{url,headers}` | MCP ✓（127.0.0.1 待验）skills ✓ | kiro.dev/docs/mcp/configuration/、/skills/ |
| GitHub Copilot CLI | 曾运行：`~/.copilot` 有 `config.json`、`ide/*.lock`、`logs`；`copilot` 不在 PATH | `~/.copilot/skills`（也读 `~/.agents/skills`） | json：`~/.copilot/mcp-config.json` → `mcpServers`，`{type:http,url,headers,tools}` | MCP ✓ skills ✓ | docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers |
| Cline | 曾运行：`~/.cline/data/globalState.json`，无 VS Code 版存储 | `~/.cline/skills`（与 vercel 表冲突） | json：`~/.cline/data/settings/cline_mcp_settings.json` → `mcpServers`，`{type:streamableHttp,url,headers}`（CLI 版） | MCP ✓（仅 CLI 路径）skills ✓ | docs.cline.bot/mcp/configuring-mcp-servers、/features/skills |
| 通义灵码 Lingma | 装过：`~/.lingma/bin/1.4.10`，已更名 Qoder CN | `~/.lingma/skills` | none：只支持 STDIO/SSE，无配置路径 | MCP ✗ skills ✓ | help.aliyun.com/zh/lingma/user-guide/guide-for-using-mcp、docs.qoder.cn/user-guide/skills.md |
| Claude Desktop | 已装：`Claude.app` + `claude_desktop_config.json` | 无目录（只能在界面上传 ZIP） | json：`claude_desktop_config.json` → `mcpServers`，用 `mcp-remote` 做 stdio 桥 | 路径 ✓ 桥接写法来自第三方 | modelcontextprotocol.io/docs/develop/connect-local-servers、github.com/geelen/mcp-remote |
| Trae | 未装 | `~/.trae/skills`（vercel，未核实） | copy：`{url,headers}`，全局文件路径官方没写 | ✗ | docs.trae.cn/ide/add-mcp-servers |
| Trae CN | 未装 | `~/.trae-cn/skills` | copy：同上 | MCP ✓（字段）skills ✓ | docs.trae.cn/ide/skills |
| Qwen Code | 未装 | `~/.qwen/skills` | json：`~/.qwen/settings.json` → `mcpServers`，`{httpUrl,headers}` | ✓ ✓ | qwenlm.github.io/qwen-code-docs/en/users/features/mcp/ |
| iFlow CLI | 未装 | `~/.iflow/skills`（vercel） | json：`~/.iflow/settings.json`，远程字段按推断 | ✗ | platform.iflow.cn/en/cli/examples/mcp |
| CodeBuddy | 未装 | `~/.codebuddy/skills` | json：`~/.codebuddy/.mcp.json` → `mcpServers`，`{type:http,url,headers}` | ✓ ✓ | codebuddy.cn/docs/cli/mcp、/cli/skills |
| Roo Code | 未装 | `~/.roo/skills` | copy：`{type:streamable-http,url,headers}`，全局文件磁盘路径官方没写 | ✓ ✓ | roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo |
| Kilo Code | 未装 | `~/.kilo/skills`（vercel） | jsonc：`~/.config/kilo/kilo.jsonc` → `mcp`，`{type:remote,url,headers}` | MCP ✓ skills ✗ | kilo.ai/docs/automate/mcp/using-in-kilo-code |
| Continue | 未装 | `~/.continue/skills`（vercel） | yaml-dropin：`~/.continue/mcpServers/ai-cut.yaml` | ✗（全局目录与 headers 写法待验） | docs.continue.dev/customize/deep-dives/mcp |
| Goose | 未装 | `~/.config/goose/skills`（vercel） | copy：YAML `extensions.ai-cut`（`streamable_http` + `headers`） | MCP ✓ skills ✗ | goose-docs.ai/docs/guides/config-files |
| Zed | 未装 | `~/.agents/skills`（vercel） | jsonc：`settings.json` → `context_servers`，`{url,headers}` | MCP ✓ skills ✗ | zed.dev/docs/ai/mcp |
| Amp | 未装 | `~/.config/agents/skills` | jsonc：`~/.config/amp/settings.json` → `"amp.mcpServers"`（带点号的单个键），`{url,headers}` | ✓ ✓ | ampcode.com/docs/customize/mcp、/cli/settings、/customize/skills |
| Crush | 未装 | `~/.config/crush/skills` | none：配置迁到 crushrc，JSON 已弃用，headers 写法没抓到 | MCP ✗ skills ✓ | github.com/charmbracelet/crush README |
| Factory Droid | 未装 | `~/.factory/skills` | json：`~/.factory/mcp.json` → `mcpServers`，`{type:http,url,headers}` | ✓ ✓ | docs.factory.com/cli/configuration/mcp、/skills |
| JetBrains Junie | 未装 | `~/.junie/skills` | json：`~/.junie/mcp/mcp.json` → `mcpServers`，`{url,headers}`（CLI 页） | ✓ ✓ | junie.jetbrains.com/docs/junie-cli-mcp-configuration.html |
| Augment | 未装 | `~/.augment/skills` | json：`~/.augment/settings.json` → `mcpServers`，`{type:http,url,headers}` | ✓ ✓ | docs.augmentcode.com/cli/integrations、/cli/skills |
| Warp | 未装 | `~/.agents/skills`（vercel） | json：`~/.warp/.mcp.json` → `mcpServers`，`{url,headers}` | MCP ✓（是否 Streamable HTTP 待验）skills ✗ | docs.warp.dev/knowledge-and-collaboration/mcp |
| Devin CLI/Desktop（额外加的） | 未装 | `~/.config/devin/skills` | json：`~/.config/devin/mcp_config.json` → `mcpServers`，`{url,transport:http,headers}` | ✓ ✓ | docs.devin.ai/cli/extensibility/mcp/configuration.md |

其余 48 项（vercel 表里除上面之外的 agent）只登记 skills 目录，`mcp.kind="none"`，`skills.verified=false`，来源就是 vercel 表。

## agents.json 比约定多出来的字段

| 字段 | 含义 |
|---|---|
| `skillsCliId` | 对应 vercel 表 `--agent` 的 id，方便和 skills CLI 对照 |
| `skills.verified` / `skills.note` | skills 目录是否在该 agent 官方页看到 |
| `skills.extra` + `extraPolicy` | 另一个也有效的全局目录；`write-if-parent-exists` = 其父目录存在才同步写 |
| `mcp.extraFiles` + `extraFilesPolicy` | 另一个也有效的 MCP 文件；`write-if-exists` = 文件已存在才同步写（Antigravity、Qoder、Windsurf 用） |
| `mcp.template` | 仅 `yaml-dropin`，整份文件内容模板 |
| `detect.binaries` / `detect.apps` / `detect.note` | 额外探测项（Codex 的内置 CLI 路径、应用包路径）与探测可信度说明 |

建议 App 的处理规则（是我的判断，不是事实）：`verified:false` 的条目一律只给复制、不自动写；`~/.agents/skills` 被 Codex、Cursor、Gemini CLI、Copilot、OpenCode、Amp 等共用，复制 skill 时按解析后的路径去重，写一次就够。

## A 组逐个说明

### 1. Claude Code
- 官方：用户级 MCP 存 `~/.claude.json`；`type` 可写 `http`，`streamable-http` 是别名；个人 skills 在 `~/.claude/skills/<name>/SKILL.md`。（code.claude.com/docs/en/mcp、/skills）
- 本机：`~/.claude` 与 `~/.claude2` 两套；`~/.claude.json` 与 `~/.claude2/.claude.json` 顶层都有 `mcpServers`（服务名：browser-use、pencil、xcode、gemini-controller）。`claude` 在 `~/.local/bin` 和 nvm 下。
- 冲突/待验：官方只说 `CLAUDE_CONFIG_DIR` 迁移 settings、历史、插件，没写 `.claude.json` 是否也迁；本机 `~/.claude2/.claude.json` 存在，暗示会迁（待验）。与上游一致。

### 2. Codex（CLI 与 App 共用 `~/.codex`）
- 官方：`mcp_servers.<id>` 表对 Streamable HTTP 支持 `url`、`bearer_token_env_var`、`http_headers`（静态 header 表）、`env_http_headers`、`http_headers_helper`；官方示例直接在配置里写 `http_headers = { ... }`。`codex mcp add <name> --url ... --bearer-token-env-var ENV` 的参数也在 CLI reference 里。skills 用户级是 `$HOME/.agents/skills`。（developers.openai.com 三个页面都 308 跳到 learn.chatgpt.com）
- 结论：**能直接在 config.toml 写 `Authorization` 请求头，不用环境变量**。注册表推荐 `http_headers`，免去上游写 `~/.zshrc` / Windows 用户环境变量、Windows 还要重启 Codex 的麻烦。
- 本机：`~/.codex` 有 `config.toml`、`auth.json`、`sessions`、`skills`（含 `.system`、手装的 `kh-pm` 等）；`config.toml` 里已有 `[mcp_servers.node_repl]`、`computer-use`、`local_mcp_8921`、`pencil`。`codex` 不在 PATH，`/Applications/ChatGPT.app` 里也没有上游假设的 `Contents/Resources/codex`。
- 冲突/待验：官方 skills 页只写 `~/.agents/skills`，本机 `~/.codex/skills` 却是主要装载处，是否仍被扫描没有官方说法；`config.toml` 的 Windows 位置官方页没写（按 `%USERPROFILE%\.codex` 处理）。

### 3. Cursor
- 官方：全局 `~/.cursor/mcp.json`，根键 `mcpServers`，远程服务示例只有 `url` + `headers`（`Authorization: Bearer ${env:MY_SERVICE_TOKEN}`），headers 支持 `${env:NAME}` 插值；skills 用户级是 `~/.cursor/skills/` 和 `~/.agents/skills/`。
- 本机：`~/.cursor` 里只有 `argv.json`、`extensions`，`mcp.json` 还不存在；`/Applications` 没有 Cursor.app。
- 与上游：上游写 `{type:'http', url, headers}` 并称实测可用，官方示例不带 `type`。两者差异待验，注册表按官方示例。

### 4. Gemini CLI
- 官方：`~/.gemini/settings.json` → `mcpServers`；`httpUrl` = Streamable HTTP，`url` = SSE，`headers` = 自定义请求头，`type` 字段官方页没有；skills 用户级是 `~/.gemini/skills/` 或别名 `~/.agents/skills/`。
- 本机：`~/.gemini/settings.json` 顶层只有 `mcpServers`（服务名 pencil）；`gemini` 命令不在 PATH。
- 待验：settings.json 是否容许注释；本机是否真装了 Gemini CLI（上面的文件很可能是别的安装器写的）。

### 5. Google Antigravity
- 官方 MCP 页：全局文件是 `~/.gemini/config/mcp_config.json`，工作区是 `<workspace>/.agents/mcp_config.json`；远程服务用 `serverUrl`（`url` 也行）+ `headers`，**明确写“旧的 HTTP+SSE 传输和 `httpUrl` 字段不支持”**；CLI 小节与 IDE 小节都指向这一个全局文件（App 小节未单独核对）。skills 页：App 与 IDE 全局 `~/.gemini/config/skills/`，CLI `~/.gemini/antigravity-cli/skills/`，旧版 IDE 的 `~/.gemini/antigravity/skills/` “也支持”。
- 本机：只有 `~/.gemini/antigravity/mcp_config.json`（服务名 pencil），没有 `~/.gemini/config`；`/Applications` 没有应用本体。
- **与上游冲突**：上游 `client-connect.ts` 写 `~/.gemini/antigravity/mcp_config.json` + `httpUrl`。官方页不但改了路径，还说 `httpUrl` 不支持，旧路径官方页一个字没提。注册表主写官方路径、用 `serverUrl`，旧路径存在时同写同一条 entry。上游“实测可用”的版本可能是旧版 Antigravity，待验。vercel 表的 Antigravity skills 目录（旧路径）与官方当前文档也不一致，已写进 `skills.extra`。

### 6. Qoder（含国内版）
- 官方：用户级 MCP 在 `~/.qoder/settings.json` 的 `mcpServers`（CLI 的 mcp-reference 与 connectors 页都这么写），http 类型字段 `type:"http"`、`url`、`headers`；skills `~/.qoder/skills/`。国内版：用户目录 `~/.qoder-cn`（环境变量 `QODERCN_CONFIG_DIR`），MCP 在 `~/.qoder-cn/settings.json`。
- 本机：Qoder IDE 1.29.0；`~/.qoder/settings.json` 顶层只有 `aicodingPluginSettingsMigrationVersion`、`enabledPlugins`，**没有 `mcpServers`**；反而有 `~/.qoder/mcp.json`（顶层 `mcpServers`，里面是空的），另有 `~/Library/Application Support/Qoder/SharedClientCache/extension/local/mcp.json`（`mcpServers` + `userConfigMD5`，疑似缓存）。IDE 渲染层代码里“添加 MCP”打开的用户文件路径来自语言服务下发的 `userConfigFilePath`，没有写死，所以 IDE 到底读 `settings.json` 还是 `mcp.json`，我定不了。
- 处理：主写官方的 `settings.json`，`mcp.json` 存在就同写（实测前这是唯一稳妥办法）。
- 国内版冲突：docs.qoder.cn 的 connectors 页又写 `~/.qoder/settings.json`，skills 页写 `~/.lingma/skills`，都像是沿用灵码/国际版文案；vercel 表是 `~/.qoder-cn/skills`。本机没有 `~/.qoder-cn`，没法实测。

### 7. OpenCode
- 官方：全局 `~/.config/opencode/opencode.json`（JSON 和 JSONC 都支持），根键 `mcp`，远程服务 `type:"remote"`、`url`、`headers`、`enabled`，headers 支持 `{env:VAR}`；skills 全局 `~/.config/opencode/skills/`，也读 `~/.claude/skills`、`~/.agents/skills`。
- 本机：`opencode.json` 顶层只有 `mcp`（服务名 pencil），能当纯 JSON 解析；`opencode` 不在 PATH。官方页没给 Windows 全局路径（待验）。

### 8. Windsurf
- 官方：Windsurf 文档已并入 Devin（docs.windsurf.com 307 到 docs.devin.ai）。Devin CLI 的“配置导入”页写明 Windsurf 的 MCP 在 `~/.codeium/<channel>/mcp_config.json`、skills 在 `~/.codeium/<channel>/skills/`（stable 渠道 = `windsurf`）；Cascade MCP 页则说“本页只适用于旧版 Cascade 智能体”，文件在 `~/.config/devin/mcp_config.json`（Windows `%APPDATA%\devin\`）。远程服务 `serverUrl`（或 `url`）+ `headers`，支持 `${env:VAR}`。
- 本机：只有 `~/.codeium/windsurf/mcp_config.json`（`mcpServers` 为空），无应用本体。
- 处理：主写 `~/.codeium/windsurf/mcp_config.json`，`~/.config/devin/mcp_config.json` 及 next/insiders 渠道文件存在时同写。Devin CLI/Desktop 另登记为独立 agent `devin`。

### 9. Kiro（IDE / CLI）
- 官方：用户级 `~/.kiro/settings/mcp.json`（工作区 `.kiro/settings/mcp.json` 优先），`mcpServers`，远程服务 `url` + `headers`，`${VAR}` 插值且只展开已批准的变量；skills `~/.kiro/skills/`，IDE 和 CLI 都读。
- 风险：官方写 `url` 须 HTTPS“或 localhost 的 HTTP”，页面没提 127.0.0.1 是否放行，也没提 Streamable HTTP 字样。Gemini 说 127.0.0.1 放行，无来源，不采信。AI Cut 的 URL 是 `http://127.0.0.1:5299/...`，写入后要实测，不行就改 `localhost`。
- 本机：`~/.kiro/settings/mcp.json`（mcpServers: pencil），无应用本体，`kiro-cli` 不在 PATH。CLI 是否读这个全局文件取决于 agent 配置里的 `includeMcpJson`（kiro.dev/docs/custom-agents/configuration-reference/）。

### 10. GitHub Copilot CLI
- 官方：编辑 `~/.copilot/mcp-config.json`，远程服务 `type:"http"`、`url`、`headers`、`tools:["*"]`；CLI 命令行有 `--header "HEADER: VALUE"`；skills 个人目录 `~/.copilot/skills` 和 `~/.agents/skills`（官方强调支持位置因产品而异）。官方页没写 headers 的环境变量插值语法，也没提 `COPILOT_HOME`。
- 本机：`~/.copilot` 有 `config.json`（131 字节，不是严格 JSON，没解析）、`ide/*.lock`、`logs`，`mcp-config.json` 尚不存在；`copilot` 不在 PATH。

### 11. Cline
- 官方：CLI 版文件 `~/.cline/data/settings/cline_mcp_settings.json`（可用 `CLINE_MCP_SETTINGS_PATH` 覆盖），`mcpServers`，远程服务 `type:"streamableHttp"`（**不写会默认回退旧 sse**）、`url`、`headers`、`disabled`、`autoApprove`；VS Code 扩展版官方页只说在界面里 Configure MCP Servers，没给磁盘路径。skills 官方页：全局 `~/.cline/skills/`。
- 与 Gemini 冲突：Gemini 给了 `transport:"http"` 和 VS Code 路径 `.../globalStorage/saoudrizwan.claude-dev/settings/...`，前者与官方 `type:"streamableHttp"` 不符，后者官方没写，都不采信。
- 与 vercel 表冲突：表里 Cline 的全局 skills 是 `~/.agents/skills`，官方页是 `~/.cline/skills`，以官方为准。
- 本机：`~/.cline/data/globalState.json`（含 `clineVersion`）与 `workspaces`，没有 `settings` 子目录；VS Code 的 globalStorage 里没有 Cline，所以是 CLI/独立版。

### 12. 通义灵码 Lingma
- 官方：灵码已更名为 Qoder CN（docs.qoder.cn 有“Qoder CN（原灵码）”系列页）。灵码 MCP 页只支持 STDIO 与 SSE，只说“个人设置 → MCP 服务 → 配置文件添加”，没有文件路径、没有 Streamable HTTP、没有自定义请求头，页面还提示内容可能过期。skills：docs.qoder.cn 技能页写用户级 `~/.lingma/skills/{skill}/SKILL.md`，手动拷入后要重启 IDE。
- 本机：`~/.lingma` 有 `bin/1.4.10`、`bin/config.json`、`extension/local/config.json`、`model`、`cache` 等，没有任何 MCP 文件，也没有 skills 目录。
- 结论：MCP 登记 `none`；skills 目录官方有写，可装。

### 13. Claude Desktop
- 官方：`claude_desktop_config.json` 在 macOS `~/Library/Application Support/Claude/`、Windows `%APPDATA%\Claude\`，根键 `mcpServers`，用于**本地**服务。远程自定义连接器（Customize → Connectors → Add custom connector，支持 Request headers）由 Anthropic 云端发起连接，连不到本机 127.0.0.1。skills 只能在 Customize → Skills 上传 ZIP，没有本地目录。
- 结论：想让 Claude Desktop 用本机 AI Cut，只能写一个 stdio 桥：`npx -y mcp-remote <url> --allow-http --header "Authorization:${AUTH_HEADER}"`，token 放进 `env.AUTH_HEADER`（mcp-remote README 的 Windows 空格 workaround 写法）。依赖用户装了 Node/npx，桥接写法出自第三方仓库而非 Anthropic 文档，路径与容器键出自 MCP 官方文档。
- 本机：`Claude.app`、`claude_desktop_config.json`（顶层 `mcpServers`、`coworkUserFilesPath`、`preferences`；服务名 firecrawl、exa、tavily、pencil）。Linux 官方页没给路径，登记为空。

## 与上游 `client-connect.ts` 或 Gemini 说法冲突的地方（汇总）

| # | 对象 | 上游/Gemini 说法 | 官方页（或本机）说法 | 处理 |
|---|---|---|---|---|
| 1 | Antigravity 路径 | `~/.gemini/antigravity/mcp_config.json` | 官方：`~/.gemini/config/mcp_config.json`；旧路径官方页未提及，本机仅旧路径存在 | 主写官方路径，旧路径存在则同写 |
| 2 | Antigravity 字段 | `httpUrl` | 官方：用 `serverUrl`（`url` 也行），`httpUrl` “不支持” | 用 `serverUrl` |
| 3 | Qoder 文件 | 上游 `~/.qoder/settings.json` | 官方同；但本机 IDE 的 `settings.json` 无 `mcpServers`，却有 `~/.qoder/mcp.json` | 主写 settings.json，mcp.json 存在则同写，实测前存疑 |
| 4 | Cursor 的 `type` | 上游带 `type:"http"` | 官方示例无 `type` | 用官方形式 |
| 5 | Codex 鉴权 | 上游 `--bearer-token-env-var` + 写 `~/.zshrc`/Windows 用户环境变量 | 官方 `http_headers` 可直接写 Authorization | 推荐 `http_headers` |
| 6 | Cline | Gemini：`transport:"http"`，VS Code 路径 | 官方：`type:"streamableHttp"`，VS Code 路径未写 | 采官方，不登记 VS Code 路径 |
| 7 | Roo Code | Gemini：`transport:"http"` | 官方：`type:"streamable-http"` | 采官方 |
| 8 | Kiro | Gemini：127.0.0.1 放行 | 官方只点名 localhost | 标待验 |
| 9 | Cline skills | vercel：`~/.agents/skills` | 官方：`~/.cline/skills` | 采官方 |
| 10 | Qoder CN skills | vercel：`~/.qoder-cn/skills` | docs.qoder.cn：`~/.lingma/skills` | 两处都写，`verified:false` |
| 11 | Trae | Gemini：`~/Library/Application Support/Trae/User/mcp.json` | 官方未写全局路径 | 只给复制 |

## 没核实成的项和原因

| 项 | 原因 | 影响 |
|---|---|---|
| Trae（国际版）MCP/skills | docs.trae.ai 是 SPA，抓取只拿到标题；国内版 docs.trae.cn 能抓，已核实 | `trae` 的 MCP 与 skills 为 `verified:false`；全局 mcp.json 路径两版官方页都没给 |
| iFlow CLI 远程字段 | 官方页只列了 `iflow mcp add --transport http --header` 命令，settings.json 里远程服务字段没写 | `httpUrl` 是按 Gemini CLI 同源推断，`verified:false` |
| Continue 全局 `mcpServers/` 与 headers 写法 | 官方只写工作区级 `.continue/mcpServers/`；`requestOptions` 只说“与模型 requestOptions 同格式” | `verified:false` |
| Crush 的 MCP | 配置迁到 crushrc，JSON 弃用，headers 写法没抓到 | 登记 `none` |
| Warp 是否支持 Streamable HTTP | 官方把 `url` 描述为 SSE 端点 | 路径与字段已核实，传输方式待验 |
| Kiro 对 127.0.0.1 的接受 | 官方只写 localhost | 需要实测，不行改用 localhost |
| Qoder IDE 到底读哪个用户级 MCP 文件 | 路径由语言服务下发，bundle 内未写死 | 双写兜底，待实测 |
| Qoder CN 的 skills 目录 | 官方两处说法相反 | 双写，`verified:false` |
| Codex 的 `~/.codex/skills` 是否仍被扫描 | 官方页只写 `~/.agents/skills` | 注册表用官方路径 |
| Gemini CLI settings.json 是否允许注释 | 官方页没写 | 解析失败就降级复制 |
| OpenCode、Droid 的 Windows 全局路径 | 官方页没写 | 暂按 `~/.config/opencode`、`~/.factory` 处理 |
| Claude Desktop 在 Linux 的路径 | 官方页没给 | 登记为空 |
| Cline VS Code 扩展版 MCP 路径 | 官方页没写磁盘路径 | 不登记 |
| Zed、Warp、Kilo、Continue、Goose、iFlow、Trae 的 skills 目录 | 只有 vercel 表，没查它们各自官方页 | `skills.verified:false` |
| Junie 的 IDE 插件版 | 核实的是 Junie CLI 页 | 是否共用同一文件待验 |
| 本机各 agent 是否真装 | 只看目录/文件/PATH，没启动任何 agent | “已装?”一列为证据判断，不是确认 |
| 没有任何一项做过“真写入后 agent 能连上”的实测 | 任务限定只读调研，不能改用户配置 | 整份注册表是“文档层面核实”，不是端到端验收 |
