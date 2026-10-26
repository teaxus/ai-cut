// ai-cut：把 AI Cut 的 Agent Skill 装进各 agent 的全局 skills 目录。
// 做法：技能实体只放一处——AI Cut 数据目录下的 agent-skill/ai-cut（从 skills/ai-cut 或打包后的 resources/aicut-skill 复制）；
// 各 agent 的 skills 目录里放一个指向它的链接（macOS / Linux 用符号链接，Windows 用 junction，不需要管理员权限），
// 更新技能只需更新这一处。建链接失败时退回复制一份（目录里带标记文件）。
// 只动我们自己的链接 / 带标记的目录；同名但不是我们装的东西一律不碰。
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SkillState } from '../../../shared/aicut/agent-api.ts';

export type { SkillState };

export const SKILL_NAME = 'ai-cut';
export const SKILL_MARKER = '.aicut-skill.json';

/** 技能源目录：打包后由派生入口设 AICUT_SKILL_DIR；开发时用仓库里的 skills/ai-cut。 */
export function skillSourceDir(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string | null {
  const candidates = [env.AICUT_SKILL_DIR, path.join(cwd, 'skills', SKILL_NAME)].filter((v): v is string => Boolean(v));
  return candidates.find((dir) => existsSync(path.join(dir, 'SKILL.md'))) ?? null;
}

/** 技能实体所在：<AI Cut 数据目录>/agent-skill/ai-cut。 */
export function canonicalSkillDir(dataRoot: string): string {
  return path.join(dataRoot, 'agent-skill', SKILL_NAME);
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

async function readMarker(dir: string): Promise<{ hash?: string } | null> {
  try { return JSON.parse(await readFile(path.join(dir, SKILL_MARKER), 'utf8')); } catch { return null; }
}

/** 把源目录复制到 target（先写到同级临时目录再改名），带标记文件。 */
async function copyWithMarker(source: string, target: string, now: Date): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.aicut-staging`);
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true, filter: (src) => path.basename(src) !== '.DS_Store' });
  const hash = await skillHash(staging);
  await writeFile(path.join(staging, SKILL_MARKER), `${JSON.stringify({ installedBy: 'AI Cut', hash, installedAt: now.toISOString() }, null, 2)}\n`);
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
}

/** 保证技能实体与源一致；不一致就整份替换。 */
export async function ensureCanonical(source: string, canonical: string, now: Date = new Date()): Promise<void> {
  const marker = existsSync(canonical) ? await readMarker(canonical) : null;
  if (marker && marker.hash === await skillHash(source) && await skillHash(canonical) === marker.hash) return;
  await copyWithMarker(source, canonical, now);
}

type Entry = { kind: 'missing' } | { kind: 'link'; to: string } | { kind: 'dir'; ours: boolean } | { kind: 'other' };

async function entryAt(target: string): Promise<Entry> {
  let st;
  try { st = await lstat(target); } catch { return { kind: 'missing' }; }
  if (st.isSymbolicLink()) {
    const raw = await readlink(target);
    return { kind: 'link', to: path.resolve(path.dirname(target), raw) };
  }
  if (st.isDirectory()) return { kind: 'dir', ours: Boolean(await readMarker(target)) };
  return { kind: 'other' };
}

const normalized = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const samePath = (a: string, b: string) => normalized(a) === normalized(b);

export async function inspectSkill(skillsRoot: string, source: string, canonical: string): Promise<SkillState> {
  const target = path.join(skillsRoot, SKILL_NAME);
  const entry = await entryAt(target);
  if (entry.kind === 'missing') return 'absent';
  if (entry.kind === 'other' || (entry.kind === 'dir' && !entry.ours)) return 'foreign';
  const sourceHash = await skillHash(source);
  if (entry.kind === 'link') {
    if (!samePath(entry.to, canonical)) return 'foreign';
    const marker = existsSync(canonical) ? await readMarker(canonical) : null;
    return marker?.hash === sourceHash && await skillHash(canonical) === sourceHash ? 'installed' : 'outdated';
  }
  // 复制模式（建不了链接时的退路）
  const marker = await readMarker(target);
  return marker?.hash === sourceHash && await skillHash(target) === sourceHash ? 'installed' : 'outdated';
}

/** 返回实际采用的方式：'link'（链接到技能实体）或 'copy'（建不了链接时复制）。 */
export async function installSkill(
  skillsRoot: string, source: string, canonical: string,
  now: Date = new Date(), platform: NodeJS.Platform = process.platform,
): Promise<'link' | 'copy'> {
  const target = path.join(skillsRoot, SKILL_NAME);
  const entry = await entryAt(target);
  if (entry.kind === 'other' || (entry.kind === 'dir' && !entry.ours) || (entry.kind === 'link' && !samePath(entry.to, canonical))) {
    throw new Error(`${target} 已存在但不是 AI Cut 装的，不会覆盖`);
  }
  await ensureCanonical(source, canonical, now);
  await mkdir(skillsRoot, { recursive: true });
  if (entry.kind === 'link') return 'link'; // 已经指向技能实体，实体更新即可
  if (entry.kind === 'dir') await rm(target, { recursive: true, force: true }); // 旧的复制版换成链接
  try {
    await symlink(canonical, target, platform === 'win32' ? 'junction' : 'dir');
    return 'link';
  } catch {
    await copyWithMarker(canonical, target, now);
    return 'copy';
  }
}

export async function uninstallSkill(skillsRoot: string, canonical: string): Promise<boolean> {
  const target = path.join(skillsRoot, SKILL_NAME);
  const entry = await entryAt(target);
  if (entry.kind === 'missing') return false;
  if (entry.kind === 'link' && samePath(entry.to, canonical)) { await unlink(target); return true; }
  if (entry.kind === 'dir' && entry.ours) { await rm(target, { recursive: true, force: true }); return true; }
  throw new Error(`${target} 不是 AI Cut 装的，不会删除`);
}
