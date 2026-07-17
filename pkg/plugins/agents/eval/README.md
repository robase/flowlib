# Agent eval harness

A local test harness for measuring the quality of the `@flowlib/agents` chat
agent — its **system prompt**, **tool selection**, and **conversational
behaviour**. This is the implementation of Part F of
[`docs/coding-agent-parity-plan.md`](../docs/coding-agent-parity-plan.md):
unit tests prove tool _mechanics_; this proves agent _quality_.

It drives the **real host path** (`runChatTurn` — the same function the Express
SSE endpoint and the Cloudflare Durable Object call) — swapping only the
provider, in-memory repositories, the emit sink (a transcript collector), and an
auto-responder for human-input / permission requests. An eval green here means
the real path behaves.

## Why it's shaped this way

- **Production fidelity.** Going through `runChatTurn` means every eval gets the
  real **tool surface** (`web.fetch`, `ask_user`, `memory.search`/`write`,
  `update_plan`, wired by `buildProviderTools`), the real **decision gate**, and
  **production-identical prompt composition** — not a stubbed subset.
- **Provider-injectable.** Pass the **scripted provider** for offline,
  deterministic self-tests (no API key, no Docker), or the real
  **`aiSdkProvider`** for live evals against Anthropic. The thing under test is
  the prompt + tool surface, not the provider.
- **Node, not workerd.** The plugin's own `vitest.config.ts` runs in the
  Cloudflare `workerd` pool. Evals need real timers, `node:fs`, and the AI SDK,
  so they run in Node via a separate config and `tsx`.
- **Turns never hang.** `ask_user` / human-input and permission requests are
  auto-answered (configurable per case via `humanInput` / `permission`), so a
  case that asks a clarifying question still runs to completion and is scorable.

## Layout

```
eval/
├── src/
│   ├── types.ts            # EvalCase, Scorer, Score, reports
│   ├── harness.ts          # runCase / runSuite — drives the real runChatTurn host path
│   ├── fakes.ts            # in-memory repositories + workspace provider
│   ├── transcript.ts       # structured view over the AgentEvent stream
│   ├── report.ts           # console + JSON reporting
│   ├── run.ts              # CLI entry (discovers cases, runs live, exits non-zero on fail)
│   ├── providers/
│   │   ├── scripted.ts     # deterministic provider for self-tests
│   │   └── ai-sdk.ts       # live Anthropic provider + judge (optional peer deps)
│   ├── workspaces/memory.ts # in-memory WorkspaceHandle for prompt/tool evals
│   └── scorers/            # deterministic checks + LLM-as-judge
├── cases/*.eval.ts         # the suite (default-export a case or array)
└── __tests__/              # harness self-tests (scripted provider, run in CI)
```

## Running

```bash
# From pkg/plugins/agents:

pnpm eval:test                  # harness self-tests — scripted provider, no API key
pnpm eval                       # live suite — needs ANTHROPIC_API_KEY
pnpm eval --grep clarify        # only cases whose id includes "clarify"
pnpm eval --model anthropic/claude-haiku-4-5
pnpm eval --samples 5           # run each case 5× (overrides per-case samples)
pnpm eval --concurrency 6       # up to 6 cases in flight (default 4; 1 for --sandbox)
pnpm eval --json report.json    # also write a machine-readable report
pnpm eval --sandbox             # real Docker workspace + sandbox.* tools
pnpm eval --sandbox --image node:24-slim
pnpm eval:typecheck             # typecheck the harness
```

From the repo root: `pnpm test:eval` (self-tests, no key) and `pnpm eval:agents`
(live). `pnpm eval` exits non-zero if any case fails — wire it into CI behind an
API-key gate (like the existing `pnpm test:e2e`); `test:eval` needs no key and
can run on every change.

Sandbox-only cases (`requiresSandbox: true`) are skipped — and listed — unless
you pass `--sandbox`.

## Writing a case

A case is the user prompt + the system prompt under test + scorers:

```ts
import { defineEvalCase } from '../src/index';
import { answeredDirectly, finalTextContains, turnSucceeded } from '../src/scorers';

export default defineEvalCase({
  id: 'direct-answer',
  systemPrompt: 'You are a concise, helpful coding assistant.',
  prompt: 'What is 2 + 2? Reply with just the number.',
  scorers: [turnSucceeded(), answeredDirectly(), finalTextContains('4')],
});
```

### Scorers

