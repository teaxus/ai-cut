// ai-cut：「Agent 接入」前后端共用的接口类型（服务端 server/external-agent/aicut/installer.ts，界面 src/components/settings/aicut/）。
//   POST /api/aicut/agents/list   {}                                   → AgentListResponse
//   POST /api/aicut/agents/apply  { action, ids, parts? }              → AgentApplyResponse
// 两个接口都只接受受信任编辑器窗口的同源 JSON 请求（返回内容含 MCP 令牌）。

export type Part = 'mcp' | 'skill';
export type Action = 'install' | 'uninstall';
export type McpKind = 'json' | 'jsonc' | 'toml-codex' | 'yaml-dropin' | 'copy' | 'none';
export type McpState = 'installed' | 'outdated' | 'absent' | 'unreadable';
export type SkillState = 'installed' | 'outdated' | 'absent' | 'foreign';

export interface McpStatus {
  readonly kind: McpKind;
  readonly verified: boolean;
  /** auto = App 能直接写；manual = 只能复制配置给用户粘贴；unsupported = 这个 agent 不支持远程 MCP */
  readonly mode: 'auto' | 'manual' | 'unsupported';
  readonly state: McpState | 'manual' | 'unsupported';
  readonly path?: string;
  /** 同步写入的其他文件（agent 的旧版路径等，只在已存在时写） */
  readonly extraPaths?: readonly string[];
  /** 安装会通过哪个命令完成（例如 claude mcp add-json）；没有则直接写文件 */
  readonly via?: string;
  readonly detail?: string;
  readonly snippet?: string;
  readonly source?: string;
  readonly note?: string;
}

export interface SkillStatus {
  readonly mode: 'auto' | 'unsupported';
  readonly state: SkillState | 'unsupported' | 'no-source';
  readonly path?: string;
  /** 同时装进的附加技能目录（agent 新旧两个位置都读时） */
  readonly extraPaths?: readonly string[];
}

export interface AgentStatus {
  readonly id: string;
  readonly name: string;
  readonly detected: boolean;
  readonly detectedBy?: string;
  readonly mcp: McpStatus;
  readonly skill: SkillStatus;
}

export interface ApplyResult {
  readonly id: string;
  readonly part: Part;
  readonly ok: boolean;
  readonly changed: boolean;
  readonly path?: string;
  readonly error?: string;
}

export interface AgentListResponse {
  readonly endpoint: string;
  readonly agents: readonly AgentStatus[];
}

export interface AgentApplyRequest {
  readonly action: Action;
  readonly ids: readonly string[];
  readonly parts?: readonly Part[];
}

export interface AgentApplyResponse {
  readonly results: readonly ApplyResult[];
  readonly agents: readonly AgentStatus[];
}
