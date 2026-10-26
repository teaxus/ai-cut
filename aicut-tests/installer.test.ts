import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAgents, listAgentStatuses } from '../server/external-agent/aicut/installer.ts';
import { loadRegistry } from '../server/external-agent/aicut/agent-registry.ts';

// 用一份自造的注册表 + 临时 HOME，覆盖所有方言，不碰本机真实的 agent 配置。
const REGISTRY = loadRegistry({
  schemaVersion: 1, verifiedAt: '2026-10-25',
  agents: [
    { id: 'json-agent', name: 'Json Agent', detect: { paths: ['~/.json-agent'], commands: [] },
      skills: { global: '~/.json-agent/skills', supported: true },
      mcp: { kind: 'json', file: '~/.json-agent/mcp.json', container: ['mcpServers'], entry: { type: 'http', url: '{url}', headers: { Authorization: 'Bearer {token}' } }, verified: true } },
    { id: 'codex-like', name: 'Codex Like', detect: { paths: ['~/.codex-like'], commands: [] },
      skills: { global: '~/.codex-like/skills', supported: true },
      mcp: { kind: 'toml-codex', file: '~/.codex-like/config.toml', entry: { url: '{url}', http_headers: { Authorization: 'Bearer {token}' } }, verified: true } },
    { id: 'manual-agent', name: 'Manual Agent', detect: { paths: ['~/.manual'], commands: [] },
      skills: { global: '~/.manual/skills', supported: true },
      mcp: { kind: 'jsonc', file: '~/.manual/settings.json', container: ['context_servers'], entry: { url: '{url}' }, verified: true } },
    { id: 'unverified', name: 'Unverified', detect: { paths: ['~/.unverified'], commands: [] },
      skills: { supported: false },
      mcp: { kind: 'json', file: '~/.unverified/mcp.json', container: ['mcpServers'], entry: { url: '{url}' }, verified: false } },
    { id: 'absent-agent', name: 'Absent', detect: { paths: ['~/.absent'], commands: ['definitely-not-a-command-xyz'] },
      skills: { global: '~/.absent/skills', supported: true }, mcp: { kind: 'none', verified: false } },
  ],
});

function setup() {
  assert.deepEqual(REGISTRY.problems, []);
  const home = mkdtempSync(join(tmpdir(), 'aicut-home-'));
  for (const d of ['.json-agent', '.codex-like', '.manual', '.unverified']) mkdirSync(join(home, d));
  writeFileSync(join(home, '.json-agent', 'mcp.json'), JSON.stringify({ mcpServers: { keep: { url: 'x' } } }));
  const skill = join(home, 'skill-src'); mkdirSync(skill); writeFileSync(join(skill, 'SKILL.md'), '---\nname: ai-cut\n---\n');
  return {
    home,
    opts: { endpoint: 'http://127.0.0.1:5299/api/external-mcp/mcp', token: 'tok_1', home, platform: 'darwin' as const,
      env: { PATH: '' }, extraSearchDirs: [], skillSource: skill, dataRoot: join(home, '.ai-cut'), registry: REGISTRY.registry },
  };
}

test('检测与状态：检测到 4 个；手动 / 未核实 / 不支持各自给出原因', async () => {
  const { opts } = setup();
  const list = await listAgentStatuses(opts);
  const by = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.deepEqual(list.filter((a) => a.detected).map((a) => a.id), ['json-agent', 'codex-like', 'manual-agent', 'unverified']);
  assert.equal(by['json-agent'].detectedBy, '~/.json-agent');
  assert.equal(by['json-agent'].mcp.state, 'absent');
  assert.equal(by['json-agent'].mcp.path, '~/.json-agent/mcp.json');
  assert.equal(by['json-agent'].skill.path, '~/.json-agent/skills/ai-cut');
  assert.equal(by['manual-agent'].mcp.mode, 'manual');
  assert.match(by['manual-agent'].mcp.detail ?? '', /带注释/);
  assert.deepEqual(JSON.parse(by['manual-agent'].mcp.snippet ?? '{}'), { context_servers: { 'ai-cut': { url: opts.endpoint } } });
  assert.equal(by.unverified.mcp.mode, 'manual');
  assert.match(by.unverified.mcp.detail ?? '', /还没核实/);
  assert.equal(by['absent-agent'].detected, false);
  assert.equal(by['absent-agent'].mcp.mode, 'unsupported');
});

