---
name: aicut-upstream-sync
description: 把上游 OpenChatCut 的新版本同步进 AI Cut（ai-cut 仓库）。当用户说"同步上游 / 升级 OpenChatCut / 上游发新版了 / sync upstream / merge upstream release"，或 `./tools/upstream-sync.sh check` 报出新版本时使用。覆盖：检查新版本、合并、按接入点清单解决冲突、门禁、生成特性报告、把上游新特性跟进到 AI Cut 的技能与文档、收尾。
---

# 同步上游 OpenChatCut → AI Cut

AI Cut 是 OpenChatCut 的薄壳派生版：上游代码原样保留，派生版只在 `docs/integration-points.md` 登记过的位置改上游文件
（每处带 `aicut-hook:<编号>` 标记），其余都在新文件里。同步 = 按版本 `git merge` 上游的 release tag。
先读仓库根目录的 `CLAUDE.md`（硬规则）。

## 流程

1. **检查**：`./tools/upstream-sync.sh check` —— 列出比基线新的 tag，以及最新版动到了哪些接入点文件。
   一次只合一个版本还是直接合到最新：默认直接合最新的 release tag（中间版本没有单独发布的意义）。
2. **合并**：`./tools/upstream-sync.sh start <tag>`（要求工作区干净）。
   - 无冲突：脚本自动更新 `aicut.json`（基线、修订号归 1）、重新生成 `skills/ai-cut`、提交。
   - 有冲突（退出码 3）：按下一节解决，`git add` 后 `git commit --no-edit`，再跑 `./tools/upstream-sync.sh start <tag> --continue`。
3. **门禁**：`./tools/upstream-sync.sh gate --install`（上游改了依赖必须加 `--install`）。失败就修，修到全绿。
   想再确认打包链路：加 `--package`。
4. **报告**：`./tools/upstream-sync.sh report` → `docs/upgrades/<tag>.md`。读一遍并填写第 7 节"跟进结论"（见下文）。
5. **收尾**：`./tools/upstream-sync.sh finish` —— 快进合并回 `main` 并打本地 tag。**不要推送**，推送由用户确认。
6. 交付给用户：版本区间、冲突与处理、门禁结果、报告路径、需要用户决定的事（如有）。

## 解决冲突

按 `docs/integration-points.md` 里该文件的「合并策略」：

| 策略 | 怎么解 |
|---|---|
| `keep-hook` | 接受上游的全部改动，再把我们那一行 / 一小块按「意图」放回合适的位置（上游改了结构就跟着结构走）。`aicut-hook:<编号>` 标记必须保留 |
| `ours` | 以派生版为准；但先读上游在这块改了什么——如果上游加了新功能（例如更新检查多了参数），把功能吸收进来、只保留我们的品牌 / 地址差异 |
| `binary-ours` | `git checkout --ours <文件>` |

不是接入点的文件出现冲突，说明派生版改了不该改的地方，或者上游重构把我们的代码挪了位置：
一般直接取上游版本（`git checkout --theirs <文件>`），再检查我们的功能是否仍然接得上；需要新的接入点就先登记再改。

几类常见情况：
- **生成文件**（`assets/agent/openchatcut-tool-schemas.json`）：取上游版本，然后 `npm run generate:server-tool-catalog`。
- **`package.json` / `package-lock.json`**：派生版从不改它们；出现冲突说明有人违反了规则，取上游版本。
- **上游把被改的模块拆分 / 改名**（500 行门禁常导致拆文件）：在新位置重新落钩子，更新清单里的文件名，`gate` 会检查标记。
- **上游删掉了某个接入点所在的功能**：把该接入点状态改成 `removed` 并写原因，不删行。

`git rerere` 已开（`./tools/setup-repo.sh` 配的），解过一次的同类冲突下次会自动复用。

## 跟进上游新特性（报告第 7 节）

- **新 / 变化的 MCP 工具**：外部 agent 通过 `skills/ai-cut` 使用 AI Cut；它由 `node tools/lib/sync-skill.mjs` 从上游
  `skills/openchatcut` 生成，`start` 已经重跑过。若上游技能新增了文件或段落导致改写规则没命中，`sync-skill --check`
  会报错 —— 改 `tools/lib/sync-skill.mjs` 的规则，不要手改 `skills/ai-cut`。
- **新的 agent 客户端支持**（上游 `server/external-agent/client-connect.ts` 增加了客户端）：对照
  `shared/aicut/agents.json`，把该客户端的写法核实后加进注册表（来源记进 `docs/research/agent-registry.md`）。
- **新设置项 / 新外部服务**：一般无需派生版处理（上游设置页原样可用）。
- **品牌残留**：上游新加的界面若在外壳位置出现 "OpenChatCut"（窗口标题、字标、关于、更新提示），按 `docs/ux/branding-shell.md` 处理。

## 不要做的事

- 不要 rebase `main`，不要改写已提交的历史；不要 `git push --force`。另一个原因：rebase / cherry-pick 时 git 的
  "ours" 指的是**被重放到的那一边（上游）**，`.gitattributes` 的 `merge=ours`（README）会因此悄悄保留上游的 README、
  丢掉派生版的（2026-10-25 预演实测）。同步只用 `merge`。
- 不要为了让门禁通过去改上游的 verify（接入点 IP-03 那种跟随改动除外，且必须已登记）。
- 不要在 `package.json` 里加脚本或依赖。
