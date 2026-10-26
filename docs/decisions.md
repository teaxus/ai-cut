# 决策记录

| 编号 | 日期 | 决策 | 理由 / 依据 |
|---|---|---|---|
| D-01 | 2026-10-25 | 不重写，做 OpenChatCut 的薄壳派生版：fork + 按版本 `git merge` 上游 tag | 上游已有完整 Electron 桌面版；重写永远追不上（`docs/PLAN.md` §1、§3） |
| D-02 | 2026-10-25 | 名字：仓库与目录 `ai-cut`，显示名 `AI Cut`，appId `com.teaxus.aicut`，代码命名空间 `aicut` | 用户决定，避开 "OpenAI" 商标联想 |
| D-03 | 2026-10-25 | 基线：上游 tag `v0.2.17`（`72ddb330`），之后只合并上游的 release tag，不追 main | tag 是上游发布过、CI 和四平台安装包都过了的点 |
| D-04 | 2026-10-25 | 托管默认：GitHub 公开仓库 `teaxus/ai-cut`，Releases 作更新源（**创建和推送需用户确认**） | AGPL 要求分发时源码可得；electron-updater 直接认 GitHub Releases |
| D-05 | 2026-10-25 | 数据目录与上游隔离：`~/.ai-cut`；模型缓存仍用上游的 `~/.openchatcut/asr-models` | 并装时不共用项目库、token、端口记忆；模型几百 MB 到几 GB，不重复下载 |
| D-06 | 2026-10-25 | 默认端口 5299（端口记忆文件独立） | 本机 5199 常驻用户的 OpenChatCut 开发服务 |
| D-07 | 2026-10-25 | macOS 不签名、不公证（同上游）；本机打包关掉证书自动发现 | 没有 Developer ID；本机钥匙串里是公司证书，不能误签 |
| D-08 | 2026-10-25 | 不出 Linux 包 | 没有验收设备 |
| D-09 | 2026-10-25 | 保留上游 Web（B/S）开发模式 | 零成本，上游开发链路需要 |
| D-10 | 2026-10-25 | 版本号：`<上游版本>-aicut.<N>`，`package.json` 不动，打包时注入 | `package.json` 是上游冲突第一源 |
| D-11 | 2026-10-25 | 默认界面语言沿用上游逻辑（已保存的选择 → 系统语言 zh/it/ru → 英文），不设接入点 | 上游已按系统语言选中文，原方案的"建议改"没有必要 |
| D-12 | 2026-10-25 | `README.md`、`README_ZH.md` 完全由派生版维护（`.gitattributes` 的 `merge=ours`） | 上游 README 改动频繁（84 次），派生版的 README 内容本来就不同 |
| D-13 | 2026-10-25 | 模型缓存、内容插件（`~/.openchatcut/plugins`）、用户技能（`~/.openchatcut/skills`）、Codex/Copilot 隔离目录与上游共用 | 这些是可复用资产，共用无害且省空间；隔离它们要多改 4 个上游文件 |
| D-14 | 2026-10-25 | 派生入口 `desktop/aicut/entry.ts` 在加载上游主进程前设置 `AICUT_HOME=~/.ai-cut`、`AICUT_CANONICAL_PORT=5299`；上游代码里只把写死的 `~/.openchatcut` 与 5199 换成读这两个变量的函数（不设时与上游一致） | 上游 verify 不受影响；派生行为集中在一个入口文件里 |
| D-15 | 2026-10-25 | macOS 无证书时由派生打包配置显式 ad-hoc 签名（osx-sign `identity: '-'`） | electron-builder 26 把上游的 `identity: '-'` 当子串匹配钥匙串证书，本机会误用名字带 "-" 的自签证书 |
