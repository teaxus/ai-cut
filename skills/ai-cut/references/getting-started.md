# Connect AI Cut

Use this flow when the user says “set up AI Cut”, when the `ai-cut`
MCP server is missing, or when its endpoint cannot be reached.

## 1. Find the endpoint

The default endpoint is:

```text
http://127.0.0.1:5299/api/external-mcp/mcp
```

Start AI Cut first. Open the **外部 Agent 接入 (MCP)** dialog (plug icon in the AI Cut top bar) in the trusted editor window,
copy the displayed bearer-token configuration, and use the endpoint shown there.
If desktop port 5299 was occupied, that page reflects the active fallback port.

## 2. Register the MCP server

### Codex

Check the existing entry:

```bash
codex mcp get ai-cut
```

If it is missing, export the token copied from the **外部 Agent 接入 (MCP)** dialog (plug icon in the AI Cut top bar) and register it:

```bash
export OPENCHATCUT_MCP_TOKEN='<token>'
codex mcp add ai-cut \
  --url http://127.0.0.1:5299/api/external-mcp/mcp \
  --bearer-token-env-var OPENCHATCUT_MCP_TOKEN
```

If an existing URL or token setting is stale, replace only that entry:

```bash
export OPENCHATCUT_MCP_TOKEN='<token>'
codex mcp remove ai-cut
codex mcp add ai-cut \
  --url http://127.0.0.1:5299/api/external-mcp/mcp \
  --bearer-token-env-var OPENCHATCUT_MCP_TOKEN
```

### Claude Code

```bash
claude mcp add --transport http \
  -H "Authorization: Bearer <token>" \
  ai-cut http://127.0.0.1:5299/api/external-mcp/mcp
```

For another client, register the endpoint as a Streamable HTTP MCP server and
set its `Authorization` header to `Bearer <token>`.
Clients that honor MCP `tools/list_changed` can reduce their initial prompt by
negotiating progressive exposure:

```text
http://127.0.0.1:5299/api/external-mcp/mcp?toolExposure=progressive
```

The equivalent request header is
`X-OpenChatCut-Tool-Exposure: progressive`. The initial list keeps connection,
session, project-read, `ToolSearch`, and `load_skill` tools. `ToolSearch` and
`load_skill` expand only that transport session's list. Clients that cache one
fixed tool list for the whole connection must use the default URL, which retains
the full compatibility surface.


## 3. Verify

When the MCP tools are available, call:

1. `openchatcut_status`
2. `list_projects`

Interpret the result:

- Editors listed: the live editor bridge is ready.
- Projects listed but no editor connected: project discovery works; open the
  intended project using its `editorUrl`.
- No projects: the connection works; ask whether to create a project.
- Connection error: follow `known-errors.md`.

Do not create or select a project just because one looks plausible.

## 4. Start the first task

Once the user has identified a project:

1. Call `target_project`.
2. Surface the URL returned by `get_editor_url`.
3. Follow `editing-workflow.md`.

## Token lifecycle

The endpoint always requires a bearer token, including on localhost. AI Cut generates it once, stores it on this machine and keeps it across
restarts, so a registered client keeps working; the Agent connect dialog shows it.

`OPENCHATCUT_MCP_TOKEN` overrides the generated token when a stable deployment
secret is required. Keep it in the MCP client's secret/environment configuration;
never write it into a repository, project document, chat, or browser storage.