test('批量安装 → 全部已安装；记录与备份落在 AI Cut 数据目录；再装一次没有改动', async () => {
  const { home, opts } = setup();
  const results = await applyAgents(opts, 'install', ['json-agent', 'codex-like', 'manual-agent']);
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(failed.map((r) => `${r.id}:${r.part}`), ['manual-agent:mcp'], '只能手动的 MCP 报失败并说明');
  const cfg = JSON.parse(readFileSync(join(home, '.json-agent', 'mcp.json'), 'utf8'));
  assert.deepEqual(cfg.mcpServers.keep, { url: 'x' });
  assert.equal(cfg.mcpServers['ai-cut'].headers.Authorization, 'Bearer tok_1');
  assert.match(readFileSync(join(home, '.codex-like', 'config.toml'), 'utf8'), /\[mcp_servers\.ai-cut\]\nurl = "http:\/\/127\.0\.0\.1:5299/);
  assert.ok(existsSync(join(home, '.manual', 'skills', 'ai-cut', 'SKILL.md')), '手动 MCP 的 agent 仍然装上技能');
  const record = JSON.parse(readFileSync(join(home, '.ai-cut', 'agent-installs.json'), 'utf8'));
  assert.ok(record.agents['json-agent'].mcp.installedAt);
  assert.equal(readdirSync(join(home, '.ai-cut', 'agent-backups')).length, 1, '改动前的原文件有备份');
  const list = await listAgentStatuses(opts);
  const j = list.find((a) => a.id === 'json-agent')!;
  assert.equal(j.mcp.state, 'installed'); assert.equal(j.skill.state, 'installed');
  const again = await applyAgents(opts, 'install', ['json-agent']);
  assert.ok(again.every((r) => r.ok && !r.changed));
});

test('令牌或端口变了 → 需更新；更新后恢复', async () => {
  const { opts } = setup();
  await applyAgents(opts, 'install', ['json-agent', 'codex-like']);
  const moved = { ...opts, endpoint: 'http://127.0.0.1:61000/api/external-mcp/mcp' };
  const list = await listAgentStatuses(moved);
  for (const id of ['json-agent', 'codex-like']) assert.equal(list.find((a) => a.id === id)!.mcp.state, 'outdated', id);
  await applyAgents(moved, 'install', ['json-agent', 'codex-like'], ['mcp']);
  const after = await listAgentStatuses(moved);
  for (const id of ['json-agent', 'codex-like']) assert.equal(after.find((a) => a.id === id)!.mcp.state, 'installed', id);
});

test('卸载：只删 ai-cut 项和 AI Cut 装的技能，其他配置原样保留', async () => {
  const { home, opts } = setup();
  await applyAgents(opts, 'install', ['json-agent', 'codex-like']);
  const results = await applyAgents(opts, 'uninstall', ['json-agent', 'codex-like']);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.json-agent', 'mcp.json'), 'utf8')), { mcpServers: { keep: { url: 'x' } } });
  assert.equal(readFileSync(join(home, '.codex-like', 'config.toml'), 'utf8'), '');
  assert.equal(existsSync(join(home, '.json-agent', 'skills', 'ai-cut')), false);
  const list = await listAgentStatuses(opts);
  assert.equal(list.find((a) => a.id === 'json-agent')!.mcp.state, 'absent');
});

test('不认识的 id 与没有技能源时给出明确错误', async () => {
  const { opts } = setup();
  const r1 = await applyAgents(opts, 'install', ['nope'], ['mcp']);
  assert.equal(r1[0].ok, false); assert.match(r1[0].error ?? '', /没有这个 agent/);
  const r2 = await applyAgents({ ...opts, skillSource: null }, 'install', ['json-agent'], ['skill']);
  assert.equal(r2[0].ok, false); assert.match(r2[0].error ?? '', /技能文件/);
});

test('有 cli 的 agent 优先走命令行；命令失败退回写文件；写完回读确认', async () => {
  const { home, opts } = setup();
  const binDir = join(home, 'bin'); mkdirSync(binDir);
  writeFileSync(join(binDir, 'fakeclaude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const reg = loadRegistry({ schemaVersion: 1, verifiedAt: 'x', agents: [
    { id: 'cli-agent', name: 'Cli', detect: { paths: ['~/.json-agent'], commands: [] }, skills: { supported: false },
      mcp: { kind: 'json', file: '~/.json-agent/mcp.json', container: ['mcpServers'], entry: { type: 'http', url: '{url}' }, verified: true,
        cli: { command: 'fakeclaude', install: ['mcp', 'add-json', '{name}', '{json}'], uninstall: ['mcp', 'remove', '{name}'] } } },
  ] }).registry;
  const calls: string[][] = [];
  const cliWrites = async (_bin: string, args: readonly string[]) => {
    calls.push([...args]);
    // 模拟命令真的写了文件
    const file = join(home, '.json-agent', 'mcp.json'); const cfg = JSON.parse(readFileSync(file, 'utf8'));
    if (args[1] === 'add-json') cfg.mcpServers[args[2]] = JSON.parse(args[3]); else delete cfg.mcpServers[args[2]];
    writeFileSync(file, JSON.stringify(cfg));
    return { code: 0, stderr: '' };
  };
  const o = { ...opts, registry: reg, env: { PATH: binDir }, runCommand: cliWrites };
  const status = (await listAgentStatuses(o))[0];
  assert.equal(status.mcp.via, 'fakeclaude mcp add-json');
  const r = await applyAgents(o, 'install', ['cli-agent'], ['mcp']);
  assert.ok(r[0].ok && r[0].changed);
  assert.deepEqual(calls[0].slice(0, 3), ['mcp', 'add-json', 'ai-cut']);
  assert.equal(JSON.parse(calls[0][3]).url, opts.endpoint);
  assert.equal(readdirSync(join(home, '.ai-cut')).includes('agent-backups'), false, '走命令行时不需要 App 自己备份');
  await applyAgents(o, 'uninstall', ['cli-agent'], ['mcp']);
  assert.deepEqual(calls[1], ['mcp', 'remove', 'ai-cut']);
  // 命令失败：退回直接写文件
  const failing = { ...o, runCommand: async () => ({ code: 1, stderr: 'boom' }) };
  const r2 = await applyAgents(failing, 'install', ['cli-agent'], ['mcp']);
  assert.ok(r2[0].ok && r2[0].changed);
  assert.equal(JSON.parse(readFileSync(join(home, '.json-agent', 'mcp.json'), 'utf8')).mcpServers['ai-cut'].url, opts.endpoint);
});

