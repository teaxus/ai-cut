// ai-cut：把 AI Cut 的 MCP 服务写进各 agent 的配置文件（只动服务名为 SERVER_NAME 的那一项）。
// 原则沿用上游 client-connect.ts：读不懂的文件绝不覆盖；写入走临时文件 + rename；
// 第一次改某个文件之前先把原文件备份到 <AI Cut 数据目录>/agent-backups/。
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SERVER_NAME = 'ai-cut';
export const MANAGED_MARK = 'managed by AI Cut';

import type { McpState } from '../../../shared/aicut/agent-api.ts';

export type { McpState };
export interface McpInspect { readonly state: McpState; readonly detail?: string }

export interface WriteContext {
  /** 备份目录（本次操作专用）；null = 不备份（测试用） */
  readonly backupDir: string | null;
}

/** 把模板里的 {url} {token} {name} 换成实际值（深拷贝，不改模板对象）。 */
export function fillTemplate<T>(value: T, vars: Readonly<Record<string, string>>): T {
  if (typeof value === 'string') {
    return value.replace(/\{(url|token|name)\}/g, (m, k: string) => vars[k] ?? m) as T;
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)])) as T;
  }
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
      : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

async function readText(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function backup(file: string, ctx: WriteContext): Promise<void> {
  if (!ctx.backupDir) return;
  const target = path.join(ctx.backupDir, `${path.basename(path.dirname(file))}__${path.basename(file)}`);
  await mkdir(ctx.backupDir, { recursive: true });
  await copyFile(file, target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.aicut-tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

// ---------------------------------------------------------------- JSON（mcpServers 一类）

type JsonRoot = Record<string, unknown>;
type JsonRead = { ok: true; root: JsonRoot; existed: boolean } | { ok: false; detail: string };

async function readJsonRoot(file: string): Promise<JsonRead> {
  let text: string | null;
  try { text = await readText(file); } catch (error) { return { ok: false, detail: `读取失败：${(error as Error).message}` }; }
  if (text === null || !text.trim()) return { ok: true, root: {}, existed: text !== null };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, detail: '文件顶层不是 JSON 对象' };
    return { ok: true, root: parsed as JsonRoot, existed: true };
  } catch {
    return { ok: false, detail: '不是有效的 JSON（可能含注释），为避免覆盖不会写入' };
  }
}

/** 沿 container 键路径找到服务对象；create=true 时缺的层级会补上。路径上遇到非对象返回 null。 */
function containerOf(root: JsonRoot, keys: readonly string[], create: boolean): JsonRoot | null {
  let node: JsonRoot = root;
  for (const key of keys) {
    const next = node[key];
    if (next === undefined) {
      if (!create) return null;
      node[key] = {};
      node = node[key] as JsonRoot;
    } else if (next && typeof next === 'object' && !Array.isArray(next)) {
      node = next as JsonRoot;
    } else {
      return null;
    }
  }
  return node;
}

export async function inspectJson(file: string, container: readonly string[], desired: unknown): Promise<McpInspect> {
  const read = await readJsonRoot(file);
  if (!read.ok) return { state: 'unreadable', detail: read.detail };
  const servers = containerOf(read.root, container, false);
  if (servers === null) {
    // 路径上的某一层不是对象（而不是不存在）就无法安全写入
    const blocked = containerOf(structuredClone(read.root), container, true) === null;
    return blocked ? { state: 'unreadable', detail: `${container.join('.')} 不是对象` } : { state: 'absent' };
  }
  const current = servers[SERVER_NAME];
  if (current === undefined) return { state: 'absent' };
  return sameJson(current, desired) ? { state: 'installed' } : { state: 'outdated', detail: '地址或令牌与当前 AI Cut 不一致' };
}

export async function installJson(file: string, container: readonly string[], desired: unknown, ctx: WriteContext): Promise<void> {
  const read = await readJsonRoot(file);
  if (!read.ok) throw new Error(read.detail);
  const servers = containerOf(read.root, container, true);
  if (servers === null) throw new Error(`${container.join('.')} 不是对象，为避免覆盖不会写入`);
  servers[SERVER_NAME] = desired;
  if (read.existed) await backup(file, ctx);
  await writeAtomic(file, `${JSON.stringify(read.root, null, 2)}\n`);
}

export async function uninstallJson(file: string, container: readonly string[], ctx: WriteContext): Promise<boolean> {
  const read = await readJsonRoot(file);
  if (!read.ok) throw new Error(read.detail);
  const servers = containerOf(read.root, container, false);
  if (!servers || !(SERVER_NAME in servers)) return false;
  delete servers[SERVER_NAME];
  await backup(file, ctx);
  await writeAtomic(file, `${JSON.stringify(read.root, null, 2)}\n`);
  return true;
}

// ---------------------------------------------------------------- Codex config.toml

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const tomlKey = (key: string) => (BARE_KEY.test(key) ? key : JSON.stringify(key));

function tomlValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value); // JSON 字符串转义是合法的 TOML basic string
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`).join(', ')} }`;
  }
  throw new Error(`TOML 不支持的值：${String(value)}`);
}

