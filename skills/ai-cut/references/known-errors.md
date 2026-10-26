# AI Cut MCP recovery

## Connection refused

AI Cut is closed, the configured URL is stale, or desktop port 5299 fell
back to another port.

1. Start AI Cut.
2. Read the endpoint from the **外部 Agent 接入 (MCP)** dialog (plug icon in the AI Cut top bar) or the startup log.
3. Update the single `ai-cut` MCP entry.
4. Call `openchatcut_status` again.

## Projects exist but no editor is connected

Call `get_editor_url` for the intended project and have the user open it.
Project listing and creation can work without a live editor, while timeline
tools require the target project to be open.

## Tool missing

The editor registers project tools after its bridge connects. Open the target
project, call `openchatcut_status`, and refresh the MCP tool list.

## Active edit session

`begin_edit_session` rejects an existing draft unless `reuseExisting: true` is
set. Reuse keeps the session ID, staged operations and approval mode. It can
reuse a draft owned by the same MCP transport or adopt an unchanged orphan.
It cannot take a draft from another online transport or a recovery in progress,
and it does not bypass stale-project checks.

## Stale edit session

Call `list_edit_sessions` before starting another session. For an entry marked
`orphaned: true`, call `recover_edit_session` with one of its `recoveryActions`:

- `resume` continues a draft only when its checkpoint still matches the project.
- `discard` removes the abandoned draft without changing the live project.

An online owner must finish or discard its own session. Terminal `stale`,
`cancelled`, and `failed` sessions cannot be resumed; begin a fresh session.
An auto session stays auto and does not fall back to manual review.

## Proposal awaiting review

The draft is ready, but manual approval is still pending in AI Cut. Keep
polling `get_edit_session` only when the client needs the final state. Report
`applied`, `rejected`, or `discarded` exactly as returned.

## Skill baseline is newer

To update this skill, open the **外部 Agent 接入 (MCP)** dialog (plug icon in the AI Cut top bar) and press **Install / update**
for this agent. AI Cut ships the matching skill version and rewrites it in place.
