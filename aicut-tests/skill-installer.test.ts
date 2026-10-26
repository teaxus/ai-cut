import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_MARKER, inspectSkill, installSkill, skillSourceDir, uninstallSkill } from '../server/external-agent/aicut/skill-installer.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aicut-skill-'));
  const source = join(root, 'source');
  mkdirSync(join(source, 'references'), { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), '---\nname: ai-cut\n---\n# AI Cut\n');
  writeFileSync(join(source, 'references', 'a.md'), 'A');
  return { root, source, skills: join(root, 'home', '.claude', 'skills') };
}

test('仓库里的 skills/ai-cut 能被找到', () => {
  assert.ok(skillSourceDir({}, process.cwd())?.endsWith(join('skills', 'ai-cut')));
  assert.equal(skillSourceDir({ AICUT_SKILL_DIR: '/nope' }, '/also-nope'), null);
});

test('安装 → 已安装；源变了 → 需更新；更新后恢复；卸载', async () => {
  const { source, skills } = fixture();
  assert.equal(await inspectSkill(skills, source), 'absent');
  const target = await installSkill(skills, source);
  assert.equal(readFileSync(join(target, 'references', 'a.md'), 'utf8'), 'A');
  assert.ok(existsSync(join(target, SKILL_MARKER)));
  assert.equal(await inspectSkill(skills, source), 'installed');
  writeFileSync(join(source, 'references', 'a.md'), 'B');
  assert.equal(await inspectSkill(skills, source), 'outdated');
  await installSkill(skills, source);
  assert.equal(readFileSync(join(target, 'references', 'a.md'), 'utf8'), 'B');
  assert.equal(await inspectSkill(skills, source), 'installed');
  assert.equal(await uninstallSkill(skills), true);
  assert.equal(existsSync(target), false);
  assert.equal(await uninstallSkill(skills), false);
});

test('同名目录不是 AI Cut 装的：不覆盖、不删除', async () => {
  const { source, skills } = fixture();
  mkdirSync(join(skills, 'ai-cut'), { recursive: true });
  writeFileSync(join(skills, 'ai-cut', 'SKILL.md'), 'mine');
  assert.equal(await inspectSkill(skills, source), 'foreign');
  await assert.rejects(installSkill(skills, source), /不是 AI Cut 装的/);
  await assert.rejects(uninstallSkill(skills), /不是 AI Cut 装的/);
  assert.equal(readFileSync(join(skills, 'ai-cut', 'SKILL.md'), 'utf8'), 'mine');
});

test('用户改过已安装的技能文件也算需更新', async () => {
  const { source, skills } = fixture();
  const target = await installSkill(skills, source);
  writeFileSync(join(target, 'SKILL.md'), 'edited');
  assert.equal(await inspectSkill(skills, source), 'outdated');
});
