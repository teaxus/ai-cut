// ai-cut：AI 编码 agent 注册表的类型、校验与路径解析。
// 数据在 shared/aicut/agents.json（每条的官方来源记在 docs/research/agent-registry.md）。
import { homedir } from 'node:os';
import path from 'node:path';
import rawRegistry from '../../../shared/aicut/agents.json' with { type: 'json' };

export type Platform = 'darwin' | 'win32' | 'linux';
export type PlatformPath = string | Partial<Record<Platform, string>>;
import type { McpKind } from '../../../shared/aicut/agent-api.ts';

export type { McpKind };

export interface AgentMcpDef {
  readonly kind: McpKind;
  readonly file?: PlatformPath;
  /** yaml-dropin：放独立文件的目录与文件名 */
  readonly dir?: PlatformPath;
  readonly fileName?: string;
  readonly container?: readonly string[];
  readonly entry?: Readonly<Record<string, unknown>>;
  /** yaml-dropin / copy 的文本模板（含 {url} {token} {name}） */
  readonly template?: string;
  readonly verified: boolean;
  readonly source?: string;
  readonly note?: string;
  /** 同一份条目还要同步写的文件（例如旧版路径）；只在文件已存在时写 */
  readonly extraFiles?: readonly PlatformPath[];
  /** 优先用 agent 自己的命令行写入（参数里可用 {name} {json}）；命令不在 PATH 或失败时退回直接写文件 */
  readonly cli?: { readonly command: string; readonly install: readonly string[]; readonly uninstall: readonly string[] };
}

export interface AgentDef {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  /** paths：配置目录 / 应用 / 二进制路径，任一存在即算已装；commands：PATH 上的命令名 */
  readonly detect: { readonly paths: readonly PlatformPath[]; readonly commands: readonly string[] };
  /** extra：附加的全局技能目录，只在其父目录存在时写（agent 的新旧两个位置都读时用） */
  readonly skills: { readonly global?: PlatformPath; readonly supported: boolean; readonly source?: string; readonly extra?: readonly PlatformPath[] };
  readonly mcp: AgentMcpDef;
}

export interface AgentRegistry {
  readonly schemaVersion: number;
  readonly verifiedAt: string;
  readonly agents: readonly AgentDef[];
}

const MCP_KINDS: readonly McpKind[] = ['json', 'jsonc', 'toml-codex', 'yaml-dropin', 'copy', 'none'];
const ID = /^[a-z0-9][a-z0-9-]*$/;

function isPlatformPath(value: unknown): value is PlatformPath {
  if (typeof value === 'string') return value.length > 0;
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value as Record<string, unknown>).every(([k, v]) => ['darwin', 'win32', 'linux'].includes(k) && typeof v === 'string');
}

