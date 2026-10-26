// ai-cut：「Agent 接入」的 HTTP 路由（由 server/plugins/aicut/index.ts 注册，接入点 IP-09）。
//   POST /api/aicut/agents/list   → { endpoint, agents: AgentStatus[] }
//   POST /api/aicut/agents/apply  { action: 'install'|'uninstall', ids: string[], parts?: ('mcp'|'skill')[] }
//                                 → { results: ApplyResult[], agents: AgentStatus[] }
// 两个都只接受受信任编辑器窗口发来的同源 JSON 请求（与上游一键连接 /api/external-agent/connect-client 同一套校验），
// 因为返回内容里有 MCP 令牌（给只能手动粘贴的 agent 用）。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { Plugin } from 'vite';
import { configuredEditorOrigin, externalMcpToken, headerValue, trustedEditorRequest } from '../../editor-auth.ts';
import { readBridgeJson, sendBridgeJson } from '../external-agent-bridge-routes.ts';
import { applyAgents, listAgentStatuses, type Action, type Part } from '../../external-agent/aicut/installer.ts';

const ACTIONS: readonly Action[] = ['install', 'uninstall'];
const PARTS: readonly Part[] = ['mcp', 'skill'];

/** 与上游 external-agent.ts 的 requestBaseUrl 同一规则：配置了编辑器地址就用它，否则用请求的 Host。 */
function mcpEndpoint(req: IncomingMessage): string {
  const configured = configuredEditorOrigin();
  const protocol = req.socket instanceof TLSSocket ? 'https:' : 'http:';
  const base = configured ?? `${protocol}//${headerValue(req, 'host') ?? '127.0.0.1'}`;
  return `${base}/api/external-mcp/mcp`;
}

function isJson(req: IncomingMessage): boolean {
  return headerValue(req, 'content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

export async function handleAgentInstaller(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method !== 'POST') {
    sendBridgeJson(res, 405, { error: 'method not allowed' });
    return;
  }
  if (!trustedEditorRequest(req, true)) {
    sendBridgeJson(res, 403, { error: 'untrusted editor origin' });
    return;
  }
  if (!isJson(req)) {
    sendBridgeJson(res, 415, { error: 'JSON required' });
    return;
  }
  const body = await readBridgeJson(req);
  const opts = { endpoint: mcpEndpoint(req), token: externalMcpToken() };
  if (route === '/list') {
    sendBridgeJson(res, 200, { endpoint: opts.endpoint, agents: await listAgentStatuses(opts) });
    return;
  }
  if (route === '/apply') {
    const action = body.action as Action;
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
    const parts = Array.isArray(body.parts) ? body.parts.filter((p): p is Part => PARTS.includes(p as Part)) : [...PARTS];
    if (!ACTIONS.includes(action) || ids.length === 0 || parts.length === 0) {
      sendBridgeJson(res, 400, { error: 'invalid request' });
      return;
    }
    const results = await applyAgents(opts, action, ids, parts);
    sendBridgeJson(res, 200, { results, agents: await listAgentStatuses(opts) });
    return;
  }
  sendBridgeJson(res, 404, { error: 'not found' });
}

export function agentInstallerPlugin(): Plugin {
  return {
    name: 'aicut-agent-installer',
    configureServer(server) {
      server.middlewares.use('/api/aicut/agents', (req, res) => {
        void handleAgentInstaller(req, res).catch((error) => {
          if (!res.headersSent) sendBridgeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        });
      });
    },
  };
}
