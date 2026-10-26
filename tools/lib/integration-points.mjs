// 读 docs/integration-points.md 的表格，检查每个 landed 接入点的标记是否还在对应文件里。
// Parses the integration-point registry and checks that every landed hook marker is present.
// 用法 / usage: node tools/lib/integration-points.mjs [--json]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = join(ROOT, 'docs', 'integration-points.md');

const unquote = (cell) => cell.trim().replace(/^`|`$/g, '');

/** @returns {{id:string, files:string[], marker:string|null, strategy:string, status:string, intent:string}[]} */
export function readRegistry(text = readFileSync(REGISTRY, 'utf8')) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!/^\|\s*IP-\d+\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const [id, fileCell, markerCell, strategy, status, intent] = cells;
    // 文件列可能写成 "`a.ts`（it、ru 同）"：取所有反引号里的路径
    const files = [...fileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const marker = markerCell === '—' ? null : unquote(markerCell);
    rows.push({ id, files, marker, strategy, status, intent });
  }
  return rows;
}

/** 返回问题列表；空数组 = 全部通过 */
export function checkLanded(rows, root = ROOT) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) problems.push(`${row.id}: 编号重复 / duplicate id`);
    seen.add(row.id);
    if (row.status !== 'landed') continue;
    if (row.files.length === 0) problems.push(`${row.id}: 没写文件 / no file`);
    for (const rel of row.files) {
      const abs = join(root, rel);
      if (!existsSync(abs)) { problems.push(`${row.id}: 文件不存在 / missing file ${rel}`); continue; }
      if (row.marker && !readFileSync(abs, 'utf8').includes(row.marker)) {
        problems.push(`${row.id}: ${rel} 里找不到标记 / marker not found: ${row.marker}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = readRegistry();
  const problems = checkLanded(rows);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ rows, problems }, null, 2));
  } else {
    const landed = rows.filter((r) => r.status === 'landed').length;
    console.log(`接入点 / integration points: ${rows.length} 个，已落地 / landed ${landed} 个`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (problems.length === 0) console.log('  全部标记都在 / all markers present');
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