/** 校验并规整一条 agent；不合格的返回问题描述（注册表测试会把它们全部列出来）。 */
export function validateAgent(raw: unknown): { agent: AgentDef | null; problems: string[] } {
  const problems: string[] = [];
  const a = raw as Record<string, any>;
  const id = typeof a?.id === 'string' ? a.id : '(无 id)';
  const fail = (msg: string) => problems.push(`${id}: ${msg}`);
  if (!ID.test(id)) fail('id 只能是小写字母、数字、连字符');
  if (typeof a?.name !== 'string' || !a.name) fail('缺 name');
  // 注册表里的 detect.binaries / detect.apps 与 paths 同义（都是"这个路径存在就算装了"）
  const detectPaths = ['paths', 'binaries', 'apps'].flatMap((k) => (Array.isArray(a?.detect?.[k]) ? a.detect[k] : []));
  const detectCommands = Array.isArray(a?.detect?.commands) ? a.detect.commands : [];
  if (!detectPaths.every(isPlatformPath)) fail('detect.paths 格式不对');
  if (!detectCommands.every((c: unknown) => typeof c === 'string' && /^[\w.-]+$/.test(c))) fail('detect.commands 格式不对');
  const skills = a?.skills ?? {};
  if (typeof skills.supported !== 'boolean') fail('skills.supported 必须是布尔值');
  if (skills.supported && !isPlatformPath(skills.global)) fail('支持技能但没有 skills.global');
  const mcp = a?.mcp ?? {};
  if (!MCP_KINDS.includes(mcp.kind)) fail(`mcp.kind 不认识：${mcp.kind}`);
  if ((mcp.kind === 'json' || mcp.kind === 'jsonc' || mcp.kind === 'toml-codex') && !isPlatformPath(mcp.file)) fail(`${mcp.kind} 需要 mcp.file`);
  if ((mcp.kind === 'json' || mcp.kind === 'jsonc') && !(Array.isArray(mcp.container) && mcp.container.length > 0 && mcp.container.every((k: unknown) => typeof k === 'string' && k))) fail('json 需要非空的 mcp.container');
  if (mcp.kind === 'json' && (!mcp.entry || typeof mcp.entry !== 'object')) fail('json 需要 mcp.entry');
  if (mcp.kind === 'toml-codex' && (!mcp.entry || typeof mcp.entry !== 'object')) fail('toml-codex 需要 mcp.entry');
  if (mcp.kind === 'yaml-dropin' && ((!isPlatformPath(mcp.dir) && !isPlatformPath(mcp.file)) || typeof mcp.template !== 'string')) fail('yaml-dropin 需要 mcp.file（或 dir）和 mcp.template');
  if (mcp.extraFiles !== undefined && !(Array.isArray(mcp.extraFiles) && mcp.extraFiles.every(isPlatformPath))) fail('mcp.extraFiles 格式不对');
  if (mcp.cli !== undefined && !(typeof mcp.cli?.command === 'string' && Array.isArray(mcp.cli?.install) && Array.isArray(mcp.cli?.uninstall))) fail('mcp.cli 需要 command / install / uninstall');
  if (skills.extra !== undefined && !(Array.isArray(skills.extra) && skills.extra.every(isPlatformPath))) fail('skills.extra 格式不对');
  if (typeof mcp.verified !== 'boolean') fail('mcp.verified 必须是布尔值');
  if (problems.length) return { agent: null, problems };
  return {
    agent: {
      id, name: a.name, group: a.group,
      detect: { paths: detectPaths, commands: detectCommands },
      skills: { global: skills.global ?? undefined, supported: skills.supported, source: skills.source, extra: skills.extra },
      mcp: {
        kind: mcp.kind, file: mcp.file, dir: mcp.dir, fileName: mcp.fileName, container: mcp.container,
        entry: mcp.entry, template: mcp.template, verified: mcp.verified, source: mcp.source, note: mcp.note,
        extraFiles: mcp.extraFiles, cli: mcp.cli,
      },
    },
    problems,
  };
}

export function loadRegistry(raw: unknown = rawRegistry): { registry: AgentRegistry; problems: string[] } {
  const r = raw as Record<string, any>;
  const problems: string[] = [];
  const agents: AgentDef[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r?.agents) ? r.agents : []) {
    const { agent, problems: p } = validateAgent(item);
    problems.push(...p);
    if (!agent) continue;
    if (seen.has(agent.id)) { problems.push(`${agent.id}: id 重复`); continue; }
    seen.add(agent.id);
    agents.push(agent);
  }
  return { registry: { schemaVersion: Number(r?.schemaVersion) || 0, verifiedAt: String(r?.verifiedAt ?? ''), agents }, problems };
}

export interface PathContext {
  readonly home: string;
  readonly platform: Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function currentPathContext(): PathContext {
  const platform = (['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'linux') as Platform;
  return { home: homedir(), platform, env: process.env };
}

/** 把注册表里的路径解析成绝对路径；该平台没有定义时返回 null。 */
export function resolveAgentPath(value: PlatformPath | undefined, ctx: PathContext): string | null {
  if (!value) return null;
  const raw = typeof value === 'string' ? value : value[ctx.platform];
  if (!raw) return null;
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const appData = ctx.env.APPDATA || p.join(ctx.home, 'AppData', 'Roaming');
  let out = raw.replace(/\{APPDATA\}/g, appData);
  if (out === '~') out = ctx.home;
  else if (/^~[\\/]/.test(out)) out = p.join(ctx.home, out.slice(2));
  return p.normalize(out);
}

/** 给人看的路径：家目录下的写成 ~/…（统一用 /）。 */
export function displayAgentPath(abs: string, ctx: PathContext): string {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(ctx.home, abs);
  if (!rel || rel.startsWith('..') || p.isAbsolute(rel)) return abs;
  return `~/${rel.split(p.sep).join('/')}`;
}
