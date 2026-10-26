// 从上游的外部技能 skills/openchatcut 生成 AI Cut 版本 skills/ai-cut（提交进仓库，App 打包时带上）。
// 上游技能升级后重跑本脚本即可跟上；--check 只比对不写入（tools/test.sh 与 upstream-sync gate 用它）。
// 改写规则：服务名 openchatcut → ai-cut、端口 5199 → 5299、产品名 → AI Cut、设置入口 → 「外部 Agent 接入」弹窗、
// 技能更新方式 → 在 AI Cut 里重新安装。工具名（openchatcut_status 等）、协议头（X-OpenChatCut-…）、环境变量（OPENCHATCUT_*）不动。
// 用法 / usage: node tools/lib/sync-skill.mjs [--check]
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { ROOT } from './integration-points.mjs';

export const SOURCE = join(ROOT, 'skills', 'openchatcut');
export const TARGET = join(ROOT, 'skills', 'ai-cut');
const ICON_SOURCE = join(ROOT, 'public', 'openchatcut-icon.png'); // 已是 AI Cut 图标（接入点 IP-05）
const ENDPOINT = 'http://127.0.0.1:5299/api/external-mcp/mcp';
const DIALOG_NAME = '**外部 Agent 接入 (MCP)** dialog (plug icon in the AI Cut top bar)';
const DIALOG = `the ${DIALOG_NAME}`;

const UPDATE_TEXT = `To update this skill, open ${DIALOG} and press **Install / update**
for this agent. AI Cut ships the matching skill version and rewrites it in place.`;

/** 按标题替换一整节（到下一个同级或更高级标题为止）；保留该节里第一个形如 `2026-..` 的版本行。 */
function replaceSection(text, heading, body) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return null;
  const level = heading.match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#+\s/.test(lines[end]) && lines[end].match(/^#+/)[0].length <= level)) end += 1;
  const version = lines.slice(start, end).find((l) => /^`\d{4}-\d{2}-\d{2}\.\d+`$/.test(l.trim()));
  const block = [heading, '', ...(version ? [version.trim(), ''] : []), body, ''];
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n');
}

