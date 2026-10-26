// ai-cut：「Agent 接入」的核心——探测本机 agent、报告 MCP 与技能的安装状态、批量安装 / 卸载。
// HTTP 路由（server/plugins/aicut/agent-installer.ts）与命令行（tools/aicut-agents.sh）都调这里。
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { openChatCutHomeRoot } from '../../../shared/aicut/home.ts';
import {
  displayAgentPath, loadRegistry, resolveAgentPath,
  type AgentDef, type AgentRegistry, type McpKind, type PathContext, type Platform,
} from './agent-registry.ts';
import {
  SERVER_NAME, fillTemplate, inspectCodexToml, inspectDropin, inspectJson, installCodexToml, installDropin,
  installJson, renderDropin, uninstallCodexToml, uninstallDropin, uninstallJson, type McpState, type WriteContext,
} from './mcp-writers.ts';
import { SKILL_NAME, inspectSkill, installSkill, skillSourceDir, uninstallSkill, type SkillState } from './skill-installer.ts';

import type { Action, AgentStatus, ApplyResult, McpStatus, Part, SkillStatus } from '../../../shared/aicut/agent-api.ts';

export type { Action, AgentStatus, ApplyResult, McpStatus, Part, SkillStatus };

export interface InstallerOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly home?: string;
  readonly platform?: Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** 技能源目录；undefined = 自动找，null = 没有技能可装 */
  readonly skillSource?: string | null;
  /** 安装记录与备份放哪；默认 AI Cut 的数据根目录 */
  readonly dataRoot?: string;
  readonly registry?: AgentRegistry;
  readonly now?: () => Date;
  /** 测试用：替代真正执行 agent 命令行 */
  readonly runCommand?: (bin: string, args: readonly string[]) => Promise<{ code: number | null; stderr: string }>;
  /** 测试用：替代 PATH 之外额外搜索的命令目录 */
  readonly extraSearchDirs?: readonly string[];
}

interface Ctx extends PathContext {
  readonly opts: InstallerOptions;
  readonly registry: AgentRegistry;
  readonly skillSource: string | null;
  readonly dataRoot: string;
  readonly vars: Readonly<Record<string, string>>;
}

