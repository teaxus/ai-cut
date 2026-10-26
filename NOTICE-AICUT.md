# AI Cut 修改声明与第三方许可提示

## 1. 与上游的关系

AI Cut 是 [OpenChatCut](https://github.com/0xsline/OpenChatCut) 的修改版（modified version），
基线为上游 release tag（见 `aicut.json` 的 `upstreamTag`）。整个作品继续以 **GNU AGPL v3 或更新版本** 发布。
上游的版权声明、许可证（`LICENSE`）和 `src/agent/skills/NOTICE.md`（该目录改编自 GPL-3.0-only 的
ChatCut-Inc/agent-plugin）原样保留。

分发 AI Cut 安装包时，对应源码（本仓库对应 tag 的全部文件，含 `tools/` 下的构建脚本）一并公开。
应用内的"GitHub 仓库"链接指向本仓库（接入点 IP-07）。

## 2. 改动过的上游文件（AGPL-3.0 第 5(a) 条）

AI Cut 只在下列位置改动上游文件，每处改动旁有 `aicut-hook:<编号>` 注释；完整的意图与合并策略见
`docs/integration-points.md`。其余派生代码全部是新文件（`aicut/` 目录与 `aicut` 前缀的文件、`tools/`、`docs/`）。

| 编号 | 文件 | 改动 | 日期 |
|---|---|---|---|
| IP-01 | `.gitignore` | 末尾追加派生版的规则块 | 2026-10-25 |
| IP-02 | `src/ui/upstreamUpdate.ts` | 更新检查地址、版本号 | 2026-10-25 |
| IP-03 | `src/ui/upstreamUpdate.verify.ts` | 跟随 IP-02 的断言 | 2026-10-25 |
| IP-04 | `index.html` | 页面标题 | 2026-10-25 |
| IP-05 | `public/openchatcut-icon.png` | 换成 AI Cut 图标 | 2026-10-25 |
| IP-06 | `src/components/icons.tsx` | 字标 | 2026-10-25 |
| IP-07 | `src/components/DashboardHeaderLinks.tsx` | 源码与反馈链接 | 2026-10-25 |
| IP-08 | `desktop/embedded-port.ts` | 默认端口与端口记忆位置可由环境变量指定 | 2026-10-25 |
| IP-09 | `server/plugins/index.ts` | 注册派生版的服务端插件 | 2026-10-25 |
| IP-11 | `src/i18n/dict/en/index.ts` | 并入派生版的英文词条 | 2026-10-25 |
| IP-12 | `src/components/chat/ChatPanelView.tsx` | 聊天栏折叠态的品牌字 | 2026-10-25 |
| IP-13 | `server/runtime-profile.ts` | 默认数据根目录可由环境变量指定 | 2026-10-25 |
| IP-14 | `server/data-dir.ts` | 数据目录指针文件位置跟随数据根目录 | 2026-10-25 |
| IP-15 | `server/mcp-token.ts` | MCP 令牌文件位置跟随数据根目录 | 2026-10-25 |
| IP-16 | `src/components/settings/mcpGuideLoader.ts` | 顶栏插头按钮加载派生版的「Agent 接入」弹窗 | 2026-10-25 |

## 3. 商标

AGPL 不授予商标权。"OpenChatCut" 名称与图标属于上游项目；AI Cut 的外壳（应用名、图标、窗口标题、字标、
源码与反馈入口）已全部替换。深层界面文案里残留的 "OpenChatCut" 字样是"基于 OpenChatCut"的技术事实，
不表示上游对 AI Cut 的背书或支持。请不要把 AI Cut 的问题报到上游。

## 4. 需要另行确认的第三方条件（判断，不是法律意见）

以下条件独立于 AGPL，来自上游依赖与素材（详见 `docs/research/upstream-survey-v0.2.17.md` 第 12 节）：

- **Remotion**（渲染引擎）：个人、3 人以内的营利组织、非营利组织免费；规模更大的营利组织需要购买公司授权。
- **GitHub Copilot CLI**（内置 Agent 可选用）：专有许可，只允许原样再分发。
- **字体**：多数为 OFL-1.1；另有 5 款"免费商用"字体（胡晓波 ×3、庞门正道 ×2），再分发条款待确认。
- **音效、语音样本、LUT、厂商图标**：上游未附许可说明，来源与许可待确认。