// required: 上游原文变了导致规则没命中时报错（同步上游时要人或 AI 看一眼再改规则）
// phase: pre 在通用替换之前跑（匹配上游原文），post 在之后跑（插入的文字不再被通用规则改写）
const RULES = [
  { file: 'SKILL.md', phase: 'post', required: true, apply: (t) => replaceSection(t, '## Skill version', UPDATE_TEXT) },
  { file: 'references/known-errors.md', phase: 'post', required: true, apply: (t) => replaceSection(t, '## Skill baseline is newer', UPDATE_TEXT) },
  { file: 'references/getting-started.md', phase: 'pre', required: false, apply: (t) => {
    const re = /By default,\s+OpenChatCut generates it in private server memory[\s\S]*?newly displayed configuration\./;
    return re.test(t) ? t.replace(re, 'AI Cut generates it once, stores it on this machine and keeps it across\nrestarts, so a registered client keeps working; the Agent connect dialog shows it.') : null;
  } },
  { file: 'SKILL.md', phase: 'post', required: true, apply: (t) => {
    const re = /^(# AI Cut\n)/m;
    return re.test(t) ? t.replace(re, `$1\n> AI Cut edition of the OpenChatCut skill. AI Cut's ${DIALOG_NAME} normally registers\n> the \`ai-cut\` MCP server (with its token) for you; follow the setup steps below only when\n> the tools are missing.\n`) : null;
  } },
];

const GENERIC = [
  [/http:\/\/localhost:5199\b/g, ENDPOINT.replace('/api/external-mcp/mcp', '')],
  [/\b5199\b/g, '5299'],
  [/\*\*Settings → MCP\*\*/g, DIALOG],
  [/(codex mcp (?:get|add|remove) )openchatcut\b(?!_)/g, '$1ai-cut'],
  [/\bopenchatcut(?= http)/g, 'ai-cut'],
  [/`openchatcut`/g, '`ai-cut`'],
  [/\$openchatcut\b(?!_)/g, '$ai-cut'],
  [/^name: openchatcut$/m, 'name: ai-cut'],
  [/value: "openchatcut"/g, 'value: "ai-cut"'],
  [/openchatcut-icon\.png/g, 'ai-cut-icon.png'],
  [/(?<![\w/-])OpenChatCut(?![\w-])/g, 'AI Cut'],
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (name === '.DS_Store') return [];
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/** 返回 { files: Map<相对路径, Buffer|string>, missed: string[] } */
export function generate() {
  const files = new Map();
  const missed = [];
  for (const abs of walk(SOURCE)) {
    let rel = relative(SOURCE, abs).split('\\').join('/');
    if (rel === 'assets/openchatcut-icon.png') { files.set('assets/ai-cut-icon.png', readFileSync(ICON_SOURCE)); continue; }
    if (!/\.(md|ya?ml|txt)$/.test(rel)) { files.set(rel, readFileSync(abs)); continue; }
    let text = readFileSync(abs, 'utf8');
    const runRules = (phase) => {
      for (const rule of RULES.filter((r) => r.file === rel && r.phase === phase)) {
        const out = rule.apply(text);
        if (out === null) { if (rule.required) missed.push(`${rel}: 必须命中的改写规则没命中（上游原文变了）`); continue; }
        text = out;
      }
    };
    runRules('pre');
    for (const [re, to] of GENERIC) text = text.replace(re, to);
    runRules('post');
    if (rel === 'SKILL.md') {
      text = text.replace(/^description: .*$/m, 'description: Connect an MCP-capable coding agent to AI Cut (the desktop edition of OpenChatCut) and edit local video projects. Use when the user asks to install, connect, or set up AI Cut; inspect or edit an AI Cut project');
    }
    files.set(rel, text);
  }
  return { files, missed };
}

function sameContent(abs, content) {
  if (!existsSync(abs)) return false;
  const current = readFileSync(abs);
  return Buffer.isBuffer(content) ? current.equals(content) : current.toString('utf8') === content;
}

if (process.argv[1] && process.argv[1].endsWith('sync-skill.mjs')) {
  const check = process.argv.includes('--check');
  const { files, missed } = generate();
  for (const m of missed) console.error(`✗ ${m}`);
  const leftovers = [...files].filter(([, c]) => typeof c === 'string' && /localhost:5199|`openchatcut`|codex mcp add openchatcut/.test(c)).map(([rel]) => rel);
  for (const rel of leftovers) console.error(`✗ ${rel}: 生成结果里还有上游的服务名或端口`);
  const stale = [...files].filter(([rel, c]) => !sameContent(join(TARGET, rel), c)).map(([rel]) => rel);
  const extra = existsSync(TARGET) ? walk(TARGET).map((a) => relative(TARGET, a).split('\\').join('/')).filter((rel) => !files.has(rel)) : [];
  if (check) {
    for (const rel of stale) console.error(`✗ skills/ai-cut/${rel} 与上游生成结果不一致（跑 node tools/lib/sync-skill.mjs）`);
    for (const rel of extra) console.error(`✗ skills/ai-cut/${rel} 是多出来的文件`);
    const bad = missed.length + leftovers.length + stale.length + extra.length;
    console.log(bad ? '技能检查失败 / skill check failed' : `skills/ai-cut 与上游一致（${files.size} 个文件）/ in sync`);
    process.exit(bad ? 1 : 0);
  }
  if (missed.length || leftovers.length) process.exit(1);
  for (const [rel, content] of files) {
    const abs = join(TARGET, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of extra) console.warn(`!!! skills/ai-cut/${rel} 已不在上游，请手动删除`);
  console.log(`已生成 skills/ai-cut（${files.size} 个文件，${stale.length} 个有变化）`);
}
