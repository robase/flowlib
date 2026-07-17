# Coding-agent parity plan — mirror Claude Code's tools + context

> Goal: make the `@flowlib/agents` chat agent genuinely good at working on code in
> git repositories — understanding a codebase, finding relevant code, gauging the
> blast radius of a change, and verifying it. We do this by mirroring the **tool
> surface** and **session context** that Claude Code (the coding agent) operates
> with, adapted to this plugin's runtime (AI SDK loop in a Durable Object / Node,
> with a lazily-provisioned sandbox container).

## Guiding principle: agentic exploration, not RAG

Claude Code does **not** build an embeddings/semantic index of the repo. It
navigates _agentically_ — grep for a symbol → read the hits → follow callers →
read more — deciding what to look at as it goes. This beats RAG for code:

- no stale index, no chunking artifacts, no retrieval misses;
- the model sees exact, current source with real line numbers;
- "where is the relevant code" becomes a precise, explainable `grep`.

**Implication:** invest in fast, excellent search/read/edit tools — _not_ a vector
index of source. Keep vectors (if ever) for prose memory, not code.

---

## Current state (baseline)

Tools today live in [`providers/ai-sdk/sandbox-tools.ts`](../src/backend/providers/ai-sdk/sandbox-tools.ts),
wrapping `WorkspaceHandle` (`exec`, `readFile`, `writeFile`, `listFiles`):

`sandbox.start`, `sandbox.read_file`, `sandbox.write_file`, `sandbox.edit_file`,
`sandbox.list_files`, `sandbox.run_shell`, `sandbox.git`.

Prompt context is composed in [`prompt/compose.ts`](../src/backend/prompt/compose.ts)
from section builders in [`prompt/sections.ts`](../src/backend/prompt/sections.ts):
system prompt → workspace context (built, **not wired**) → CLAUDE.md → skills →
deny-list → available tools → memory → plan → attachments → operating directives.

Constraints that shape every decision:

- **Sandbox is lazy** (`workspaceRequired: false`): no container exists at
  prompt-compose time; the first `sandbox.*` call cold-boots it.
- **Prompt is memoized** per session ([`composeEffectiveSystemPrompt`](../src/backend/service/chat-session-host.ts)).
- **DO turn budget** (~10–15s per `exec` via `containerFetch`): no long-running
  processes / background jobs.
- **Tool names** may be dotted; the ai-sdk provider's `sanitiseToolSet` maps
  `sandbox.grep → sandbox_grep` on the wire and restores it on events.
- **ripgrep may not be in the sandbox image** — tools must prefer `rg` and fall
  back to POSIX `grep`/`find` in a single shell invocation.
- **Shell injection**: `pattern`/`glob`/`path` come from the LLM into `exec` —
  everything must be single-quote-escaped (`shQuote`). Non-negotiable.

---

## Part 0 — Execution & workspace lifecycle (the real substrate)

> Tools are downstream of the environment. Claude Code runs in your **real,
> persistent working tree with unbounded command time**; this runs in an
> **ephemeral, budget-limited sandbox** whose contents must be cloned in and
> whose output must be shipped out. Several "parity" rows below are blocked by
> this environment, not by missing tools. **De-risk this before building tools.**

### 0.1 The verification-loop problem (highest-priority unknown)

The core of being good at code is the loop **edit → run tests/typecheck → read
failure → fix**. But `exec` is capped at ~10–15s (the DO `containerFetch`
budget), while `pnpm install`, `tsc`, `pnpm test`, and `pnpm build` take
**minutes**. So the most important capability does not fit the execution model as
designed. If this isn't solved, the agent finds code well but cannot confirm its
changes work.

Options (need a spike to choose):

- **Detached exec + poll** — start `pnpm test` non-blocking; write logs to a file;
  poll status/log across turns. Requires the sandbox SDK to support detached
  commands + reconnect (verify for cloudflare-sandbox / ComputeSDK).
- **Dedicated long-job tool** (`run_task`) distinct from `run_shell`, with a
  job id + `check_task`/`tail_task` polling tools.
