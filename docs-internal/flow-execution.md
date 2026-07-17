# Flow Execution — Internals

**Scope:** How a flow actually executes inside `@flowlib/core` — the service layering, the scheduler, the per-node pipeline, and the state that's shared between them. This is the implementation companion to the user-facing [Execution Model](../pkg/docs/content/docs/execution-model.mdx) page; that page explains the model, this one explains the code.

**Audience:** Engineers changing the orchestrator, debugging a run, or wiring a new host (Workers, Workflows, queue consumers).

**Date:** 2026-07-17

**On references:** where a symbol name is given (`runSchedulerLoop()`, `handleBranchSkipping()`), that's the durable pointer — grep for it. Bare line numbers are a convenience and go stale on the next edit; the symbol wins if they disagree.

---

## TL;DR for someone about to change this code

- **Execution is parallel by default.** A ready-set scheduler runs up to **8 nodes concurrently**. Any doc, comment, or mental model that says "strictly sequential" is stale.
- **Concurrency is not configurable.** `schedulerConcurrency` exists on `FlowRunCoordinatorDeps` and is read by `getConcurrency()`, but nothing in `src/` passes it — `ServiceFactory` constructs the coordinator without it. The effective value is always 8.
- **Three layers, clean boundaries.** Service = "which flow, which run row, sync or async". FlowRunCoordinator = "walk the graph, own run status". NodeExecutionCoordinator = "run one node, own its trace".
- **Shared mutable state is the coupling.** `skippedNodeIds` and `nodeOutputs` are passed into the scheduler by reference and mutated in place by callbacks. This is deliberate and load-bearing — read [Shared state](#shared-state-the-important-part) before touching it.
- **Failure is a hard stop and it is hardcoded.** `failureMode: 'stop'` and `batchPolicy: 'pause-immediately'` are literals at the construction site. The type allows `'drain'` / `'drain-then-pause'`; neither is implemented.
- **`topologicalSort` is the cycle guard — do not remove it.** Its *return value* is only used for a debug log, which makes it look deletable. It isn't: it throws on cycles, and the scheduler has no cycle detection of its own. See [Cycles](#cycles-and-the-topologicalsort-guard).

---

## Layering

```
FlowOrchestrationService          flow-orchestration.service.ts
  ├─ owns: run row creation, sync-vs-async, polling timers, job handlers
  ├─ constructs both coordinators in its ctor        (:96-119)
  └─ never walks the graph
        │
        ▼
FlowRunCoordinator               flow-orchestration/flow-run-coordinator.ts
  ├─ owns: graph walk, run status, heartbeat, abort controllers, branch skipping
  └─ constructs a Scheduler per run-segment          (runSchedulerLoop)
        │
        ▼
Scheduler                        flow-orchestration/scheduler.ts
  └─ owns: readiness, concurrency, launch/drain. No domain knowledge.
        │
        ▼ (executeNode closure)
NodeExecutionCoordinator         flow-orchestration/node-execution-coordinator.ts
  └─ owns: one node — inputs, templates, hooks, action dispatch, trace writes
```

`GraphService` and `TemplateService` / `JsExpressionService` hang off the sides as pure helpers.

### Entry points (service layer)

| Method | Line | Use |
| --- | --- | --- |
| `executeFlow` | `:229` | Sync. Load flow → `initiateFlowRun`. Waits for the result. |
| `executeFlowAsync` | `:278` | Creates the run row, enqueues `JOB_TYPES.FLOW_RUN` with `idempotencyKey = execution.id`, returns PENDING immediately. Falls back to fire-and-forget if no job runner. |
| `executePendingRun` | `:620` | **The canonical consumer-side entry.** What queue workers call. Loads the run at its *pinned version*. **Never throws** — catches and persists FAILED. |
| `initiateFlowRun` | `:430` | Validate → create run → `executeFlowDefinition`. Also swallows throws into a FAILED result. |
| `executeFlowToNode` | `:534` | Partial run over `graphService.getExecutionPathToNode(...)`. Backs "run to here" in the editor. |
| `resumeFromBatchCompletion` | `:687` | Delegate. Entry from the batch poller. |
| `cancelExecution` | `:748` | `abortRun` then write CANCELLED. **In-process only** — returns false if the run is live on another process. |

Two behaviours worth internalising:

- **`executePendingRun` forces per-node trace persistence when `run.triggerType === 'manual'`** (`:653-663`), so the Logs panel can read traces mid-run. This is why a manual run behaves differently from a queued one under `persistence: 'per-run'`.
- The service **catches rather than rethrows** in `initiateFlowRun` and `executePendingRun`. A caller that expects exceptions on failure will wait forever for one.

---

## The scheduler

`scheduler.ts` is small (350 lines), self-contained, and has no domain knowledge — it takes a node set, an edge set, and an `executeNode` thunk. Read the class doc comment at `:60-83` first; it's accurate.

### The loop

```
run()
  seedReady()                       // every node with all parents terminal
  while true:
    while canLaunch():              // ready queue non-empty, inFlight < concurrency,
      launch(readyQueue.shift())    //   not aborted, not failed-stop, not paused
    if inFlight is empty: break
    handleCompletion(await race(inFlight))
```

**Readiness** = `allParentsTerminal(nodeId)` (`:333`) — every incoming edge's source is in `terminal`. No parents ⇒ ready immediately.

**Terminal ≠ done.** Two sets, and the distinction matters:

- `terminal` (`:93`) — SUCCESS or SKIPPED only. **Children may promote.**
- `done` (`:95`) — any completion, *including* FAILED and BATCH_SUBMITTED. Prevents relaunch.

So a FAILED node lands in `done` but not `terminal`, and its children never become ready. That — not `canLaunch` — is what actually stops a failed branch; `canLaunch`'s failure gate just stops *unrelated* ready work.

### Cycles and the `topologicalSort` guard

The scheduler has **no cycle detection**. In a cycle `A → B → A`, neither node's parents ever reach terminal, so neither becomes ready, `seedReady` skips both, and the loop exits as soon as `inFlight` empties. The run would report **SUCCESS with those nodes silently unexecuted** — a wrong-answer failure, not a loud one.

The only thing preventing that is `GraphService.topologicalSort` (`graph.service.ts:26`), which throws `'Flow contains cycles and cannot be executed'` when its result is shorter than the node list. `executeFlowDefinition` calls it purely for that side effect — the returned order is informational, since the scheduler runs by readiness.

This is a trap: the call *looks* like a leftover feeding a debug log, and deleting it typechecks, passes tests, and silently converts a loud error into a wrong result. It's marked `CYCLE GUARD — do not remove` in the source. If the scheduler ever grows its own cycle detection, retire the sort *in the same change*.

### Why there's no locking

All bookkeeping happens in `handleCompletion`, which runs between `await`s. Two completions are never processed concurrently. The comment at `:79-82` makes this explicit — **preserve this property**. Any `await` introduced inside `handleCompletion` or `onNodeSuccess` breaks the invariant and introduces real races on the shared sets.

### Options, and which are real

Constructed exactly once, `flow-run-coordinator.ts` → `runSchedulerLoop()`:

| Option | Value | Configurable? |
| --- | --- | --- |
| `concurrency` | `deps.schedulerConcurrency` else **8** | **No** — nothing passes it |
| `failureMode` | `'stop'` | **No** — hardcoded literal in `runSchedulerLoop()` |
| `batchPolicy` | `'pause-immediately'` | **No** — hardcoded literal in `runSchedulerLoop()` |
| `signal` | `getRunAbortSignal(flowRunId)` | via `abortRun` |
| `nodes` | full / path-filtered / resume-filtered | per entry point |
| `skippedNodeIds`, `nodeOutputs` | **shared mutable refs** | — |

`SchedulerFailureMode` includes `'drain'` and `SchedulerBatchPolicy` includes `'drain-then-pause'` (`scheduler.ts:7-8`). Neither is implemented; the types are aspirational.

---

## Shared state (the important part)

The scheduler and the coordinator communicate through **two mutable collections passed by reference**:

**`nodeOutputs: Map<string, NodeOutput>`**
- Scheduler writes SUCCESS outputs (`scheduler.ts:243`).
- The `executeNode` closure reads it to build downstream inputs.
- On resume, pre-populated from persisted traces; `alreadyComplete` is `new Set(nodeOutputs.keys())` (`continueFlowRunFromBatch`).

**`skippedNodeIds: Set<string>`**
- Mutated from three directions: `onNodeSuccess` → `handleBranchSkipping`; actions via `functions.markDownstreamNodesAsSkipped`; the scheduler itself on a SKIPPED trace.
- The scheduler detects external mutation by **size comparison** — `absorbNewlySkipped` (`absorbNewlySkipped`) early-returns when `skippedNodeIds.size === lastSkippedSize`.

<!-- prettier-ignore -->
> ⚠️ **The size check is a real constraint.** Anything that adds *and* removes ids between two completions, netting to the same size, is invisible to `absorbNewlySkipped` and those nodes never get absorbed as terminal. Nothing does this today. If you ever need to un-skip a node, this mechanism must change.

### Branch skipping

`handleBranchSkipping` (`flow-run-coordinator.ts` → `handleBranchSkipping()`), called as `onNodeSuccess`:

1. Requires SUCCESS + an object at `trace.outputs.data.variables`.
2. `connectedHandles` = non-null `sourceHandle`s on outgoing edges.
3. **A handle is active iff `variables[handle] !== undefined`.** That single check is the entire branch decision — how `core.if_else` and `core.switch` signal their branch. An action that emits a handle key with an `undefined` value marks that branch dead.
4. Inactive-handle targets, minus targets that also have an active-handle edge from the same node, minus targets with an incoming edge from any other non-skipped source (join protection).
5. Survivors → `skippedNodeIds` + `graphService.markDownstreamNodesAsSkipped(...)`.

Reused on the **resume path** (the resume path) to replay skips, because **skipped nodes have no persisted SKIPPED trace** — the skip set is reconstructed by re-running this logic over completed traces. That's a subtle coupling: change the skip rule and you change how historical runs resume.

---

## The per-node pipeline

The `executeNode` closure (`flow-run-coordinator.ts` → the `executeNode` closure in `runSchedulerLoop()`) runs, per node:

```
prepareNodeInputs          → handle-keyed map (fallback only; see below)
buildIncomingDataObject    → reference-id-keyed object (the real input)
nodeExecutionCoordinator.executeNode(...)
```

`executeNode` (`node-execution-coordinator.ts:421`) is a dispatcher: mapper enabled → `executeNodeWithMapper`, else `executeNodeOnce`.

### `executeNodeOnce` (`:475-886`)

| Step | Line | Note |
| --- | --- | --- |
| Resolve action from registry | `:496` | Throws if `node.type` unknown |
| Merge field `defaultValue`s under `node.params` | `:503` | |
| Compute `skipTemplateResolutionKeys` | `:513` | Only `core.template_string` skips `'template'` |
| `resolveTemplateParams` | `:519` | |
| **Create trace row** | `:542` | **Before execution.** `inputs = incomingData` if non-empty, else the handle-keyed `safeInputs` |
| Status → RUNNING | `:550` | |
| Build `NodeExecutionContext` | `:552-687` | The `functions` bag + `abortSignal` |
| Hook `beforeNodeExecute` | `:693` | May skip the node or rewrite params |
| **Dispatch** `executeActionAsNode` | `:727` | |
| Hook `afterNodeExecute` | `:740` | Skipped when state is `PENDING`; may rewrite output |
| Hook `afterAgentExecute` | `:804` | `core.agent` + SUCCESS only |
| Terminal write | `:823-866` | `FAILED` / `PENDING`→**`BATCH_SUBMITTED`** / `SUCCESS` |
| Catch-all | `:867` | `classifyError` → FAILED with `errorDetails` |

All hooks are wrapped in try/catch and logged non-fatally. A throwing plugin hook cannot fail a run.

### `buildIncomingDataObject` (`:147-207`)

The contract is documented at `:124-146`. Three behaviours to know:

- **Direct parents** → top-level, keyed by `getNodeSlug` (`referenceId || generateNodeSlug(label || type || id)`).
- **`trigger.manual` is spread flat** (`:175-184`) — its keys go on the top level and its own slug is *not* added, so declared inputs read as `{{ topic }}`. Only when the value is a non-array object.
- **`previous_nodes`** ← `collectIndirectAncestors` (`:261`), a BFS upward skipping direct parents; attached only if non-empty.

`extractNodeOutputValue` (`:220-255`) prefers `variables.output.value` → `variables.output` → first variable key, then JSON-parses strings that parse to objects. That last bit means a node returning a JSON *string* is silently reified into an object downstream.

### `resolveTemplateParams` (`:305-343`)

**Shallow — top-level string values only.** Nested objects and arrays are not walked (`:337`). A template inside an array element or a nested object is never resolved.

**Render errors do not fail the node** (`:328-336`) — logged as a warning, original string preserved. Combined with `TemplateService`'s mixed-template behaviour (errors → empty string), a broken expression usually surfaces as bad data rather than a failure.

### The mapper

Where iteration lives: **`executeNodeMapperIterating`**.

- Expression eval failure → FAILED with `_mapper: { expression, error }` in the trace inputs, code `BAD_REQUEST` (the expression-eval catch).
- Mode enforcement `:952-977`. `iterate` + non-array → FAILED (`VALIDATION`). `reshape` + array → silently rewrapped `{ items: [...] }`.
- **Concurrency is fixed-window, not rolling** (the parallel window loop): `items.slice(start, start+concurrency)` + `Promise.allSettled`, breaking after the first window containing a rejection. A slow item stalls its whole window.
- **Each iteration writes its own child trace** — `executeSingleMapperIteration` calls `executeNodeOnce` (`executeSingleMapperIteration`). N items ⇒ N+1 trace rows (N children + the mapper parent). Relevant to D1/Postgres write volume.
- Item context (`buildMapperItemContext`): `{...incomingData}` → item object spread over it → `_item`. **Later layers win**, so an item field named like an upstream node shadows it.
- Packaging `:1254-1281`: `array` | `object` (keyed by `keyField ?? 'id'`) | `first` | `last` | `concat`.

<!-- prettier-ignore -->
> ⚠️ **The mapper drops the abort signal.** `executeNodeWithMapper` takes `_abortSignal` (`:910`) and never forwards it; neither mapper call to `executeNodeOnce` (both mapper call sites) passes one. **A cancelled run cannot interrupt an in-progress mapper node** — it runs to completion. Worth fixing.

### What lands in the trace

| Status | Written |
| --- | --- |
| create | `flowRunId`, `nodeId`, `nodeType`, `inputs` (= `incomingData`) |
| RUNNING | status only |
| FAILED | `error` (joined), `errorDetails`, `fieldErrors` |
| BATCH_SUBMITTED | status only — **no outputs** |
| SUCCESS | `outputs` (post-hook-override) |

**Resolved params are never persisted.** They're passed to the action and to hooks but no trace field carries them. "What did this node actually run with, after templating?" is not answerable from the trace — a recurring debugging gap.

---

## Batch pause / resume

1. An action returns `state: 'PENDING'` → trace status `BATCH_SUBMITTED` (`node-execution-coordinator.ts` → `executeNodeOnce()`).
2. Scheduler sets `paused`, does **not** promote children (`scheduler.ts:279-283`); `canLaunch` blocks new launches; in-flight nodes drain.
3. Coordinator calls `pauseFlowForBatch` → run status `PAUSED_FOR_BATCH`; heartbeat stopped.
4. The batch poller later calls `resumeFromBatchCompletion` (`resumeFromBatchCompletion`) → `continueFlowRunFromBatch` (`continueFlowRunFromBatch`).

Resume **reconstructs state from persisted traces**: `nodeOutputs` re-populated, `alreadyComplete = new Set(nodeOutputs.keys())`, and skips **replayed** through `handleBranchSkipping` (the resume path).

The consequence: **resume correctness depends entirely on trace persistence.** Under `persistence: 'per-run'` the buffer is in-memory and flushed at the end — so anything that pauses mid-run and resumes in a *different isolate* must be on `per-node`. This is why `executePendingRun` force-flips manual runs to per-node, and it's the sharp edge for Workers/Workflows hosts where every step is a fresh isolate.

---

## Cancellation

`abortRun(flowRunId, reason)` (`abortRun`) looks up a per-run `AbortController`, aborts it, and returns whether it found one. **The map is per-process.** In a multi-isolate or multi-worker host, cancelling a run scheduled elsewhere silently no-ops (returns false); `cancelExecution` still writes CANCELLED to the row.

The signal reaches actions as `context.abortSignal` (`node-execution-coordinator.ts:686`) and gates `canLaunch` (`scheduler.ts:181`). In-flight nodes are never force-killed — an action that ignores the signal runs to completion. And see the mapper caveat above.

## Heartbeats

One `setInterval` per in-flight run (`heartbeatTimers`), started in `markExecutionRunning` (`markExecutionRunning`), stopped on every terminal path. Feeds the **stale-run detector** — a run whose heartbeat goes cold is reaped as a dead process.

`heartbeatIntervalMs` is the one option with a full config path: `schemas/flowlib-config.ts:103` (default 30s) → `service-factory.ts:230` → `flow-orchestration.service.ts:117`. Set `0` to disable — correct for hosts where durability is external (Cloudflare/Vercel Workflows), since the interval is meaningless when each step is a fresh isolate.

---

## Known gaps and stale claims

Things a newcomer will trip on. Each is real as of this doc's date.

| Gap | Where |
| --- | --- |
| **`validateEdgeHandles` is a no-op that always returns valid** (`validateEdgeHandles`), so the handle-validation logging at `prepareNodeInputs` is dead code. | `node-execution-coordinator.ts` |
| **`prepareNodeInputs`' handle-keyed map is a fallback only** — used as trace `inputs` only when `incomingData` is empty. | `node-execution-coordinator.ts` → `prepareNodeInputs()` |
| **`collectFlowOutputs` ignores its `definition` arg** (`_definition`) — returns every node's output, not designated outputs. | `flow-run-coordinator.ts` |
| **Resolved params are not persisted.** Needs a new `actionTraces` column → migration across all three dialects plus hosted. Not yet done. | `pkg/db/src/core-schema.ts:142` |
| **No continue-on-fail, no error branch, no orchestrator-level retry.** `retryCount` exists on the trace model but nodes are never retried; the only retries are inside `core.agent`. | `scheduler.ts:27` |
| **`failureMode: 'drain'` / `batchPolicy: 'drain-then-pause'` are typed but unimplemented.** | `scheduler.ts:7-8` |
| **`schedulerConcurrency` is a dep nothing passes** — concurrency is effectively fixed at 8. Wire it through `FlowlibConfig` if it should be user-facing. | `flow-run-coordinator.ts` |
| **The mapper's parallel windows are fixed, not rolling** — a slow item stalls its whole window. | `node-execution-coordinator.ts` |

### Fixed on 2026-07-17

- ~~The legacy sequential loop is maintained-but-dead in three places~~ — **deleted**. `executeFlowDefinition`, `continueFlowRunFromBatch` and `executeFlowToNode` now go straight to `runSchedulerLoop`; `isParallelEnabled()` and the `parallelSchedulerEnabled` dep are gone. The file went 1372 → 1055 lines. Note the deletion surfaced the cycle-guard subtlety above.
- ~~The mapper ignores the abort signal~~ — **fixed**. The signal is threaded through `executeNodeWithMapper` → `executeNodeMapperIterating` → `executeSingleMapperIteration` → `executeNodeOnce`, and the loop stops launching new items/windows once aborted, failing the parent trace with a `<done>/<total>` count. Regression tests in `tests/unit/orchestration/node-execution-coordinator.test.ts`.
- ~~`CLAUDE.md` teaches the sequential model~~ — **corrected**, and now points here.

### Suggested cleanups, roughly by value

1. **Persist resolved params on the trace.** The single most common debugging question the trace can't answer. Costs a schema migration — see the gaps table.
2. **Give the scheduler its own cycle detection** and retire the `topologicalSort` guard in the same change. Right now a correctness-critical check is disguised as a debug log.
3. **Make the mapper's windows rolling** rather than fixed.

---

## Where to look first

- `scheduler.ts` — 350 lines, read top to bottom. The class comment at `:60-83` is accurate and the best entry point to the whole subsystem.
- `flow-run-coordinator.ts` → `runSchedulerLoop()` — `runSchedulerLoop`. The seam between graph walk and scheduler, including the `executeNode` closure and every scheduler option.
- `node-execution-coordinator.ts:124-207` — the `buildIncomingDataObject` contract. Explains what a node actually sees.
- `flow-run-coordinator.ts` → `handleBranchSkipping()` — `handleBranchSkipping`. Small, subtle, and load-bearing for both branching *and* resume.
