> 预演产物（2026-10-25）：在独立克隆里把派生提交重放到 v0.2.16，再用 `tools/upstream-sync.sh` 合并 v0.2.17 生成。真实同步时报告会写到 `docs/upgrades/<tag>.md`。

# 上游同步报告：v0.2.16 → v0.2.17

生成：2026-10-26　上游版本 0.2.16 → 0.2.17　由 `tools/upstream-sync.sh report` 生成，可人工补充"跟进结论"一节。

- 提交数：20；改动：76 files changed, 1324 insertions(+), 342 deletions(-)

## 1. 上游 CHANGELOG

## [0.2.17] - 2026-10-15

### Added / 新增

- The built-in Agent can browse and import local media in a browser-hosted editor once `AGENT_IMPORT_ROOTS` lists the directories to expose, reaching the same probe/hash/dedupe chain the desktop app uses; the desktop app keeps its default access (#185).
  浏览器端的内置 Agent 在 `AGENT_IMPORT_ROOTS` 列出允许目录后，也可以浏览和导入本地素材，复用桌面端相同的探测、哈希与去重流程；桌面端保持原有的默认访问行为（#185）。

### Changed / 调整

- Doubao 配音改走火山新版音频生成接口 `POST /api/v3/tts/create`，`X-Api-Key` 单头鉴权，Base URL 填完整接口地址也能正常请求；配置项改为 `DOUBAO_TTS_API_KEY` + `DOUBAO_TTS_MODEL`（默认 `seed-audio-1.0`），旧的 App ID / Access Key / 音色资源 ID 不再使用，需用新版控制台的 API Key 重填。支持 `speedRatio` / `loudnessRatio` / 原生 `pitch`，`emotion` / `emotionScale` / `performancePrompt` / 方言不再支持。
  Doubao TTS now uses the new Volcengine audio-generation endpoint `POST /api/v3/tts/create` with single-header `X-Api-Key` auth, and accepts a full endpoint URL as Base URL. Config is now `DOUBAO_TTS_API_KEY` + `DOUBAO_TTS_MODEL` (default `seed-audio-1.0`); the old App ID / Access Key / resource ID are removed, refill with a new-console API key. Supports `speedRatio` / `loudnessRatio` / native `pitch`; `emotion` / `emotionScale` / `performancePrompt` / dialect are no longer supported.

### Fixed / 修复

- Move left/right to boundary (`Ctrl + E` / `Ctrl + R`) now fires on Windows and Linux; every shortcut catalog row is asserted to match its advertised chord on both platforms (#202, #203).
  「左贴边 / 右贴边」（`Ctrl + E` / `Ctrl + R`）在 Windows 与 Linux 上恢复可用；新增断言要求快捷键目录里每一行在两种平台都能被自己的写法命中（#202、#203）。
- Desktop whisper.cpp transcripts group BPE tokens into words: multi-token words (Russian, German compounds, …) no longer split with inner spaces, punctuation stays attached to its word, and scripts without spaces (Chinese, Japanese, Thai) still split per chunk (#206, #207).
  桌面端 whisper.cpp 转写按 BPE 规则把 token 还原成词：俄语、德语复合词等多 token 词不再被拆开并插入空格，标点跟随其所属单词；中日泰等无空格文字仍按块切分（#206、#207）。
- Windows verification gates pass on a stock checkout, and verification suites no longer read or write the developer's real profile (`USERPROFILE`) (#208, #209, #210, #211).
  Windows 上验证门禁在全新检出即可通过；验证套件不再读写开发者真实用户目录（`USERPROFILE`）（#208、#209、#210、#211）。
- Preview: the CC button and the rendered picture share one caption-visibility decision, hallucinated ASR words no longer silence an audio clip, and transcript windows starting past the end of the media are rejected (#213).
  预览：字幕开关与画面共用同一可见性判定，幻觉出的 ASR 词不再把音频片段静音，转写窗口越过素材末尾时会被拒绝（#213）。
- Internal: `server/key-probes.ts` split back under the 500-line gate (MiniMax/Doubao HTTP-200 business-code checks moved into `server/key-probe-result.ts`), unbreaking `npm test` on `main`.
  内部：`server/key-probes.ts` 拆回 500 行门禁以内（MiniMax/Doubao 的「HTTP 200 业务码」后检移入 `server/key-probe-result.ts`），修复 `main` 上 `npm test` 的红灯。

## 2. agent 能用的 MCP 工具（assets/agent/openchatcut-tool-schemas.json）

新增 0、删除 0、参数或说明变化 5。

**变化**
- `browse_local_media`
- `import_asset`
- `import_assets`
- `import_folder`
- `submit_voice`

## 3. 技能

外部技能 `skills/openchatcut`（派生版据此生成 `skills/ai-cut`，跑 `node tools/lib/sync-skill.mjs`）：

```
（无变化）
```

内置专项技能 `src/agent/skills/`：

```
.../references/generation-capabilities.md          |  2 +-
 .../product-help/references/providers-and-keys.md  |  2 +-
 src/agent/skills/voice/SKILL.md                    | 29 ++++++----------------
 src/agent/skills/voice/references/minimax-tts.md   |  1 -
 src/agent/skills/voice/references/voices.md        | 24 +++++-------------
 5 files changed, 15 insertions(+), 43 deletions(-)
```

## 4. 设置项（server/keystore-names.ts 白名单）

（无变化）

## 5. 依赖变化（package.json）

（无变化）

## 6. 上游改动了的接入点文件

- **IP-09** `server/plugins/index.ts`（keep-hook）：
  - 83650c17 Merge remote-tracking branch 'origin/main' into pr200
  - ba619d6a feat(doubao): migrate TTS to new audio-generation API
  - 12dcedf2 feat(agent): browse and import local media from a browser-hosted editor

## 7. 跟进结论（同步时由人或 AI 填写）

- 新工具 / 新设置是否需要在 AI Cut 的技能或文档里说明：
- 接入点是否需要调整：
- 其他：