/** 渲染 [mcp_servers.ai-cut] 整块（以注释行开头，便于人和卸载识别）。 */
export function renderCodexBlock(entry: Readonly<Record<string, unknown>>): string {
  const lines = [`# ${SERVER_NAME}: ${MANAGED_MARK}`, `[mcp_servers.${tomlKey(SERVER_NAME)}]`];
  for (const [key, value] of Object.entries(entry)) lines.push(`${tomlKey(key)} = ${tomlValue(value)}`);
  return `${lines.join('\n')}\n`;
}

const OUR_HEADER = new RegExp(String.raw`^\s*\[\s*mcp_servers\s*\.\s*(?:"${SERVER_NAME}"|'${SERVER_NAME}'|${SERVER_NAME})\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$`);
const ANY_HEADER = /^\s*\[/;
const OUR_COMMENT = new RegExp(`^#\\s*${SERVER_NAME}:\\s*${MANAGED_MARK}\\s*$`);

/** 找出我们那一块（含子表和前面的标记注释）在 lines 里的范围 [start, end)。 */
function findCodexBlock(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => OUR_HEADER.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !(ANY_HEADER.test(lines[end]) && !OUR_HEADER.test(lines[end]))) end += 1;
  // 块尾的空行和紧跟着下一个表的注释不算我们的
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1;
  const from = start > 0 && OUR_COMMENT.test(lines[start - 1]) ? start - 1 : start;
  return { start: from, end };
}

export async function inspectCodexToml(file: string, entry: Readonly<Record<string, unknown>>): Promise<McpInspect> {
  let text: string | null;
  try { text = await readText(file); } catch (error) { return { state: 'unreadable', detail: (error as Error).message }; }
  if (text === null) return { state: 'absent' };
  const lines = text.split(/\r?\n/);
  const block = findCodexBlock(lines);
  if (!block) return { state: 'absent' };
  const current = lines.slice(block.start, block.end).join('\n').trim();
  return current === renderCodexBlock(entry).trim() ? { state: 'installed' } : { state: 'outdated', detail: '地址或令牌与当前 AI Cut 不一致' };
}

export async function installCodexToml(file: string, entry: Readonly<Record<string, unknown>>, ctx: WriteContext): Promise<void> {
  const text = (await readText(file)) ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  const block = renderCodexBlock(entry).trimEnd().split('\n');
  const found = findCodexBlock(lines);
  if (found) {
    lines.splice(found.start, found.end - found.start, ...block);
  } else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(...block);
  }
  if (text) await backup(file, ctx);
  await writeAtomic(file, `${lines.join(eol).replace(/\s+$/, '')}${eol}`);
}

export async function uninstallCodexToml(file: string, ctx: WriteContext): Promise<boolean> {
  const text = await readText(file);
  if (text === null) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const found = findCodexBlock(lines);
  if (!found) return false;
  lines.splice(found.start, found.end - found.start);
  // 去掉因删除留下的连续空行
  const compact = lines.join(eol).replace(new RegExp(`(?:${eol}){3,}`, 'g'), `${eol}${eol}`).replace(/\s+$/, '');
  await backup(file, ctx);
  await writeAtomic(file, compact ? `${compact}${eol}` : '');
  return true;
}

// ---------------------------------------------------------------- 独立 YAML 文件（Continue 一类）

export function renderDropin(template: string, vars: Readonly<Record<string, string>>): string {
  return `# ${SERVER_NAME}: ${MANAGED_MARK}\n${fillTemplate(template, vars).replace(/\s+$/, '')}\n`;
}

export async function inspectDropin(file: string, content: string): Promise<McpInspect> {
  const text = await readText(file).catch(() => null);
  if (text === null) return { state: 'absent' };
  return text === content ? { state: 'installed' } : { state: 'outdated', detail: '文件内容与当前 AI Cut 不一致' };
}

export async function installDropin(file: string, content: string, ctx: WriteContext): Promise<void> {
  const existing = await readText(file);
  if (existing !== null && !existing.includes(MANAGED_MARK)) throw new Error('同名文件不是 AI Cut 写的，不会覆盖');
  if (existing !== null) await backup(file, ctx);
  await writeAtomic(file, content);
}

export async function uninstallDropin(file: string, ctx: WriteContext): Promise<boolean> {
  const existing = await readText(file);
  if (existing === null) return false;
  if (!existing.includes(MANAGED_MARK)) throw new Error('文件不是 AI Cut 写的，不会删除');
  await backup(file, ctx);
  await unlink(file);
  return true;
}
