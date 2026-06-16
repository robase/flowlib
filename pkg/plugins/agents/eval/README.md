# Agent eval harness

A local test harness for measuring the quality of the `@flowlib/agents` chat
agent — its **system prompt**, **tool selection**, and **conversational
behaviour**. This is the implementation of Part F of
[`docs/coding-agent-parity-plan.md`](../docs/coding-agent-parity-plan.md):
unit tests prove tool _mechanics_; this proves agent _quality_.

It drives the **real kernel loop** (`runTurn`) — the same one production uses —
swapping only the provider, the persistence callbacks (no-ops), and the emit
sink (a transcript collector). An eval green here means the real loop behaves.

## Why it's shaped this way

- **Provider-injectable.** Pass the **scripted provider** for offline,
  deterministic self-tests (no API key, no Docker), or the real
  **`aiSdkProvider`** for live evals against Anthropic. The thing under test is
  the prompt + tool surface, not the provider.
- **Node, not workerd.** The plugin's own `vitest.config.ts` runs in the
  Cloudflare `workerd` pool. Evals need real timers, `node:fs`, and the AI SDK,
  so they run in Node via a separate config and `tsx`.
- **Real prompt composition.** Cases run through the actual
  `composeSystemPrompt`, so operating directives, memory, and deny-list
  mentions are exercised — not a stubbed prompt.

## Layout

```
eval/
├── src/
│   ├── types.ts            # EvalCase, Scorer, Score, reports
│   ├── harness.ts          # runCase / runSuite — builds SessionContext, drives runTurn
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

pnpm eval:test               # harness self-tests — scripted provider, no API key
pnpm eval                    # live suite — needs ANTHROPIC_API_KEY
pnpm eval --grep clarify     # only cases whose id includes "clarify"
pnpm eval --model anthropic/claude-haiku-4-5
pnpm eval --json report.json # also write a machine-readable report
pnpm eval --sandbox          # expose sandbox.* tools (needs a real workspace)
pnpm eval:typecheck          # typecheck the harness
```

`pnpm eval` exits non-zero if any case fails — wire it into CI behind an
API-key gate (like the existing `pnpm test:e2e`).

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

| Scorer | Passes when |
| --- | --- |
| `turnSucceeded()` | the turn ended with reason `completed` |
| `answeredDirectly()` | no tools were called |
| `usedTool(name)` / `didNotUseTool(name)` | a tool was / wasn't invoked |
| `usedToolBefore(a, b)` | `a` was first called before `b` (e.g. grep→edit) |
| `askedClarifyingQuestion()` | `ask_user` / a human-input request fired |
| `fileExists(path)` / `fileContains(path, x)` | post-run workspace state |
| `finalTextContains(s)` / `finalTextMatches(re)` | the assistant's text |
| `completedWithin({ maxToolCalls, maxMs })` | the turn stayed in budget |
| `noDeniedToolsUsed()` / `noToolErrors()` | safety / no tool errors |
| `llmJudge({ rubric, passThreshold })` | a 1–5 judge score ≥ threshold |

Tool names are matched on a normalised form, so `usedTool('sandbox.grep')`
matches the sanitised `sandbox_grep` that crosses the wire.

### A coding case (needs `--sandbox` + a real workspace)

Lightweight cases use the in-memory workspace (no shell). To score the
**verification loop** (edit → run tests → fix), wire the real `local-docker`
workspace provider via `runSuite`'s `createWorkspace` and run with `--sandbox`:

```ts
export default defineEvalCase({
  id: 'grep-before-editing',
  systemPrompt: '…',
  prompt: 'Rename the `getUser` helper to `fetchUser` everywhere.',
  files: { 'src/user.ts': 'export function getUser() {}\n' },
  scorers: [
    usedToolBefore('sandbox.grep', 'sandbox.edit_file'), // gauge blast radius first
    fileContains('src/user.ts', /fetchUser/),
    turnSucceeded(),
  ],
});
```

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

- The in-memory workspace can't `exec`; coding/verification-loop cases need the
  `local-docker` (or a sandbox) workspace.
- The LLM judge is itself a model — keep rubrics narrow, pair with deterministic
  scorers, and re-validate the judge against human labels periodically.
- Live runs need `ai` + `@ai-sdk/anthropic` installed (devDeps) and
  `ANTHROPIC_API_KEY` set.
