# `openCodeProvider`

`AgentProvider` implementation backed by [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk).

This file is the security-posture overview for the opencode adapter. Code lives in:

- [`provider.ts`](./provider.ts) — `AgentProvider` factory, capability flags, session lifecycle, prompt streaming.
- [`runtime.ts`](./runtime.ts) — lazy SDK loader, embedded-server cache, per-baseUrl HTTP-client cache, `resolveBaseUrl` priority chain, `getClientForMode`.
- [`events.ts`](./events.ts) — pure SSE → `AgentEvent` mapper. Stateless except for a small per-turn dedup state. Fixture-tested.
- [`__tests__/events.test.ts`](./__tests__/events.test.ts) — mapper unit tests.
- [`__tests__/provider.test.ts`](./__tests__/provider.test.ts) — provider integration tests with a faked `@opencode-ai/sdk`.

## Security posture (READ THIS FIRST)

opencode does **not** expose a synchronous pre-execution hook surface comparable to Claude Code's `canUseTool` callback. There is no place to plug in a "before this `Bash` runs, ask the user" or "before this `Write` runs, check ACLs" callback that runs **synchronously** with the tool dispatch.

This has two implications.

### 1. Tool-deny enforcement is best-effort, not a hard boundary

The provider intercepts tool-call events at the SSE event-stream layer. When a `tool_use` event arrives that hits the session's deny list, the provider:

1. Calls `client.session.abort()` to stop the live turn.
2. Yields a synthetic `tool-result` event with `isError: true` and a "tool denied" message so consumers' bookkeeping stays consistent.
3. Yields `session-end { reason: 'stopped' }` to terminate the iterator.

**Race window**: by the time we observe the `tool_use` event and dispatch the abort, opencode has already started executing the tool. For `Write` and `Bash` this means side-effects can be partially complete (a partially-written file, a half-run shell command). The kernel's `preToolUse` hook runs at this same layer, with the same race window — denying a tool from the hook does not prevent execution from starting, only from progressing further.

We surface this honestly via:

```ts
capabilities: { ..., permissionPrompts: false }
```

Consumers reading `capabilities.permissionPrompts === false` know the HIL permission-prompt UI is not available for opencode sessions. Don't render the "approve / deny" affordance on opencode chats.

### 2. The actual security boundary is the sandbox

In v1 opencode runs **inside** the workspace's `cloudflareSandbox` container (Stream E). The sandbox is a real Linux environment that we control:

- `Bash` cannot read files outside `/workspace`.
- `Write` cannot escape `/workspace`.
- Network egress can be filtered at the sandbox network layer.
- A compromised tool call cannot tamper with the host or other tenants — sandbox isolation is per-org.

The provider's tool-deny logic is an extra layer **on top of** the sandbox boundary, not a replacement for it. If you deploy opencode without a sandbox (e.g. local-fs workspaces in a deferred Express deployment), the deny logic on its own is **not sufficient**. In that case opencode should be denied write/exec capabilities entirely or the deployment should not use opencode for code-editing roles.

See [`plans/agents/security.md#provider-security-primitives--two-paths`](../../../../../../plans/agents/security.md#provider-security-primitives--two-paths) for the two-path discussion (Claude Code's hook layer vs opencode's sandbox boundary).

## Modes

The factory accepts a `mode` option:

- `'external'` (default) — `createOpencodeClient({ baseUrl })` against a long-running `opencode serve`. The baseUrl resolves from (in priority order):
  1. `workspace.metadata.opencodeBaseUrl` — set by `cloudflareSandbox` when it boots opencode inside the container.
  2. `extras.baseUrl` — per-call escape hatch (tests, ops).
  3. Factory `baseUrl` option.
  4. `OPENCODE_BASE_URL` env var.

  This is the v1 production posture — opencode runs inside the sandbox container, the provider talks to it over HTTP, the sandbox is the security boundary.

- `'embedded'` — `createOpencode()` boots an in-process opencode server. Cached per workspace `directory` so multiple sessions on the same workspace share one server (and its filesystem locks, LSP processes, …). Useful for local dev and single-tenant non-CF deployments.

A per-session `cfg.mode` (validated via `validateConfig`) and `extras.mode` override the factory default in that priority order.

## Event mapping

Per-event translation rules — exhaustive table:

| opencode event                            | `AgentEvent`                                        | Notes                                                               |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `message.part.updated` (`text`, delta)    | `text-delta`                                        | Falls back to `part.text` when no `delta` supplied.                 |
| `message.part.updated` (`tool`, running)  | `tool-call`                                         | Emitted exactly once per `callID` (deduplicated via mapper state).  |
| `message.part.updated` (`tool`, completed) | `tool-result` + maybe `file-edit`                  | `file-edit` synthesised for `write`/`edit`/`multiedit`/`patch`/`create` tools when `file_path` / `path` / `filepath` present in input. |
| `message.part.updated` (`tool`, error)    | `tool-result` (with `isError: true`)                |                                                                     |
| `permission.updated`                      | `permission-request`                                | Surfaced even though `permissionPrompts: false`; consumers may ignore. |
| `file.edited`                             | `file-edit`                                         | Uses the most recently observed `messageId` (or empty string).     |
| `message.updated` (assistant, completed)  | `message-complete` (with `usage`)                   | Includes input/output token counts when present.                   |
| `session.idle`                            | `message-complete` (terminator)                     | Suppressed if `message.updated` already emitted one for the same id. |
| `session.error`                           | `session-end { reason: 'error', error }`            | Falls back to `error.name` then a generic message.                 |
| Anything else (`session.created`, `vcs.*`, `tui.*`, `lsp.*`, `message.removed`, …) | dropped                                             | Returns `[]` — no consumer-facing event.                            |

## Lazy SDK loading

`@opencode-ai/sdk` is dynamic-imported on first call to `getSdk()` (inside `runtime.ts`), not on module evaluation. Apps that register the provider but never run a session pay zero SDK import cost. This matters because the SDK pulls in a substantial dependency tree (LSP clients, tree-sitter, formatters, …).

## References

- [`plans/agents/providers.md#opencodeprovider-file-editing`](../../../../../../plans/agents/providers.md) — design.
- [`plans/agents/sessions.md`](../../../../../../plans/agents/sessions.md) — event mapping table (canonical source).
- [`plans/agents/security.md`](../../../../../../plans/agents/security.md) — security posture, two-path discussion.
- [`@opencode-ai/sdk` package](https://www.npmjs.com/package/@opencode-ai/sdk).
