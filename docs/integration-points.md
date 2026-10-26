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
| IP-02 | `src/ui/upstreamUpdate.ts` | `aicut-hook:IP-02` | ours | planned | 更新检查 URL 和"前往发布页" URL 指向派生仓库；版本比较认 `-aicut.N` 后缀 |
| IP-03 | `src/ui/upstreamUpdate.verify.ts` | `aicut-hook:IP-03` | ours | planned | 跟随 IP-02 的断言 |
| IP-04 | `index.html` | `aicut-hook:IP-04` | ours | planned | 页面标题（Electron 窗口标题跟随它）和 favicon |
| IP-05 | `public/openchatcut-icon.png` | — | binary-ours | planned | 原地替换为 AI Cut 图标（Win/Linux 安装包图标、favicon、应用内 BrandMark 都引用这个路径） |
| IP-06 | `src/components/icons.tsx` | `aicut-hook:IP-06` | ours | planned | 字标 `OpenChatCutWordmark` 换成 AI Cut 字标 |
| IP-07 | `src/components/DashboardHeaderLinks.tsx` | `aicut-hook:IP-07` | ours | planned | 源码链接指向派生仓库（AGPL 源码入口），去掉上游作者邮箱 |
| IP-08 | `desktop/embedded-port.ts` | `aicut-hook:IP-08` | ours | planned | 规范端口 5299、端口记忆文件放派生数据目录，与上游并装时不抢 5199 |
| IP-09 | `server/plugins/index.ts` | `aicut-hook:IP-09` | keep-hook | planned | 插件数组末尾 `...aicutServerPlugins()`，派生服务端插件全部在 `server/plugins/aicut/` |
| IP-10 | `src/components/settings/settingsSchema.ts` | `aicut-hook:IP-10` | keep-hook | planned | 设置分类数组末尾追加「Agent 接入」分区 |
| IP-11 | `src/i18n/dict/en/index.ts`（it、ru 同） | `aicut-hook:IP-11` | keep-hook | planned | 组装字典时并入 `aicut.ts` 词条 |

新增接入点时：编号顺延，不复用旧编号；删除接入点时把状态改成 `removed` 并写明原因，不删行。