function context(opts: InstallerOptions): Ctx {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? ((['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'linux') as Platform);
  const env = opts.env ?? process.env;
  return {
    home, platform, env, opts,
    registry: opts.registry ?? loadRegistry().registry,
    skillSource: opts.skillSource === undefined ? skillSourceDir(env) : opts.skillSource,
    dataRoot: opts.dataRoot ?? openChatCutHomeRoot(home, env),
    vars: { url: opts.endpoint, token: opts.token, name: SERVER_NAME },
  };
}

/** 打包后的 App 从 Finder 启动时 PATH 很短，补上 agent 命令行常见的安装位置。 */
function searchDirs(ctx: Ctx): string[] {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const fromEnv = (ctx.env.PATH ?? ctx.env.Path ?? '').split(ctx.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extra = ctx.platform === 'win32'
    ? [p.join(ctx.env.APPDATA ?? p.join(ctx.home, 'AppData', 'Roaming'), 'npm')]
    : [p.join(ctx.home, '.local', 'bin'), p.join(ctx.home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  return [...new Set([...fromEnv, ...(ctx.opts.extraSearchDirs ?? extra)])];
}

function commandOnPath(command: string, ctx: Ctx): string | null {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const exts = ctx.platform === 'win32' ? (ctx.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of searchDirs(ctx)) {
    for (const ext of exts) {
      const candidate = p.join(dir, command + ext);
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* 不在这个目录 */ }
    }
  }
  return null;
}

function detect(agent: AgentDef, ctx: Ctx): { detected: boolean; by?: string } {
  for (const raw of agent.detect.paths) {
    const abs = resolveAgentPath(raw, ctx);
    if (abs && existsSync(abs)) return { detected: true, by: displayAgentPath(abs, ctx) };
  }
  for (const command of agent.detect.commands) {
    const found = commandOnPath(command, ctx);
    if (found) return { detected: true, by: `${command}（${displayAgentPath(found, ctx)}）` };
  }
  return { detected: false };
}

/** 把服务条目按 container 路径包起来，给只能手动粘贴的 agent 用。 */
function snippetFor(agent: AgentDef, ctx: Ctx): string {
  const { mcp } = agent;
  if (mcp.template) return fillTemplate(mcp.template, ctx.vars);
  const entry = fillTemplate(mcp.entry ?? { type: 'http', url: '{url}', headers: { Authorization: 'Bearer {token}' } }, ctx.vars);
  let wrapped: Record<string, unknown> = { [SERVER_NAME]: entry };
  for (const key of [...(mcp.container ?? ['mcpServers'])].reverse()) wrapped = { [key]: wrapped };
  return JSON.stringify(wrapped, null, 2);
}

/** 要写的文件：主文件 + 已存在的附加文件（extraFiles）。 */
function mcpTargets(agent: AgentDef, ctx: Ctx): string[] {
  const { mcp } = agent;
  let main: string | null;
  if (mcp.kind === 'yaml-dropin' && !mcp.file) {
    const dir = resolveAgentPath(mcp.dir, ctx);
    main = dir ? path.join(dir, mcp.fileName ?? `${SERVER_NAME}.yaml`) : null;
  } else {
    main = resolveAgentPath(mcp.file, ctx);
  }
  if (!main) return [];
  const extras = (mcp.extraFiles ?? []).map((f) => resolveAgentPath(f, ctx)).filter((f): f is string => Boolean(f) && f !== main && existsSync(f!));
  return [main, ...extras];
}

const AUTO_KINDS: readonly McpKind[] = ['json', 'toml-codex', 'yaml-dropin'];
const STATE_RANK: Record<McpState, number> = { unreadable: 3, outdated: 2, absent: 1, installed: 0 };

function inspectOne(agent: AgentDef, target: string, ctx: Ctx) {
  const { mcp } = agent;
  if (mcp.kind === 'json') return inspectJson(target, mcp.container ?? [], fillTemplate(mcp.entry, ctx.vars));
  if (mcp.kind === 'toml-codex') return inspectCodexToml(target, fillTemplate(mcp.entry ?? {}, ctx.vars));
  return inspectDropin(target, renderDropin(mcp.template ?? '', ctx.vars));
}

/** 多个目标文件合成一个状态：读不懂 > 需更新 > 未安装 > 已安装。 */
async function inspectAll(agent: AgentDef, targets: readonly string[], ctx: Ctx): Promise<{ state: McpState; detail?: string }> {
  let worst: { state: McpState; detail?: string } = { state: 'installed' };
  for (const target of targets) {
    const r = await inspectOne(agent, target, ctx);
    if (STATE_RANK[r.state] > STATE_RANK[worst.state]) {
      worst = { state: r.state, detail: r.detail && targets.length > 1 ? `${displayAgentPath(target, ctx)}：${r.detail}` : r.detail };
    }
  }
  return worst;
}

function cliFor(agent: AgentDef, ctx: Ctx): { bin: string; cli: NonNullable<AgentDef['mcp']['cli']> } | null {
  const cli = agent.mcp.cli;
  if (!cli) return null;
  const bin = commandOnPath(cli.command, ctx);
  return bin ? { bin, cli } : null;
}

async function mcpStatus(agent: AgentDef, ctx: Ctx): Promise<McpStatus> {
  const { mcp } = agent;
  const base = { kind: mcp.kind, verified: mcp.verified, source: mcp.source, note: mcp.note };
  if (mcp.kind === 'none') return { ...base, mode: 'unsupported', state: 'unsupported' };
  const targets = mcpTargets(agent, ctx);
  const shown = targets[0] ? displayAgentPath(targets[0], ctx) : undefined;
  const extraPaths = targets.slice(1).map((t) => displayAgentPath(t, ctx));
  if (!AUTO_KINDS.includes(mcp.kind) || !mcp.verified || targets.length === 0) {
    const detail = !mcp.verified ? '配置格式还没核实，请按说明手动添加'
      : mcp.kind === 'jsonc' ? '配置文件带注释，App 不改它，请手动添加' : undefined;
    return { ...base, mode: 'manual', state: 'manual', path: shown, detail, snippet: snippetFor(agent, ctx) };
  }
  const inspected = await inspectAll(agent, targets, ctx);
  const cli = cliFor(agent, ctx);
  return {
    ...base, mode: 'auto', state: inspected.state, detail: inspected.detail, path: shown,
    ...(extraPaths.length ? { extraPaths } : {}),
    ...(cli ? { via: `${cli.cli.command} ${cli.cli.install.slice(0, 2).join(' ')}` } : {}),
  };
}

function skillRoots(agent: AgentDef, ctx: Ctx): string[] {
  const main = resolveAgentPath(agent.skills.global, ctx);
  if (!main) return [];
  const extras = (agent.skills.extra ?? []).map((r) => resolveAgentPath(r, ctx))
    .filter((r): r is string => Boolean(r) && r !== main && existsSync(path.dirname(r!)));
  return [main, ...extras];
}

const SKILL_RANK: Record<SkillState, number> = { foreign: 3, outdated: 2, absent: 1, installed: 0 };

async function skillStatus(agent: AgentDef, ctx: Ctx): Promise<SkillStatus> {
  if (!agent.skills.supported) return { mode: 'unsupported', state: 'unsupported' };
  const roots = skillRoots(agent, ctx);
  if (roots.length === 0) return { mode: 'unsupported', state: 'unsupported' };
  const shown = displayAgentPath(path.join(roots[0], SKILL_NAME), ctx);
  const extraPaths = roots.slice(1).map((r) => displayAgentPath(path.join(r, SKILL_NAME), ctx));
  const extra = extraPaths.length ? { extraPaths } : {};
  if (!ctx.skillSource) return { mode: 'auto', state: 'no-source', path: shown, ...extra };
  let worst: SkillState = 'installed';
  for (const root of roots) {
    const state = await inspectSkill(root, ctx.skillSource);
    if (SKILL_RANK[state] > SKILL_RANK[worst]) worst = state;
  }
  return { mode: 'auto', state: worst, path: shown, ...extra };
}

export async function listAgentStatuses(opts: InstallerOptions): Promise<AgentStatus[]> {
  const ctx = context(opts);
  const out: AgentStatus[] = [];
  for (const agent of ctx.registry.agents) {
    const found = detect(agent, ctx);
    out.push({ id: agent.id, name: agent.name, detected: found.detected, detectedBy: found.by, mcp: await mcpStatus(agent, ctx), skill: await skillStatus(agent, ctx) });
  }
  return out;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

async function recordInstall(ctx: Ctx, results: readonly ApplyResult[], action: Action, at: Date): Promise<void> {
  const file = path.join(ctx.dataRoot, 'agent-installs.json');
  let state: { agents: Record<string, Record<string, unknown>> } = { agents: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch { /* 第一次 */ }
  for (const r of results) {
    if (!r.ok || !r.changed) continue;
    const entry = (state.agents[r.id] ??= {});
    entry[r.part] = action === 'install' ? { path: r.path, installedAt: at.toISOString() } : null;
  }
  await mkdir(ctx.dataRoot, { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}

function runCli(bin: string, args: readonly string[], ctx: Ctx): Promise<{ code: number | null; stderr: string }> {
  if (ctx.opts.runCommand) return ctx.opts.runCommand(bin, args);
  return new Promise((resolve) => {
    execFile(bin, [...args], { timeout: 20_000, windowsHide: true, env: { ...process.env, ...ctx.env } }, (error, _stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stderr: String(stderr ?? '').slice(-400) });
    });
  });
}

/** 用 agent 自己的命令行装 / 卸（claude mcp add-json 之类）；返回 null 表示没走命令行（命令不在或失败），调用方退回写文件。 */
async function applyViaCli(agent: AgentDef, action: Action, state: McpState, ctx: Ctx): Promise<boolean | null> {
  const found = cliFor(agent, ctx);
  if (!found || agent.mcp.kind !== 'json') return null;
  const fill = (args: readonly string[]) => args.map((a) => a
    .replace('{name}', SERVER_NAME)
    .replace('{json}', JSON.stringify(fillTemplate(agent.mcp.entry, ctx.vars))));
  if (action === 'uninstall' || state === 'outdated') {
    const r = await runCli(found.bin, fill(found.cli.uninstall), ctx);
    if (r.code !== 0 && action === 'uninstall') return null;
  }
  if (action === 'install') {
    const r = await runCli(found.bin, fill(found.cli.install), ctx);
    if (r.code !== 0) return null;
  }
  // 命令说成功了也要回读文件确认（例如设置了 CLAUDE_CONFIG_DIR 时它会写到别处）
  const after = await inspectAll(agent, mcpTargets(agent, ctx).slice(0, 1), ctx);
  return action === 'install' ? after.state === 'installed' : after.state === 'absent';
}

async function applyMcp(agent: AgentDef, action: Action, ctx: Ctx, write: WriteContext): Promise<ApplyResult> {
  const status = await mcpStatus(agent, ctx);
  const targets = mcpTargets(agent, ctx);
  const shown = status.path;
  if (status.mode !== 'auto' || targets.length === 0) {
    return { id: agent.id, part: 'mcp', ok: false, changed: false, path: shown, error: status.mode === 'manual' ? '这个 agent 需要手动添加配置' : '这个 agent 不支持远程 MCP' };
  }
  const { mcp } = agent;
  try {
    if (action === 'install') {
      if (status.state === 'installed') return { id: agent.id, part: 'mcp', ok: true, changed: false, path: shown };
      if (status.state === 'unreadable') throw new Error(status.detail ?? '配置文件读不懂');
      const viaCli = await applyViaCli(agent, action, status.state as McpState, ctx);
      for (const target of viaCli ? targets.slice(1) : targets) {
        if (mcp.kind === 'json') await installJson(target, mcp.container ?? [], fillTemplate(mcp.entry, ctx.vars), write);
        else if (mcp.kind === 'toml-codex') await installCodexToml(target, fillTemplate(mcp.entry ?? {}, ctx.vars), write);
        else await installDropin(target, renderDropin(mcp.template ?? '', ctx.vars), write);
      }
      return { id: agent.id, part: 'mcp', ok: true, changed: true, path: shown };
    }
    let changed = false;
    const viaCli = status.state === 'absent' ? false : await applyViaCli(agent, action, status.state as McpState, ctx);
    if (viaCli) changed = true;
    for (const target of viaCli ? targets.slice(1) : targets) {
      const removed = mcp.kind === 'json' ? await uninstallJson(target, mcp.container ?? [], write)
        : mcp.kind === 'toml-codex' ? await uninstallCodexToml(target, write)
          : await uninstallDropin(target, write);
      changed = changed || removed;
    }
    return { id: agent.id, part: 'mcp', ok: true, changed, path: shown };
  } catch (error) {
    return { id: agent.id, part: 'mcp', ok: false, changed: false, path: shown, error: error instanceof Error ? error.message : String(error) };
  }
}

async function applySkill(agent: AgentDef, action: Action, ctx: Ctx): Promise<ApplyResult> {
  const status = await skillStatus(agent, ctx);
  const roots = skillRoots(agent, ctx);
  if (status.mode !== 'auto' || roots.length === 0) return { id: agent.id, part: 'skill', ok: false, changed: false, error: '这个 agent 不支持 Agent Skills' };
  try {
    if (action === 'install') {
      if (!ctx.skillSource) throw new Error('找不到 AI Cut 自带的技能文件（skills/ai-cut）');
      if (status.state === 'installed') return { id: agent.id, part: 'skill', ok: true, changed: false, path: status.path };
      for (const root of roots) {
        if (await inspectSkill(root, ctx.skillSource) !== 'installed') await installSkill(root, ctx.skillSource, ctx.opts.now?.() ?? new Date());
      }
      return { id: agent.id, part: 'skill', ok: true, changed: true, path: status.path };
    }
    let changed = false;
    for (const root of roots) changed = (await uninstallSkill(root)) || changed;
    return { id: agent.id, part: 'skill', ok: true, changed, path: status.path };
  } catch (error) {
    return { id: agent.id, part: 'skill', ok: false, changed: false, path: status.path, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 对指定的 agent 执行安装 / 卸载。逐个执行，一个失败不影响其他；结果逐条返回。 */
export async function applyAgents(opts: InstallerOptions, action: Action, ids: readonly string[], parts: readonly Part[] = ['mcp', 'skill']): Promise<ApplyResult[]> {
  const ctx = context(opts);
  const at = ctx.opts.now?.() ?? new Date();
  const write: WriteContext = { backupDir: path.join(ctx.dataRoot, 'agent-backups', stamp(at)) };
  const results: ApplyResult[] = [];
  for (const id of ids) {
    const agent = ctx.registry.agents.find((a) => a.id === id);
    if (!agent) {
      for (const part of parts) results.push({ id, part, ok: false, changed: false, error: '注册表里没有这个 agent' });
      continue;
    }
    for (const part of parts) {
      const status = part === 'mcp' ? await mcpStatus(agent, ctx) : await skillStatus(agent, ctx);
      if (status.mode === 'unsupported' && parts.length > 1) continue; // 批量时跳过这个 agent 本来就没有的部分
      results.push(part === 'mcp' ? await applyMcp(agent, action, ctx, write) : await applySkill(agent, action, ctx));
    }
  }
  await recordInstall(ctx, results, action, at);
  return results;
}
