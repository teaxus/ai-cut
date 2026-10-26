// ai-cut 的 Electron 主进程入口。打包时 config/aicut-electron-builder.config.mjs 用 extraMetadata.main
// 指向它的编译产物 desktop-dist/aicut-main.mjs（tools/lib/build-entry.mjs 生成），上游入口原样保留。
// 它只做一件事：在加载上游代码之前设置派生版的环境（数据根目录 ~/.ai-cut、默认端口 5299、自带技能的位置）。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AICUT_DEFAULT_PORT, AICUT_HOME_ENV, AICUT_PORT_ENV } from '../../shared/aicut/home.ts';

process.env[AICUT_HOME_ENV] ||= join(homedir(), '.ai-cut');
process.env[AICUT_PORT_ENV] ||= String(AICUT_DEFAULT_PORT);
// 「Agent 接入」要复制给各 agent 的技能：打包时由 config/aicut-electron-builder.config.mjs 放进 resources/aicut-skill。
const bundledSkill = join(process.resourcesPath ?? '', 'aicut-skill');
if (!process.env.AICUT_SKILL_DIR && existsSync(join(bundledSkill, 'SKILL.md'))) process.env.AICUT_SKILL_DIR = bundledSkill;

// 相对路径且标记为 external（与上游 bootstrap → app-main 同一做法）：产物与上游的 main.mjs 在同一目录。
await import('./main.mjs');
