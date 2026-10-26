// 生成「上游新增 / 变更特性报告」docs/upgrades/<to>.md，供人和 AI 在同步上游时决定要跟进什么。
// 用法 / usage: node tools/lib/upstream-report.mjs <from-ref> <to-ref> [--out FILE]
// 内容：CHANGELOG 区间段落、MCP 工具目录变化（agent 能用的工具）、内置技能与外部技能变化、
// 设置项（keystore 白名单）变化、依赖变化、上游改动了哪些接入点文件。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, readRegistry } from './integration-points.mjs';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (ref, file) => { try { return git('show', `${ref}:${file}`); } catch { return null; } };
const json = (ref, file) => { const t = show(ref, file); try { return t ? JSON.parse(t) : null; } catch { return null; } };

export function changelogBetween(text, fromVersion, toVersion) {
  // 取 "## [to]" 到 "## [from]" 之间（不含 from）的段落
  const lines = (text ?? '').split('\n');
  const head = (v) => lines.findIndex((l) => l.startsWith(`## [${v}]`));
  const start = head(toVersion);
  const end = head(fromVersion);
  if (start < 0) return '(CHANGELOG 里没有找到这个版本的段落)';
  return lines.slice(start, end > start ? end : undefined).join('\n').trim();
}

export function toolCatalogDiff(before, after) {
  const index = (cat) => new Map(['edit', 'ask'].flatMap((k) => (cat?.[k] ?? []).map((t) => [t.name, { group: k, t }])));
  const a = index(before); const b = index(after);
  const added = [...b.keys()].filter((n) => !a.has(n)).sort();
  const removed = [...a.keys()].filter((n) => !b.has(n)).sort();
  const changed = [...b.keys()].filter((n) => a.has(n) && JSON.stringify(a.get(n).t) !== JSON.stringify(b.get(n).t)).sort();
  const describe = (n) => `- \`${n}\`（${b.get(n)?.group ?? a.get(n)?.group}）${(b.get(n) ?? a.get(n)).t.description ? `：${String((b.get(n) ?? a.get(n)).t.description).split(/(?<=\.)\s/)[0].slice(0, 160)}` : ''}`;
  return { added, removed, changed, describe };
}

function keyNames(ref) {
  const text = show(ref, 'server/keystore-names.ts') ?? '';
  const block = text.slice(text.indexOf('export const KEY_NAMES'), text.indexOf('] as const'));
  return new Set([...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]));
}

function depDiff(from, to) {
  const a = json(from, 'package.json') ?? {}; const b = json(to, 'package.json') ?? {};
  const rows = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const x = a[field] ?? {}; const y = b[field] ?? {};
    for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (x[name] !== y[name]) rows.push(`| ${field === 'dependencies' ? '运行' : '开发'} | \`${name}\` | ${x[name] ?? '—'} | ${y[name] ?? '—'} |`);
    }
  }
  return rows.sort();
}

export function buildReport(from, to) {
  const toPkg = json(to, 'package.json') ?? {}; const fromPkg = json(from, 'package.json') ?? {};
  const out = [];
  out.push(`# 上游同步报告：${from} → ${to}`, '');
  out.push(`生成：${new Date().toISOString().slice(0, 10)}　上游版本 ${fromPkg.version ?? '?'} → ${toPkg.version ?? '?'}　由 \`tools/upstream-sync.sh report\` 生成，可人工补充"跟进结论"一节。`, '');
  const stat = git('diff', '--shortstat', from, to).trim();
  const commits = git('rev-list', '--count', `${from}..${to}`).trim();
  out.push(`- 提交数：${commits}；改动：${stat}`, '');

  out.push('## 1. 上游 CHANGELOG', '', changelogBetween(show(to, 'CHANGELOG.md'), fromPkg.version, toPkg.version), '');

  const tools = toolCatalogDiff(json(from, 'assets/agent/openchatcut-tool-schemas.json'), json(to, 'assets/agent/openchatcut-tool-schemas.json'));
  out.push('## 2. agent 能用的 MCP 工具（assets/agent/openchatcut-tool-schemas.json）', '');
  out.push(`新增 ${tools.added.length}、删除 ${tools.removed.length}、参数或说明变化 ${tools.changed.length}。`, '');
  if (tools.added.length) out.push('**新增**', ...tools.added.map(tools.describe), '');
  if (tools.removed.length) out.push('**删除**', ...tools.removed.map((n) => `- \`${n}\``), '');
  if (tools.changed.length) out.push('**变化**', ...tools.changed.map((n) => `- \`${n}\``), '');

  const skillStat = (path) => git('diff', '--stat', from, to, '--', path).trim() || '（无变化）';
  out.push('## 3. 技能', '', '外部技能 `skills/openchatcut`（派生版据此生成 `skills/ai-cut`，跑 `node tools/lib/sync-skill.mjs`）：', '', '```', skillStat('skills/openchatcut'), '```', '');
  out.push('内置专项技能 `src/agent/skills/`：', '', '```', skillStat('src/agent/skills'), '```', '');

  const ka = keyNames(from); const kb = keyNames(to);
  const kAdded = [...kb].filter((k) => !ka.has(k)).sort(); const kRemoved = [...ka].filter((k) => !kb.has(k)).sort();
  out.push('## 4. 设置项（server/keystore-names.ts 白名单）', '');
  out.push(kAdded.length || kRemoved.length ? [...kAdded.map((k) => `- 新增 \`${k}\``), ...kRemoved.map((k) => `- 删除 \`${k}\``)].join('\n') : '（无变化）', '');

  const deps = depDiff(from, to);
  out.push('## 5. 依赖变化（package.json）', '');
  out.push(deps.length ? ['| 类型 | 包 | 之前 | 之后 |', '|---|---|---|---|', ...deps].join('\n') : '（无变化）', '');

  out.push('## 6. 上游改动了的接入点文件', '');
  const rows = [];
  for (const ip of readRegistry().filter((r) => r.status !== 'removed')) {
    for (const file of ip.files) {
      const log = git('log', '--format=%h %s', `${from}..${to}`, '--', file).trim();
      if (log) rows.push(`- **${ip.id}** \`${file}\`（${ip.strategy}）：\n${log.split('\n').map((l) => `  - ${l}`).join('\n')}`);
    }
  }
  out.push(rows.length ? rows.join('\n') : '（没有接入点文件被上游改动）', '');
  out.push('## 7. 跟进结论（同步时由人或 AI 填写）', '', '- 新工具 / 新设置是否需要在 AI Cut 的技能或文档里说明：', '- 接入点是否需要调整：', '- 其他：', '');
  return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('upstream-report.mjs')) {
  const [from, to] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const outIdx = process.argv.indexOf('--out');
  if (!from || !to) { console.error('用法 / usage: node tools/lib/upstream-report.mjs <from> <to> [--out FILE]'); process.exit(2); }
  const file = outIdx > 0 ? process.argv[outIdx + 1] : join(ROOT, 'docs', 'upgrades', `${to}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buildReport(from, to));
  console.log(`报告 / report: ${file}`);
}
