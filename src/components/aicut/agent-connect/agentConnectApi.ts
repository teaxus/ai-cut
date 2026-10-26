// ai-cut：「Agent 接入」弹窗的数据层——请求 /api/aicut/agents/*，并按状态推导每一行能做什么。
// 接口契约：shared/aicut/agent-api.ts；服务端路由：server/plugins/aicut/agent-installer.ts。
// 两个接口都只接受受信任编辑器窗口的同源 JSON 请求（与上游 connect-client 一样用相对路径 fetch）。
import type {
  AgentApplyRequest, AgentApplyResponse, AgentListResponse, AgentStatus, ApplyResult, Part,
} from '../../../../shared/aicut/agent-api';

export type { AgentStatus, ApplyResult, Part };

/** network = 连不上服务；http = 服务返回非 2xx（403 = 不是受信任的编辑器窗口）；invalid = 返回内容不认识。 */
export class AgentApiError extends Error {
  readonly kind: 'network' | 'http' | 'invalid';
  readonly status: number;
  constructor(kind: AgentApiError['kind'], status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

async function post<T extends { agents: readonly AgentStatus[] }>(route: 'list' | 'apply', body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/aicut/agents/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AgentApiError('network', 0, error instanceof Error ? error.message : String(error));
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '';
    throw new AgentApiError('http', response.status, detail ? `HTTP ${response.status} · ${detail}` : `HTTP ${response.status}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { agents?: unknown }).agents)) {
    throw new AgentApiError('invalid', response.status, `HTTP ${response.status}`);
  }
  return data as T;
}

export const listAgents = (): Promise<AgentListResponse> => post<AgentListResponse>('list', {});
export const applyAgents = (request: AgentApplyRequest): Promise<AgentApplyResponse> => post<AgentApplyResponse>('apply', request);

const ACTIONABLE: ReadonlySet<string> = new Set(['absent', 'outdated']);
const OURS: ReadonlySet<string> = new Set(['installed', 'outdated']);

/** App 能自动装、且现在没装或不是最新的部分。手动 / 读不懂 / 同名目录被占 / 缺技能文件都不在内。 */
export function installParts(agent: AgentStatus): Part[] {
  const parts: Part[] = [];
  if (agent.mcp.mode === 'auto' && ACTIONABLE.has(agent.mcp.state)) parts.push('mcp');
  if (agent.skill.mode === 'auto' && ACTIONABLE.has(agent.skill.state)) parts.push('skill');
  return parts;
}

/** 这一行实际由 AI Cut 装过的部分（卸载只动这些）。 */
export function uninstallParts(agent: AgentStatus): Part[] {
  const parts: Part[] = [];
  if (agent.mcp.mode === 'auto' && OURS.has(agent.mcp.state)) parts.push('mcp');
  if (agent.skill.mode === 'auto' && OURS.has(agent.skill.state)) parts.push('skill');
  return parts;
}

/** 主按钮叫「安装」还是「更新」：有任何一部分还没装就是安装。 */
export function installVerb(agent: AgentStatus): 'install' | 'update' {
  const absent = (agent.mcp.mode === 'auto' && agent.mcp.state === 'absent')
    || (agent.skill.mode === 'auto' && agent.skill.state === 'absent');
  return absent ? 'install' : 'update';
}

export const needsAction = (agent: AgentStatus): boolean => agent.detected && installParts(agent).length > 0;

/** App 替用户做不了、要用户自己处理的：手动添加、配置读不懂、同名技能目录被占、缺技能文件。 */
export function needsAttention(agent: AgentStatus): boolean {
  return agent.mcp.state === 'manual' || agent.mcp.state === 'unreadable'
    || agent.skill.state === 'foreign' || agent.skill.state === 'no-source';
}

/** 检测到的 agent 的显示顺序：需要安装 / 更新 → 需要用户处理 → 已全部装好；同档内保持注册表顺序。 */
export function detectedOrder(agents: readonly AgentStatus[]): string[] {
  const rank = (agent: AgentStatus) => (needsAction(agent) ? 0 : needsAttention(agent) ? 1 : 2);
  return agents
    .map((agent, index) => ({ agent, index }))
    .filter(({ agent }) => agent.detected)
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.index - b.index)
    .map(({ agent }) => agent.id);
}

/** 批量安装的范围与后果：哪些 agent、会改几个配置文件、复制几份技能（同一路径只算一次）。 */
export function batchPlan(agents: readonly AgentStatus[]): { ids: string[]; files: number; skills: number } {
  const ids: string[] = [];
  const files = new Set<string>();
  const skills = new Set<string>();
  for (const agent of agents) {
    if (!needsAction(agent)) continue;
    ids.push(agent.id);
    for (const part of installParts(agent)) {
      if (part === 'mcp') files.add(agent.mcp.path ?? agent.id);
      else skills.add(agent.skill.path ?? agent.id);
    }
  }
  return { ids, files: files.size, skills: skills.size };
}

/** 未检测到的 agent 能装成什么样（折叠区里每项一行）。 */
export function capability(agent: AgentStatus): 'auto' | 'manual' | 'skill-only' | 'none' {
  if (agent.mcp.mode === 'auto') return 'auto';
  if (agent.mcp.mode === 'manual') return 'manual';
  return agent.skill.mode === 'auto' ? 'skill-only' : 'none';
}

export interface RowError {
  readonly part: Part | null;
  readonly message: string;
  readonly path?: string;
}

/** 从一次 apply 的结果里挑出这个 agent 失败的部分。 */
export function rowErrorsFrom(results: readonly ApplyResult[], id: string): RowError[] {
  return results
    .filter((result) => result.id === id && !result.ok)
    .map((result) => ({ part: result.part, message: result.error ?? '', path: result.path }));
}
