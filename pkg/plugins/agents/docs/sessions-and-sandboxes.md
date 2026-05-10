# Sessions, workspaces, and sandboxes

How chat sessions map to Cloudflare Sandboxes, and why.

## The model

```
Workspace (DB row, agent_workspaces)
  ↳ 1:1 → Cloudflare Sandbox (Durable Object + Container)
  ↳ 1:N → Sessions (chat threads)
        ↳ each owns a providerSessionId (OpenCode/Claude Code session inside the container)
```

- **One workspace = one sandbox = one git working tree.** The sandbox name
  is derived from `(orgId, workspaceId)` in
  [`buildSandboxName`](../src/backend/workspaces/cloudflare-sandbox/provider.ts);
  same workspaceId always routes to the same Durable Object and therefore
  the same container.
- **One session = one chat thread.** Sessions hold their own model,
  system prompt, MCPs, and `providerSessionId`. The provider (OpenCode,
  Claude Code) multiplexes all of those sessions inside the single
  workspace's server process.
- **`agent_sessions.workspaceId` is a regular FK with no UNIQUE
  constraint.** N sessions can point at the same workspace.

## Why N sessions per sandbox

Two sessions sharing a sandbox share:

- the working tree (filesystem state, branch, uncommitted changes)
- the OpenCode/Claude Code server process
- LSP, tree-sitter, formatters
- container CPU/memory budget

That's a feature, not a bug, for the typical workflow:

1. **Cost.** Containers bill for active time. Keeping one container warm
   for three conversations is much cheaper than three containers spinning
   up/down independently.
2. **Cold start.** The first chat in a workspace pays the LSP/tree-sitter
   load. Chats 2..N start instantly.
3. **Workflow fit.** "One repo open, multiple threads of thought" matches
   how developers actually work — refactor in chat A, bugfix in chat B,
   tests in chat C, all against the same checked-out branch.
4. **Provider design.** Both OpenCode and Claude Code are built to
   multiplex sessions per workspace. Sandbox-per-session would pay the
   cold-start tax on every chat for no architectural benefit.

## When to start a fresh sandbox

A new workspace (and therefore a new sandbox) is the right call when:

- working on a different repo entirely
- you want a clean working tree with no carryover from prior tool calls
- you need an isolated branch state that won't be disturbed by other
  chats

These are coarse, deliberate gestures — the "+ New workspace" affordance.
They are not the default for "+ New chat".

## Tradeoff: shared filesystem state

Two chats in the same sandbox can stomp on each other:

- Chat A runs `git checkout feature-x`; chat B suddenly sees a different
  tree.
- Chat A writes `src/foo.ts`; chat B's next read picks up the change.

This is **user-debuggable** (`git status`, look at the diff, revert)
and the natural cost of sharing a working tree. We do not try to
isolate per-session filesystems within one sandbox — git worktrees are
a cleaner answer if a user genuinely needs that, and it remains
available without changes.

## UX implications

The sidebar groups sessions by workspace. Two distinct gestures:

| Gesture           | What it does                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `+ New chat`      | Adds a session to the current workspace. Sandbox is reused.        |
| `+ New workspace` | Creates a new workspace row. Provisions a fresh sandbox on demand. |

The first chat ever auto-creates a default workspace (the existing
behavior in `POST /sessions` when `workspaceId` is omitted) so
onboarding stays one click.

## API contract that supports this

The session-creation endpoint already supports both flows. From
[`sessions.endpoint.ts`](../src/backend/endpoints/sessions.endpoint.ts):

```
POST /sessions { workspaceId: "<existing>" }   → reuses workspace + sandbox
POST /sessions { }                             → auto-provisions a workspace
```

The default UX (`NewChatDialog`) historically only exposed the second
form, which is why every chat used to spawn its own sandbox. The
sidebar's `+ New chat` now passes the active workspace's id; `+ New
workspace` keeps `workspaceId` omitted to get a fresh provision.

## Related

- [`buildSandboxName`](../src/backend/workspaces/cloudflare-sandbox/provider.ts)
  — sandbox identity derivation.
- [`agent_sessions.workspaceId`](../src/backend/schema/tables.ts) — schema
  cardinality.
- `agents` plugin frontend layout — `AgentsLayout`, `SessionsSidebar`.
