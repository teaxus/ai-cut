import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_MARKER, canonicalSkillDir, inspectSkill, installSkill, skillSourceDir, uninstallSkill,
} from '../server/external-agent/aicut/skill-installer.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aicut-skill-'));
  const source = join(root, 'source');
  mkdirSync(join(source, 'references'), { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), '---\nname: ai-cut\n---\n# AI Cut\n');
  writeFileSync(join(source, 'references', 'a.md'), 'A');
  return { root, source, canonical: canonicalSkillDir(join(root, '.ai-cut')), skills: join(root, 'home', '.claude', 'skills') };
}

test('仓库里的 skills/ai-cut 能被找到；技能实体放在 AI Cut 数据目录下', () => {
  assert.ok(skillSourceDir({}, process.cwd())?.endsWith(join('skills', 'ai-cut')));
  assert.equal(skillSourceDir({ AICUT_SKILL_DIR: '/nope' }, '/also-nope'), null);
  assert.equal(canonicalSkillDir('/x/.ai-cut'), join('/x/.ai-cut', 'agent-skill', 'ai-cut'));
});

test('安装 = 实体复制一份 + agent 目录里放链接；源变了 → 需更新；更新后恢复；卸载只删链接', async () => {
  const { source, canonical, skills } = fixture();
  assert.equal(await inspectSkill(skills, source, canonical), 'absent');
  assert.equal(await installSkill(skills, source, canonical, new Date(), 'darwin'), 'link');
  const target = join(skills, 'ai-cut');
  assert.ok(lstatSync(target).isSymbolicLink());
  assert.equal(readlinkSync(target), canonical);
  assert.equal(readFileSync(join(target, 'references', 'a.md'), 'utf8'), 'A', '经链接能读到内容');
  assert.ok(existsSync(join(canonical, SKILL_MARKER)));
  assert.equal(await inspectSkill(skills, source, canonical), 'installed');
  writeFileSync(join(source, 'references', 'a.md'), 'B');
  assert.equal(await inspectSkill(skills, source, canonical), 'outdated');
  await installSkill(skills, source, canonical, new Date(), 'darwin');
  assert.equal(readFileSync(join(target, 'references', 'a.md'), 'utf8'), 'B', '更新的是实体，链接不变');
  assert.equal(await inspectSkill(skills, source, canonical), 'installed');
  assert.equal(await uninstallSkill(skills, canonical), true);
  assert.equal(existsSync(target), false);
  assert.ok(existsSync(join(canonical, 'SKILL.md')), '实体保留（别的 agent 可能还在用）');
  assert.equal(await uninstallSkill(skills, canonical), false);
});

test('两个 agent 共用同一份实体', async () => {
  const { root, source, canonical, skills } = fixture();
  const other = join(root, 'home', '.cursor', 'skills');
  await installSkill(skills, source, canonical, new Date(), 'darwin');
  await installSkill(other, source, canonical, new Date(), 'darwin');
  assert.equal(readlinkSync(join(other, 'ai-cut')), canonical);
  assert.equal(await inspectSkill(other, source, canonical), 'installed');
});

test('同名目录 / 指向别处的链接不是 AI Cut 装的：不覆盖、不删除', async () => {
  const { root, source, canonical, skills } = fixture();
  mkdirSync(join(skills, 'ai-cut'), { recursive: true });
  writeFileSync(join(skills, 'ai-cut', 'SKILL.md'), 'mine');
  assert.equal(await inspectSkill(skills, source, canonical), 'foreign');
  await assert.rejects(installSkill(skills, source, canonical), /不是 AI Cut 装的/);
  await assert.rejects(uninstallSkill(skills, canonical), /不是 AI Cut 装的/);
  assert.equal(readFileSync(join(skills, 'ai-cut', 'SKILL.md'), 'utf8'), 'mine');
  const elsewhere = join(root, 'home', '.kiro', 'skills');
  mkdirSync(elsewhere, { recursive: true });
  symlinkSync(join(root, 'someone-else'), join(elsewhere, 'ai-cut'));
  assert.equal(await inspectSkill(elsewhere, source, canonical), 'foreign');
  await assert.rejects(installSkill(elsewhere, source, canonical), /不是 AI Cut 装的/);
});

test('旧的复制版（带标记）会在安装时换成链接', async () => {
  const { source, canonical, skills } = fixture();
  mkdirSync(join(skills, 'ai-cut'), { recursive: true });
  writeFileSync(join(skills, 'ai-cut', 'SKILL.md'), 'old copy');
  writeFileSync(join(skills, 'ai-cut', SKILL_MARKER), '{"installedBy":"AI Cut","hash":"x"}');
  assert.equal(await inspectSkill(skills, source, canonical), 'outdated');
  assert.equal(await installSkill(skills, source, canonical, new Date(), 'darwin'), 'link');
  assert.ok(lstatSync(join(skills, 'ai-cut')).isSymbolicLink());
});