test('附加文件（extraFiles）只在已存在时同步写', async () => {
  const { home, opts } = setup();
  mkdirSync(join(home, '.old-loc'));
  writeFileSync(join(home, '.old-loc', 'mcp.json'), '{}');
  const reg = loadRegistry({ schemaVersion: 1, verifiedAt: 'x', agents: [
    { id: 'multi', name: 'Multi', detect: { paths: ['~/.json-agent'], commands: [] }, skills: { supported: true, global: '~/.json-agent/skills', extra: ['~/.old-loc/skills', '~/.missing/skills'] },
      mcp: { kind: 'json', file: '~/.json-agent/mcp.json', container: ['mcpServers'], entry: { url: '{url}' }, verified: true,
        extraFiles: ['~/.old-loc/mcp.json', '~/.missing/mcp.json'] } },
  ] }).registry;
  const o = { ...opts, registry: reg };
  const s = (await listAgentStatuses(o))[0];
  assert.deepEqual(s.mcp.extraPaths, ['~/.old-loc/mcp.json']);
  assert.deepEqual(s.skill.extraPaths, ['~/.old-loc/skills/ai-cut']);
  await applyAgents(o, 'install', ['multi']);
  assert.equal(JSON.parse(readFileSync(join(home, '.old-loc', 'mcp.json'), 'utf8')).mcpServers['ai-cut'].url, opts.endpoint);
  assert.ok(existsSync(join(home, '.old-loc', 'skills', 'ai-cut', 'SKILL.md')));
  assert.equal(existsSync(join(home, '.missing')), false, '不存在的位置不创建');
  const after = (await listAgentStatuses(o))[0];
  assert.equal(after.mcp.state, 'installed'); assert.equal(after.skill.state, 'installed');
});

test('真实注册表本身合法（shared/aicut/agents.json）', () => {
  const real = loadRegistry();
  assert.deepEqual(real.problems, []);
  assert.ok(real.registry.agents.length >= 10);
  for (const id of ['claude-code', 'codex', 'cursor', 'gemini-cli']) assert.ok(real.registry.agents.some((a) => a.id === id), id);
});