Prefer **deterministic** scorers — cheap and trustworthy — and reach for the
judge only for things that aren't mechanically checkable.

| Scorer                                          | Passes when                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `turnSucceeded()`                               | the turn ended with reason `completed`                      |
| `answeredDirectly()`                            | no tools were called                                        |
| `usedTool(name)` / `didNotUseTool(name)`        | a tool was / wasn't invoked                                 |
| `usedToolBefore(a, b)`                          | `a` was first called before `b` (e.g. grep→edit)            |
| `askedClarifyingQuestion()`                     | `ask_user` / a human-input request fired                    |
| `fileExists(path)` / `fileContains(path, x)`    | post-run workspace state                                    |
| `finalTextContains(s)` / `finalTextMatches(re)` | the assistant's text                                        |
| `completedWithin({ maxToolCalls, maxMs })`      | the turn stayed in budget                                   |
| `noDeniedToolsUsed()` / `noToolErrors()`        | safety / no tool errors                                     |
| `commandSucceeds(cmd)`                          | `cmd` exits 0 in the post-run workspace (verification loop) |
| `commandOutputContains(cmd, x)`                 | `cmd`'s post-run stdout matches `x`                         |
| `llmJudge({ rubric, passThreshold })`           | a 1–5 judge score ≥ threshold                               |

Tool names are matched on a normalised form, so `usedTool('sandbox.grep')`
matches the sanitised `sandbox_grep` that crosses the wire.

### Nondeterminism: samples + pass rate

Models are stochastic, so a single run per case is a coin flip. Set `samples`
to run a case N times; the case passes when the per-sample pass rate meets
`minPassRate` (default 1.0 — every sample must pass):

```ts
samples: 5,
minPassRate: 0.6,   // passes if ≥3/5 samples pass
```

The report shows `3/5 samples`, the weighted score is averaged across samples,
and the representative scorer breakdown comes from the first _failing_ sample so
you see why a flaky case slipped.

### Prompt versioning (A/B over time)

Every report stamps a `promptHash` (`#a1b2c3d4`) — a stable hash of the exact
system prompt the host composed. Diff `--json` reports across prompt edits to
see which change moved which case: same hash ⇒ same prompt ⇒ score deltas are
model noise, not your edit.

### The verification loop (`--sandbox`)

Lightweight cases use the in-memory workspace (no shell). To score the
**verification loop** (edit → run tests → fix), mark a case `requiresSandbox`
and run `pnpm eval --sandbox` — the CLI provisions a real local Docker container
per case (via the `local-docker` workspace provider), seeds `files` into it, and
exposes the `sandbox.*` tools. `commandSucceeds` then runs the test in the
post-run container:

```ts
export default defineEvalCase({
  id: 'fix-failing-test',
  requiresSandbox: true,
  prompt: 'Running `node test.js` fails. Find the bug, fix it, and make it pass.',
  files: {
    'src/add.js': 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n',
    'test.js': "const {add}=require('./src/add');require('assert').strictEqual(add(2,3),5);",
  },
  scorers: [
    usedTool('sandbox.read_file'), // oriented before editing
    fileContains('src/add.js', /a \+ b/), // applied the fix
    commandSucceeds('node test.js'), // the verification-loop assertion
    turnSucceeded(),
  ],
});
```

See [cases/fix-failing-test.eval.ts](cases/fix-failing-test.eval.ts).

## The feedback loop this enables

1. A new system-prompt idea → edit `systemPrompt` (or the real prompt sections)
   → `pnpm eval` to A/B against the suite.
2. A production failure → distil it into a new `*.eval.ts` case so it can't
   regress (keep old failures in the suite forever).
3. Track `--json` reports over time / per prompt version to see trends.

Because the prompt is composed from independent sections, you can also run
**section ablations** — vary one section, hold the rest fixed — to measure the
marginal value of each block instead of guessing.

## Limitations

- The in-memory workspace can't `exec` — verification-loop cases must be
  `requiresSandbox` and run with `--sandbox`, which needs Docker running.
- The LLM judge is itself a model — keep rubrics narrow, pair with deterministic
  scorers, and re-validate the judge against human labels periodically.
- Live runs need `ai` + `@ai-sdk/anthropic` installed (devDeps) and
  `ANTHROPIC_API_KEY` set.
- The suite is only as good as its cases — grow it from real production
  failures (each bug becomes a case that can't regress), not just happy paths.
