import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SERVER_NAME, fillTemplate, inspectCodexToml, inspectDropin, inspectJson, installCodexToml, installDropin, installJson,
  renderCodexBlock, renderDropin, uninstallCodexToml, uninstallDropin, uninstallJson,
} from '../server/external-agent/aicut/mcp-writers.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'aicut-writers-'));
const vars = { url: 'http://127.0.0.1:5299/api/external-mcp/mcp', token: 'tok_ABC-123', name: SERVER_NAME };
const template = { type: 'http', url: '{url}', headers: { Authorization: 'Bearer {token}' } };
const entry = fillTemplate(template, vars);

test('fillTemplate 深替换占位符且不改原对象', () => {
  const tpl = { a: '{url}', b: ['{token}', 1], c: { d: 'x{name}y' } };
  const out = fillTemplate(tpl, vars);
  assert.deepEqual(out, { a: vars.url, b: [vars.token, 1], c: { d: `x${SERVER_NAME}y` } });
  assert.equal(tpl.a, '{url}');
});

test('JSON：保留别的服务与其他键，只动 ai-cut；状态 absent → installed → outdated', async () => {
  const d = dir(); const file = join(d, 'claude.json'); const backups = join(d, 'bk');
  writeFileSync(file, JSON.stringify({ projects: { x: 1 }, mcpServers: { other: { url: 'keep' } } }));
  assert.equal((await inspectJson(file, ['mcpServers'], entry)).state, 'absent');
  await installJson(file, ['mcpServers'], entry, { backupDir: backups });
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(after.mcpServers.other, { url: 'keep' });
  assert.deepEqual(after.projects, { x: 1 });
  assert.deepEqual(after.mcpServers[SERVER_NAME], entry);
  assert.equal((await inspectJson(file, ['mcpServers'], entry)).state, 'installed');
  assert.equal(readdirSync(backups).length, 1, '改动前备份了原文件');
  const changed = fillTemplate(template, { ...vars, token: 'other' });
  assert.equal((await inspectJson(file, ['mcpServers'], changed)).state, 'outdated');
  assert.equal(await uninstallJson(file, ['mcpServers'], { backupDir: null }), true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).mcpServers[SERVER_NAME], undefined);
  assert.equal(await uninstallJson(file, ['mcpServers'], { backupDir: null }), false, '再卸一次没有改动');
});

test('JSON：多级容器（amp.mcpServers 一类）自动补层级；文件不存在就新建', async () => {
  const d = dir(); const file = join(d, 'sub', 'settings.json');
  await installJson(file, ['amp', 'mcpServers'], entry, { backupDir: null });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { amp: { mcpServers: { [SERVER_NAME]: entry } } });
});

test('JSON：读不懂的文件（注释、数组、容器不是对象）绝不覆盖', async () => {
  const d = dir();
  const cases = { 'c1.json': '{ // comment\n "a": 1 }', 'c2.json': '[1,2]', 'c3.json': '{"mcpServers": []}' };
  for (const [name, text] of Object.entries(cases)) {
    const file = join(d, name); writeFileSync(file, text);
    assert.equal((await inspectJson(file, ['mcpServers'], entry)).state, 'unreadable', name);
    await assert.rejects(installJson(file, ['mcpServers'], entry, { backupDir: null }));
    assert.equal(readFileSync(file, 'utf8'), text, `${name} 原样未动`);
  }
});

test('Codex TOML：追加、原地替换、保留其他表与注释、卸载干净', async () => {
  const d = dir(); const file = join(d, 'config.toml');
  const original = '# my settings\nmodel = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n\n[profiles.fast]\nmodel = "o4"\n';
  writeFileSync(file, original);
  const codex = { url: vars.url, http_headers: { Authorization: `Bearer ${vars.token}` } };
  assert.equal((await inspectCodexToml(file, codex)).state, 'absent');
  await installCodexToml(file, codex, { backupDir: null });
  let text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith(original.trimEnd()), '原内容在前面原样保留');
  assert.ok(text.includes(renderCodexBlock(codex).trim()));
  assert.equal((await inspectCodexToml(file, codex)).state, 'installed');
  const codex2 = { ...codex, url: 'http://127.0.0.1:6000/api/external-mcp/mcp' };
  assert.equal((await inspectCodexToml(file, codex2)).state, 'outdated');
  await installCodexToml(file, codex2, { backupDir: null });
  text = readFileSync(file, 'utf8');
  assert.equal(text.match(/\[mcp_servers\.ai-cut\]/g)?.length, 1, '替换而不是追加第二块');
  assert.ok(text.includes('6000') && !text.includes(':5299'));
  assert.equal(await uninstallCodexToml(file, { backupDir: null }), true);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('Codex TOML：我们的块夹在中间（含子表）时只删我们的', async () => {
  const d = dir(); const file = join(d, 'config.toml');
  writeFileSync(file, `a = 1\n\n${renderCodexBlock({ url: 'u' })}[mcp_servers.ai-cut.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "y"\n`);
  await uninstallCodexToml(file, { backupDir: null });
  assert.equal(readFileSync(file, 'utf8'), 'a = 1\n\n[mcp_servers.other]\ncommand = "y"\n');
});

test('TOML 值转义：引号与反斜杠', () => {
  const block = renderCodexBlock({ url: 'a"b\\c', 'weird key': true, list: ['x', 2] });
  assert.match(block, /url = "a\\"b\\\\c"/);
  assert.match(block, /"weird key" = true/);
  assert.match(block, /list = \["x", 2\]/);
});

test('独立 YAML 文件：带标记才更新 / 删除，别人的同名文件不碰', async () => {
  const d = dir(); const file = join(d, 'mcpServers', 'ai-cut.yaml');
  const content = renderDropin('name: {name}\nurl: {url}\n', vars);
  assert.equal((await inspectDropin(file, content)).state, 'absent');
  await installDropin(file, content, { backupDir: null });
  assert.equal((await inspectDropin(file, content)).state, 'installed');
  assert.equal(await uninstallDropin(file, { backupDir: null }), true);
  assert.equal(existsSync(file), false);
  mkdirSync(join(d, 'mcpServers'), { recursive: true });
  writeFileSync(file, 'name: someone-else\n');
  await assert.rejects(installDropin(file, content, { backupDir: null }), /不是 AI Cut 写的/);
  await assert.rejects(uninstallDropin(file, { backupDir: null }), /不是 AI Cut 写的/);
});
