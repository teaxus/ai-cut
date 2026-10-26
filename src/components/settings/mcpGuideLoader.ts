// The MCP guide is reachable from two top bars — the dashboard's and the
// editor's — so its import thunk lives beside the dialog rather than inside
// either caller's loader module. Both sites must go through this one thunk: a
// single static import of McpGuide anywhere pulls it into an eager chunk and
// silently defeats every lazy() built on it, which is exactly what TopBar.tsx
// did (rolldown reported INEFFECTIVE_DYNAMIC_IMPORT and the module shipped in
// the entry chunk regardless of the dashboard's lazy wrapper).
// aicut-hook:IP-16 派生版用「Agent 接入」弹窗（MCP 与技能一起装进各 agent）取代上游 McpGuide；导出名仍是 McpGuideDialog。
// 文件名保持 McpGuide，上游 mcpGuideLoader.verify.ts 的"只能经这个加载器导入"检查照样生效。
export const loadMcpGuideDialog = () => import('../aicut/agent-connect/McpGuide');
