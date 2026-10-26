// tools/aicut-agents.sh 的实现：不开 App 界面，直接调安装器核心（server/external-agent/aicut/installer.ts）。
// 端点与令牌取自 AI Cut 的数据目录（~/.ai-cut/mcp-port、mcp-token），所以 AI Cut 至少要启动过一次。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyAgents, listAgentStatuses, type Action, type AgentStatus, type Part } from '../../server/external-agent/aicut/installer.ts';
import { AICUT_DEFAULT_PORT } from '../../shared/aicut/home.ts';

interface Args { cmd: string; agents: string[]; parts: Part[]; home: string; json: boolean; all: boolean; dryRun: boolean; port?: number }

function parse(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? 'list', agents: [], parts: [], home: homedir(), json: false, all: false, dryRun: false };
  for (let i = 1; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--agent') a.agents.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (v === '--part') a.parts.push(...(argv[++i] ?? '').split(',').filter(Boolean) as Part[]);
    else if (v === '--home') a.home = argv[++i] ?? a.home;
    else if (v === '--port') a.port = Number(argv[++i]);
    else if (v === '--json') a.json = true;
    else if (v === '--all') a.all = true;
    else if (v === '--dry-run' || v === '-n') a.dryRun = true;
    else throw new Error(`未知参数 / unknown option: ${v}`);
  }
  return a;
}

function connection(a: Args): { endpoint: string; token: string } {
  const root = process.env.AICUT_HOME || join(a.home, '.ai-cut');
  let token: string;
  try { token = readFileSync(join(root, 'mcp-token'), 'utf8').trim(); } catch {
    throw new Error(`读不到 ${join(root, 'mcp-token')}：请先启动一次 AI Cut（它会生成 MCP 令牌）/ start AI Cut once first`);
  }
  let port = a.port;
  if (!port) { try { port = Number(readFileSync(join(root, 'mcp-port'), 'utf8').trim()); } catch { port = AICUT_DEFAULT_PORT; } }
  return { endpoint: `http://127.0.0.1:${port}/api/external-mcp/mcp`, token };
}

const MCP_LABEL: Record<string, string> = { installed: '已安装', outdated: '需更新', absent: '未安装', unreadable: '读不懂配置', manual: '需手动', unsupported: '不支持' };
const SKILL_LABEL: Record<string, string> = { installed: '已安装', outdated: '需更新', absent: '未安装', foreign: '同名目录非 AI Cut 所装', unsupported: '不支持', 'no-source': '缺技能文件' };

function printTable(rows: AgentStatus[]): void {
  for (const r of rows) {
    console.log(`${r.detected ? '●' : '○'} ${r.name}（${r.id}）${r.detected ? `  检测到：${r.detectedBy}` : ''}`);
    console.log(`    MCP：${MCP_LABEL[r.mcp.state] ?? r.mcp.state}${r.mcp.path ? `  ${r.mcp.path}` : ''}${r.mcp.detail ? `  — ${r.mcp.detail}` : ''}`);
    console.log(`    技能：${SKILL_LABEL[r.skill.state] ?? r.skill.state}${r.skill.path ? `  ${r.skill.path}` : ''}`);
  }
}

const needsWork = (r: AgentStatus) => r.detected && (
  (r.mcp.mode === 'auto' && ['absent', 'outdated'].includes(r.mcp.state))
  || (r.skill.mode === 'auto' && ['absent', 'outdated'].includes(r.skill.state)));
const hasOurs = (r: AgentStatus) => ['installed', 'outdated'].includes(r.mcp.state) || ['installed', 'outdated'].includes(r.skill.state);

async function main(): Promise<void> {
  const a = parse(process.argv.slice(2));
  const conn = connection(a);
  const opts = { ...conn, home: a.home };
  const statuses = await listAgentStatuses(opts);
  if (a.cmd === 'list') {
    const shown = a.all ? statuses : statuses.filter((r) => r.detected || hasOurs(r));
    if (a.json) console.log(JSON.stringify({ endpoint: conn.endpoint, agents: shown }, null, 2));
    else { console.log(`AI Cut MCP 端点 / endpoint: ${conn.endpoint}`); printTable(shown); if (!a.all) console.log(`（只列出本机检测到的；--all 看全部 ${statuses.length} 个）`); }
    return;
  }
  if (a.cmd !== 'install' && a.cmd !== 'uninstall') throw new Error(`未知命令 / unknown command: ${a.cmd}`);
  const action = a.cmd as Action;
  const ids = a.agents.length ? a.agents : statuses.filter(action === 'install' ? needsWork : hasOurs).map((r) => r.id);
  if (ids.length === 0) { console.log(action === 'install' ? '没有需要安装或更新的 agent / nothing to install' : '没有 AI Cut 装过的东西 / nothing to uninstall'); return; }
  const parts: Part[] = a.parts.length ? a.parts : ['mcp', 'skill'];
  if (a.dryRun) {
    console.log(`(dry-run) 将对 ${ids.length} 个 agent 执行 ${action}（${parts.join(' + ')}）：`);
    printTable(statuses.filter((r) => ids.includes(r.id)));
    return;
  }
  const results = await applyAgents(opts, action, ids, parts);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.id} ${r.part}${r.changed ? '（已修改）' : '（无需改动）'}${r.path ? `  ${r.path}` : ''}${r.error ? `  — ${r.error}` : ''}`);
  if (a.json) console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((error) => { console.error(`✗ ${error instanceof Error ? error.message : String(error)}`); process.exit(2); });
