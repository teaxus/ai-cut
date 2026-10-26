// ai-cut：把 AI Cut 的 Agent Skill（skills/ai-cut，打包后在 resources/aicut-skill）复制进各 agent 的全局 skills 目录。
// 目标目录里放一个标记文件，只有带标记的目录才会被更新或删除——同名但不是我们装的目录一律不碰。
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const SKILL_NAME = 'ai-cut';
export const SKILL_MARKER = '.aicut-skill.json';

import type { SkillState } from '../../../shared/aicut/agent-api.ts';

export type { SkillState };

/** 技能源目录：打包后由派生入口设 AICUT_SKILL_DIR；开发时用仓库里的 skills/ai-cut。 */
export function skillSourceDir(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string | null {
  const candidates = [env.AICUT_SKILL_DIR, path.join(cwd, 'skills', SKILL_NAME)].filter((v): v is string => Boolean(v));
  return candidates.find((dir) => existsSync(path.join(dir, 'SKILL.md'))) ?? null;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === SKILL_MARKER || entry.name === '.DS_Store') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(abs, base));
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/** 目录内容指纹：相对路径 + 内容，忽略标记文件。 */
export async function skillHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of await listFiles(dir)) {
    hash.update(rel).update('\0').update(await readFile(path.join(dir, ...rel.split('/')))).update('\0');
  }
  return hash.digest('hex');
}

async function readMarker(target: string): Promise<{ hash?: string } | null> {
  try { return JSON.parse(await readFile(path.join(target, SKILL_MARKER), 'utf8')); } catch { return null; }
}

export async function inspectSkill(skillsRoot: string, source: string): Promise<SkillState> {
  const target = path.join(skillsRoot, SKILL_NAME);
  try { if (!(await stat(target)).isDirectory()) return 'foreign'; } catch { return 'absent'; }
  const marker = await readMarker(target);
  if (!marker) return 'foreign';
  return marker.hash === await skillHash(source) && await skillHash(target) === marker.hash ? 'installed' : 'outdated';
}

export async function installSkill(skillsRoot: string, source: string, now: Date = new Date()): Promise<string> {
  const target = path.join(skillsRoot, SKILL_NAME);
  const state = await inspectSkill(skillsRoot, source);
  if (state === 'foreign') throw new Error(`${target} 已存在但不是 AI Cut 装的，不会覆盖`);
  await mkdir(skillsRoot, { recursive: true });
  const staging = path.join(skillsRoot, `.${SKILL_NAME}.aicut-staging`);
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true, filter: (src) => path.basename(src) !== '.DS_Store' });
  const hash = await skillHash(staging);
  await writeFile(path.join(staging, SKILL_MARKER), `${JSON.stringify({ installedBy: 'AI Cut', hash, installedAt: now.toISOString() }, null, 2)}\n`);
  if (state !== 'absent') await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  return target;
}

export async function uninstallSkill(skillsRoot: string): Promise<boolean> {
  const target = path.join(skillsRoot, SKILL_NAME);
  if (!existsSync(target)) return false;
  if (!(await readMarker(target))) throw new Error(`${target} 不是 AI Cut 装的，不会删除`);
  await rm(target, { recursive: true, force: true });
  return true;
}
