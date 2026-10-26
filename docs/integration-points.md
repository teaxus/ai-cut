# 接入点清单（派生版改动上游文件的全部位置）

**规则**：派生版只能在这里登记过的位置改上游文件。每处改动旁边写 `aicut-hook:<编号>` 注释
（PNG 这类不能写注释的文件除外，标记列写 `—`）。`tools/upstream-sync.sh gate` 会逐条检查标记还在不在；
合并上游出现冲突时，解冲突的人（或 AI）按「合并策略」和「意图」处理。

合并策略：
- `ours`：整块以派生版为准（上游在这里的改动要人工看一眼是否需要吸收）。
- `keep-hook`：接受上游的全部改动，只保证我们那一行 / 一小块还在（位置跟着上游的结构走）。
- `binary-ours`：二进制文件，保留派生版的那份。

状态：`planned`（方案里有，还没落地）/ `landed`（已落地，gate 会检查）。

| 编号 | 文件 | 标记 | 合并策略 | 状态 | 意图 |
|---|---|---|---|---|---|
| IP-01 | `.gitignore` | `aicut-hook:IP-01` | keep-hook | landed | 末尾的 ai-cut 块：把 `docs/`、`CLAUDE.md`、`AGENTS.md`、`.claude/` 纳入版本管理，忽略派生版本地产物 |
| IP-02 | `src/ui/upstreamUpdate.ts` | `aicut-hook:IP-02` | ours | landed | 更新检查 URL 和"前往发布页" URL 指向派生仓库（来自 `shared/aicut/release.ts`）；当前版本号 = 上游版本 + `-aicut.N` |
| IP-03 | `src/ui/upstreamUpdate.verify.ts` | `aicut-hook:IP-03` | ours | landed | 跟随 IP-02：断言请求的是派生仓库的 releases/latest |
| IP-04 | `index.html` | `aicut-hook:IP-04` | ours | landed | 页面标题 AI Cut（Electron 窗口标题跟随它）；favicon 路径不变，图片本身由 IP-05 替换 |
| IP-05 | `public/openchatcut-icon.png` | — | binary-ours | landed | 原地替换为 AI Cut 图标（512px，源图 `assets/aicut/icon.png`）；Win/Linux 图标、favicon、应用内 BrandMark 都引用这个路径 |
| IP-06 | `src/components/icons.tsx` | `aicut-hook:IP-06` | ours | landed | 字标换成 "AI Cut"；组件名 `OpenChatCutWordmark` 保持不变，调用方不用改 |
| IP-07 | `src/components/DashboardHeaderLinks.tsx` | `aicut-hook:IP-07` | ours | landed | GitHub 链接（AGPL 源码入口）指向派生仓库；"联系作者"改为派生仓库的 issues 页，不再显示上游作者邮箱 |
| IP-08 | `desktop/embedded-port.ts` | `aicut-hook:IP-08` | ours | landed | 规范端口改为读 `AICUT_CANONICAL_PORT`（派生入口设 5299，不设时仍是 5199）；端口记忆文件跟随 `AICUT_HOME` |
| IP-09 | `server/plugins/index.ts` | `aicut-hook:IP-09` | keep-hook | landed | 顶部 import + 插件数组末尾 `...aicutServerPlugins()`；派生服务端插件全部在 `server/plugins/aicut/`（目前是「Agent 接入」的 `/api/aicut/agents/*`） |
| IP-10 | `src/components/settings/settingsSchema.ts` | `aicut-hook:IP-10` | keep-hook | removed | 原计划在设置里加「Agent 接入」分区；改为替换上游已有的「外部 Agent 接入 (MCP)」弹窗（IP-16），不新增第二个入口 |
| IP-11 | `src/i18n/dict/en/index.ts` | `aicut-hook:IP-11` | keep-hook | planned | 组装英文字典时并入 `aicut.ts`（派生界面的词条，中文即 key）；意大利语缺词时回退英文，俄语界面缺词显示中文（上游行为） |
| IP-12 | `src/components/chat/ChatPanelView.tsx` | `aicut-hook:IP-12` | ours | landed | 聊天栏折叠时的竖排品牌字 AI Cut |
| IP-13 | `server/runtime-profile.ts` | `aicut-hook:IP-13` | keep-hook | landed | 默认 profile 的数据根目录改走 `openChatCutHomeRoot()`：设了 `AICUT_HOME`（派生入口设为 `~/.ai-cut`）就用它，否则与上游一致 |
| IP-14 | `server/data-dir.ts` | `aicut-hook:IP-14` | keep-hook | landed | 数据目录指针文件跟随 `AICUT_HOME`，设置页改数据目录不会写进上游的 `~/.openchatcut` |
| IP-15 | `server/mcp-token.ts` | `aicut-hook:IP-15` | keep-hook | landed | MCP token 文件跟随 `AICUT_HOME`，与上游并装时各用各的 token |
| IP-16 | `src/components/settings/mcpGuideLoader.ts` | `aicut-hook:IP-16` | ours | planned | 顶栏插头按钮加载的弹窗换成派生版 `settings/aicut/AgentConnectDialog.tsx`（MCP 与技能一起装进各 agent）；首页、编辑器两处入口都经这一个加载器 |


新增接入点时：编号顺延，不复用旧编号；删除接入点时把状态改成 `removed` 并写明原因，不删行。