- **Out-of-band verification** — agent proposes a diff; CI runs tests. A
  different product shape (agent doesn't self-verify in-loop).

### 0.2 Repo provisioning + auth

The tools assume a repo is already in the workspace. It isn't, until something
puts it there:

- **How** — `git clone` on first provision, or the `@flowlib/version-control`
  plugin, or a mount.
- **Auth** — private repos need a token (per-org GitHub/GitLab credential). Tie
  into the existing credential store + the sandbox outbound-auth path.
- **Selection** — which repo / branch; persisted on `agent_workspaces`.

### 0.3 Workspace persistence + cold-start cost

Does the container survive between turns? Between sessions? If torn down, every
session re-clones + re-installs deps (minutes) → crippling. We already persist
`sandboxId` (cloudflare-sandbox / ComputeSDK) — connect it to the coding UX:
warm-reuse the same sandbox per workspace, and treat `node_modules` install as a
one-time provisioning step, not per-turn.

### 0.4 Delivering the change back

The agent edits files **in the sandbox**, not the user's tree. The diff must flow
somewhere the user can act on:

- open a **PR** (via `@flowlib/version-control` / GitHub);
- a **downloadable patch** (`git diff` artifact);
- a **rendered diff** in the UI to review/approve.

This is the output half of the job and is currently absent.

### 0.5 Substrate spike checklist

Verified live via `wrangler dev` against a real `cloudflare/sandbox:0.10.0-opencode`
container (dev-only `GET /api/dev/sandbox-selftest` in flowlib-hosted):

- [x] **`exec` works** — `node -v` (v22.22.2), `git --version` (2.34.1).
- [x] **`git clone` works** — cloned a public repo (exit 0) over the container's
      network. Private-repo auth implemented + unit-tested (see 0.6); same code path.
- [x] **Long commands work** — a detached `startProcess` ran to completion and
      `getProcess` returned `status: completed`, `exitCode: 0`, captured stdout.
      This is the verification-loop substrate (`pnpm install`/`pnpm test`).
- [ ] **Persistence across turns/session resume** — `sandboxId` is persisted;
      end-to-end warm-reuse + one-time `node_modules` install still to confirm live.
- [x] **Diff delivery** — via GitHub PR (0.6); `git diff`/patch artifact still open.

`wrangler dev` runs the container **locally via Docker** (daemon must be up);
deployed dev/prod run it on Cloudflare. `SANDBOX_TRANSPORT=rpc` lets a single
exec/RPC outlive the HTTP sub-request budget, so clone/long commands work over
both `exec` (with a high timeout) and the detached `startProcess` path.

### 0.6 Implemented — clone-with-credential + GitHub PR delivery

**Clone (auth):** `WorkspaceHandle.cloneRepo({ repoUrl, branch?, dir?, token?, depth? })`
([cloudflare-sandbox/handle.ts](../src/backend/workspaces/cloudflare-sandbox/handle.ts)).
When a `token` is given it writes a git credential store inside the (isolated,
per-org) container — `git config --global credential.helper 'store --file=…'` +
`https://x-access-token:<token>@<host>` — so **both clone and later `git push`/
`fetch` authenticate**, and the token never appears on a command line.

The `sandbox.clone` tool resolves the token **server-side** via a host-supplied
`resolveGitToken({ repoUrl, credentialId })` (the agent never sees it). In
flowlib-hosted that reads the org's GitHub credential from the credential store
([flowlib.ts](/Users/rohan/code/flowlib-hosted/apps/api/src/flowlib.ts)).

**Long commands:** `sandbox.run_task` (detached `startProcess`) + `sandbox.check_task`
(`getProcess` poll) so installs/tests run past a single request's budget.

**PR delivery flow** (no new PR code — reuses `github.create_pull_request`, now in
the hosted allowlist):

1. `sandbox.clone` the repo (authenticated).
2. edit with `read_file`/`edit_file`/`multi_edit`; verify with `run_task` (tests).
3. `git checkout -b <branch>`, `git add`/`commit`, `git push -u origin <branch>`
   (authenticated via the stored credential helper) — via `sandbox.git`.
4. `github.create_pull_request({ owner, repo, head, base, title, body })`.

**Tradeoff (documented):** the git token lives inside the isolated per-org
container (the standard CI pattern, same trust boundary as the cloned code).
Hardening to Worker-side egress injection for `github.com` (like the LLM-key path)
is a follow-up. In-UI diff review is also deferred (PR is the delivery channel).

---

## Part A — Tool mirror

| Claude Code tool                              | Behaviour                                                               | Plugin equivalent                     | Action                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| **Read**                                      | numbered lines (`cat -n`), `offset`/`limit`, images/PDFs/notebooks      | `sandbox.read_file` (raw, whole file) | **upgrade**: line numbers + `startLine`/`endLine` + big-file cap           |
| **Edit**                                      | exact match, `replace_all`                                              | `sandbox.edit_file` (single literal)  | **upgrade**: add `replaceAll`; keep unique-match default                   |
| **MultiEdit**                                 | batched edits to one file, applied atomically                           | none                                  | **new** `sandbox.multi_edit` — multi-site refactors in one call            |
| **Write**                                     | create/overwrite                                                        | `sandbox.write_file`                  | ✅ parity                                                                  |
| **Bash**                                      | shell, timeout, background                                              | `sandbox.run_shell`                   | ✅ (no background — DO budget)                                             |
| **Grep**                                      | ripgrep: pattern/path/glob/type/`-i`/context/`output_mode`/`head_limit` | none (run_shell only)                 | **new** `sandbox.grep`                                                     |
| **Glob**                                      | fast file match, mtime-sorted                                           | `sandbox.list_files` (provider glob)  | **new** `sandbox.glob` (rg `--files`, sorted)                              |
| **Task / Agent**                              | spawn sub-agents (Explore/Plan), isolated context                       | none                                  | **new** `dispatch_agent` — recursive read-only sub-turn                    |
| **TodoWrite**                                 | working task list, shown to user                                        | none                                  | **new** `update_plan` → `agent_session_plans` (table exists), render in UI |
| **WebFetch**                                  | fetch URL → markdown                                                    | `http.request` (raw)                  | **new** `web_fetch` (HTML→text)                                            |
| **WebSearch**                                 | web search                                                              | none                                  | **new** `web_search` — needs search API key, config-gated                  |
| **AskUserQuestion**                           | structured choice prompt                                                | `decisionGate` (permission/HIL)       | **wire** an `ask_user` tool onto the gate                                  |
| Read images/PDF, NotebookEdit, ScheduleWakeup | multimodal / niche                                                      | —                                     | **defer**                                                                  |

### A1 — `sandbox.grep` (highest leverage)

New tool in `buildSandboxTools`. Params:

| param             | type             | notes                                      |
| ----------------- | ---------------- | ------------------------------------------ |
| `pattern`         | string, required | regex by default                           |
| `path`            | string?          | scope to a subdir (default workspace root) |
| `glob`            | string?          | file filter, e.g. `*.ts`                   |
| `literal`         | boolean?         | fixed-string (`-F`)                        |
| `caseInsensitive` | boolean?         | `-i`                                       |
| `contextLines`    | number?          | default 0, cap 5                           |
| `maxResults`      | number?          | default 100, hard cap 300                  |

Command (one shell line, rg-preferred, grep fallback):

```sh
if command -v rg >/dev/null 2>&1; then
  rg --line-number --no-heading --color never [-i] [-F] [-C N] [-g 'GLOB'] -m MAX -- 'PATTERN' 'PATH'
else
  grep -rnI [-i] [-F] --exclude-dir={node_modules,.git,dist,build,.next} [--include='GLOB'] -- 'PATTERN' 'PATH' | head -n MAX
fi
```

- `rg` respects `.gitignore`; grep fallback emulates with `--exclude-dir`.
- `shQuote()` every interpolated value.
- Parse `file:line:text` → `{ matches: [{file,line,text}], count, truncated, engine }`.
- Exit code 1 with empty stdout = "no matches" → `{matches:[],count:0}`, **not** an error.
- Reuse `assertSafePath(path)`.

### A2 — `sandbox.glob`

`rg --files -g 'GLOB'` (fallback `find … -not -path …`), capped + optionally
mtime-sorted. Params: `glob` (default `**/*`), `maxResults` (default 200, cap 1000),
`sortByRecent?`. Output `{ files, count, truncated }`.

Keep `sandbox.list_files` (portable path via `workspace.listFiles`, works for
non-sandbox workspaces); `glob` is the rich, gitignore-aware, sandbox path.
Sharpen both descriptions so the model reaches for `glob` on code search.

### A3 — ranged + numbered `read_file`

Add `startLine?` / `endLine?` (1-based inclusive). Output becomes line-numbered
(`  42\tcode`) plus `{ totalLines, startLine, endLine, truncated }`. If no range
and file > **400 lines**, return first 400 + `truncated:true` + a note to re-read
with a range.

**Critical nuance — numbered read vs literal `edit_file`:** `edit_file` matches a
raw literal `find`. Numbered read output must not leak `42\t` prefixes into edits.
Mitigate exactly as Claude Code does: numbered display + an explicit description
contract — _"line-number prefixes are display-only; never include them in
`edit_file.find`."_ Update the existing read_file test for the numbered format.

### A4 — `edit_file` `replaceAll` + `multi_edit`

`edit_file`: add optional `replaceAll: boolean`. Default keeps today's
unique-match safety (fails if `find` appears >1×); `replaceAll:true` replaces
every occurrence. Mirrors Edit's `replace_all`.

`multi_edit`: apply an **ordered list** of `{find, replace, replaceAll?}` edits to
one file **atomically** (read once, apply in sequence in memory, write once). A
failing edit (no match / ambiguous) aborts the whole batch — no partial writes.
Mirrors MultiEdit; the right primitive for multi-site refactors and far cheaper
than N round-trips.

### A5 — `dispatch_agent` (sub-agent)

Recursive **read-only** sub-turn: calls `runChatTurn` with a restricted toolset
(`grep`/`glob`/`read_file`/`run_shell` read-only) + its own token budget, returns
a text summary to the parent. Keeps deep exploration out of the main context.
**Cap nesting depth to 1.** Token-heavy — gate behind a per-provider flag.

### A6 — `update_plan` (TodoWrite parity)

Writes the session's task list to `agent_session_plans` (table already exists),
which the frontend renders. Lets the agent track multi-step work visibly. Pure
persistence + a UI surface; no model-runtime risk.

### A7 — `web_fetch` / `web_search`

- `web_fetch`: Workers `fetch` → strip HTML to text/markdown, cap size. Thin,
  high-value, no new dependency. (More ergonomic than raw `http.request`.)
- `web_search`: requires an external search API (Brave / Bing / Serper) — a
  config-gated option, off by default.

### A8 — `ask_user` (AskUserQuestion parity)

Wire a tool onto the existing `decisionGate.awaitHumanInput` so the agent can ask
a structured question mid-turn and block on the answer. The gate + HIL transport
already exist; this is a thin tool definition.

---

## Part B — Context mirror

What Claude Code _sees_ at session start, mapped to `prompt/sections.ts`:

| Claude Code context            | Contents                                                        | Plugin equivalent                           | Action                                                     |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| **Environment**                | cwd, is-git-repo, platform, OS, **today's date**, model id      | none                                        | **new** `renderEnvironment()`                              |
| **gitStatus**                  | branch, main branch, git user, `status --short`, recent commits | none                                        | **new** `renderGitStatus()` (from `git` in sandbox)        |
| **CLAUDE.md**                  | project + user conventions                                      | `claude-md-walk`                            | ✅ keep                                                    |
| **Directory structure**        | top-level tree of cwd                                           | `renderWorkspaceContext` (built, not wired) | **wire it**                                                |
| **Memory**                     | persistent facts                                                | `renderMemory`                              | ✅ (wired)                                                 |
| **System prompt / directives** | tone, tool policy, operating directives                         | `renderOperatingDirectives`                 | **enrich**                                                 |
| **IDE context**                | opened file, selection                                          | none                                        | **new** optional: frontend passes `activeFile`/`selection` |

### B1 — enriched operating directives

Add a tight code-work playbook to
[`renderOperatingDirectives`](../src/backend/prompt/sections.ts) (~8 lines; every
line is per-turn tokens):

- Orient first: list the tree; read `package.json`/README/`CLAUDE.md` to learn
  structure + how to run tests.
- Find with `sandbox.grep`/`sandbox.glob`, not by guessing paths. Read with
  `sandbox.read_file` (use line ranges for big files).
- Before changing a symbol, grep its definition **and all usages** to gauge blast
  radius.
- Verify: after edits, run the project's tests/typecheck/lint; fix what broke.
- Use `git log`/`git blame` to understand why code is shaped as it is.
- Record durable repo facts with `memory.write`; recall with `memory.search`.

Update `prompt/__tests__/compose.test.ts` assertions.

---

## Part C — The hard decision: context timing vs lazy sandbox

`renderEnvironment` / `renderGitStatus` / repo-map need the **sandbox**, which
boots **lazily after** the (memoized) prompt is composed. So those blocks have
nothing to read at compose time. Three resolutions:

1. **Eager-provision for code sessions** (opt-in `eagerWorkspace` flag) — boot the
   sandbox at session start when a repo is attached, so env/git/tree are real at
   compose time. Every code chat pays one cold-start up front. _What Claude Code
   effectively does. Recommended for code-first deployments._
2. **Synthetic first turn** — stay lazy; after the sandbox boots on turn 1, inject
   env/git/tree as a synthetic system/tool message. Context arrives one beat late;
   more moving parts.
3. **Directive-only** — don't inject; the agent runs `git status`/`ls`/reads
   `package.json` itself (B1). Cheapest; costs the agent a turn to orient.

**Recommendation:** ship the timing-independent pieces now (Part A tools +
CLAUDE.md/memory/directives), and implement env/git/tree behind option **(1)** as
an opt-in flag.

---

## Part D — Runtime-shaped differences (be deliberate)

- **No background processes / servers** — DO turn budget; Bash parity minus `&`.
  Multi-step (`stopWhen`) compensates.
- **Sub-agents are recursive turns**, not OS processes — cap depth to 1; budget-heavy.
- **`web_search`** needs an external API — config-gated, off by default.
- **Tool-count tax** — this ~doubles the catalogue; every tool is prompt tokens +
  selection load every turn. Lean on tight descriptions + the per-session
  `enabledTools` allow-list so deployments can trim.

---

## Part E — Safety & budgets (multi-tenant)

Arbitrary `run_shell` + `web_fetch` is a real attack surface even with an isolated
sandbox:

- **Secret exfiltration** — the agent can read `.env`/keys in the repo and POST
  them out via `web_fetch`/`run_shell`. Mitigations: keep real credentials out of
  the container (the existing outbound-auth/KV pattern), and consider an egress
  allow-list for `web_fetch`.
- **Destructive ops** — `git push -f`, `rm -rf`, package installs. Map each
  write/exec/push tool to the existing `decisionGate` / permissions resolver so a
  deployment can require approval (per-role deny-list already exists).
- **SSRF** — `web_fetch` to internal addresses; block private IP ranges /
  metadata endpoints.
- **Token/cost budget** — doubling the catalogue + multi-step + sub-agents costs
  tokens. Controls: keep `maxSteps` (25), add a per-turn output-token ceiling, cap
  `dispatch_agent` depth=1 + its own budget, tune `toolOutputStore` truncation.
- **Concurrency** — one turn per session already; add a workspace-level lock so a
  mid-turn message can't mutate the sandbox underneath a running turn.

## Part F — Evaluation (how we know it's actually good)

Unit tests prove tool _mechanics_, not coding _quality_. Add a small **eval
harness** as its own workstream: a fixture repo + a handful of scored tasks ("add
a test for X", "fix this failing build", "find where Y is configured"), run the
agent end-to-end, assert on outcome (tests pass / file changed / correct file
cited). Without this, "make it good" is unmeasurable. Start with 5–10 tasks; run
in CI behind an API-key gate (like the existing `pnpm test:e2e`).

## Part G — Semantic navigation (future axis, named not dismissed)

Grep/read is the right default. But the user's explicit goal — _understand the
effect of a change_ — is precisely what a **language server** gives:
find-references, go-to-definition, type errors across the project. It's heavy
(LSP per language in the sandbox) and out of scope for v1, but it is the precise
tool for "blast radius" and should be a tracked future axis, not silently omitted.
(Still **not** embeddings/RAG over source — that remains rejected.)

## Tests

All via the existing in-memory fakes — no live sandbox needed.

- **`sandbox-tools.test.ts`**: extend the fake `exec` to (a) assert constructed
  commands incl. **shell-quoting of an injection-y pattern** (`' ; rm -rf /`), and
  (b) return canned `rg` output to assert parsing. Cover grep literal/regex/glob,
  no-match (exit 1 → empty), `maxResults` truncation, grep-fallback branch; glob
  command/parse/cap; ranged read numbering/range/`>400` cap + the prefix contract;
  `edit_file replaceAll`.
- **`compose.test.ts`**: updated operating-directives assertions; new
  `renderEnvironment`/`renderGitStatus` section tests (Cut 2).
- Sub-agent / web_fetch / ask_user: unit tests with injected fakes.

---

## Sequencing

- **Cut 0 — substrate spike (de-risk first):** the four checklist items in §0.5
  (private clone, persistence, long-command exec, diff delivery). Tool work
  improves navigation but not end-to-end coding until these are green.
- **Cut 1 — core loop (no timing deps, fully unit-testable today):** `grep`,
  `glob`, ranged+numbered `read_file`, `edit_file replaceAll` + `multi_edit`,
  enriched operating directives + tests. _This is the Read/Edit/Write/Grep/Glob/Bash
  mirror — implementable + verifiable without a live sandbox._
- **Cut 2 — context blocks:** `renderEnvironment` + `renderGitStatus` + wire
  `renderWorkspaceContext`, gated on the Part C `eagerWorkspace` decision.
- **Cut 3 — "feels like CC" layer:** `update_plan` (TodoWrite), `web_fetch`,
  `ask_user`.
- **Cut 4 — advanced:** `dispatch_agent` sub-agents; `web_search` (gated).
- **Parallel workstream — eval harness (Part F)** so each cut's impact is
  measurable.

Each cut: implement → extend tests → `typecheck` + targeted test run green.

> **Note on ordering:** Cut 0 needs a live sandbox + infra decisions, so it can't
> be completed/verified in a pure code change. Cut 1 is the highest-value work
> that _can_ be fully implemented and tested now, so it lands first in code while
> Cut 0 is spiked separately.

---

## Open decisions

1. **Substrate (Cut 0)** — how do long commands run (detached+poll vs `run_task`
   vs out-of-band CI)? How is the repo cloned + authed? How is the diff delivered
   (PR / patch / UI)? These gate end-to-end coding.
2. **Context timing** — option (1) eager-provision opt-in, (2) synthetic first
   turn, or (3) directive-only?
3. **`list_files` vs `glob`** — keep both (portable vs rich) or fold into one?
4. **Safety posture** — which write/exec/push tools require `decisionGate`
   approval by default; egress allow-list for `web_fetch`?

**Implementation status:**

- **Cut 0 (substrate)** — clone-with-credential, `run_task`/`check_task` long
  commands, and PR delivery landed (§0.6). Open: live warm-persistence
  confirmation; `git diff`/patch artifact + in-UI diff review.
- **Cut 1 (core loop)** — ✅ `grep`, `glob`, ranged+numbered `read_file`,
  `edit_file replaceAll`, `multi_edit`, enriched operating directives + tests.
- **Cut 2 (context blocks)** — ✅ `renderEnvironment` + `renderGitStatus`
  ([sections.ts](../src/backend/prompt/sections.ts)), gathered at session start
  via [gather-context.ts](../src/backend/prompt/gather-context.ts) and wired
  through [chat-session-host.ts](../src/backend/service/chat-session-host.ts)
  behind the **`eagerWorkspace`** option (Part C decision = option (1),
  eager-provision opt-in). Also wires the previously-unwired
  `renderWorkspaceContext` + CLAUDE.md walk.
- **Cut 3 (feels-like-CC)** — ✅ `web.fetch`, `ask_user`, `update_plan`,
  `memory.*` (already present).
- **Cut 4 (advanced)** — ✅ `web.search` (config-gated via the `webSearch`
  option, [web-search.ts](../src/backend/tools/web-search.ts)) and
  `dispatch_agent` (read-only sub-turn, depth-capped at 1, gated via the
  `subAgents` option, [dispatch-agent.ts](../src/backend/service/dispatch-agent.ts)).
- **Eval (Part F)** — harness + scorers in place; coding-quality cases added
  (`find-where-configured`, `add-a-test`, `safe-rename`, `fix-failing-test`),
  sandbox-gated (run with `--sandbox`).

**Resolved open decisions:** (2) context timing → eager-provision opt-in
(`eagerWorkspace`); (3) keep BOTH `list_files` (portable) and `glob` (rich,
gitignore-aware). Still open: (1) substrate tail (persistence/diff-artifact),
(4) which write/exec/push tools require `decisionGate` approval by default +
`web.fetch` egress allow-list. Part G (LSP/semantic nav) remains a tracked
future axis.
