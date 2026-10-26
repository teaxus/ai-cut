# CLAUDE.md — ai-cut

ai-cut 是 [OpenChatCut](https://github.com/0xsline/OpenChatCut)（AGPL-3.0-or-later）的**薄壳派生版**：
上游代码原样保留，按版本 `git merge` 上游 tag；派生版自己的东西放在新文件里，只在少数登记过的位置改上游文件。

先读：`docs/PLAN.md`（方案）、`docs/integration-points.md`（所有改动上游文件的位置）、`docs/decisions.md`。

## 硬规则（违反任何一条，下次同步上游就会冲突或门禁变红）

1. **不改 `package.json`**（上游 28% 的提交都改它）。派生版的构建、测试、同步一律走 `tools/*.sh`。
   打包元数据（名字、版本、入口）在 `config/aicut-electron-builder.config.mjs` 里用 `extraMetadata` 覆盖。
2. **派生测试不叫 `*.verify.*`**：上游门禁要求每个 `.verify` 文件都登记进 `package.json`。
   派生测试放 `aicut-tests/`，命名 `*.test.ts`，由 `tools/test.sh` 运行。
3. **改上游文件 = 新增一个接入点**：先在 `docs/integration-points.md` 登记（编号、意图、合并策略），
   再在改动处写 `aicut-hook:<编号>` 注释（文件格式不允许注释的除外，如 PNG）。
   `tools/upstream-sync.sh gate` 会检查每个登记的标记都还在。
4. 派生代码放 `aicut/` 子目录或带 `aicut` 前缀的文件：`server/plugins/aicut/`、`server/external-agent/aicut/`、
   `src/components/settings/aicut/`、`desktop/aicut/`、`src/i18n/dict/<lang>/aicut.ts`、`assets/aicut/`、`tools/`。
5. 遵守上游门禁：非测试源码 ≤ 500 行；`t('中文')` 必须有英文词条（中文就是 key）；
   改了 agent 工具要重新生成 `assets/agent/openchatcut-tool-schemas.json`（`npm run generate:server-tool-catalog`）。
6. 上游的 `scripts/` 目录默认被 `.gitignore` 忽略，派生脚本不要放那里。
7. 不要在本机抢 5199（用户的 OpenChatCut 开发服务常驻在那里）；ai-cut 默认端口 5299，数据目录 `~/.ai-cut`。
8. 本机钥匙串里有公司的签名证书：本机打包必须走 `tools/build.sh`（它设置了 `CSC_IDENTITY_AUTO_DISCOVERY=false`），
   不要直接跑 electron-builder。

## 常用入口

| 做什么 | 命令 |
|---|---|
| 初始化克隆（remote、rerere、合并驱动） | `./tools/setup-repo.sh` |
| 检查本机环境 | `./tools/doctor.sh` |
| 测试（上游门禁 + 派生测试） | `./tools/test.sh` |
| 打包 | `./tools/build.sh -h` |
| 同步上游 | `./tools/upstream-sync.sh -h`，流程见 `.claude/skills/aicut-upstream-sync/SKILL.md` |
| Agent 接入 | `./tools/aicut-agents.sh -h` |
