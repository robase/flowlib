# @flowlib/core

## 0.0.7

### Patch Changes

- [#14](https://github.com/robase/flowlib/pull/14) [`d5a16b3`](https://github.com/robase/flowlib/commit/d5a16b33924cb7c7d1c5d12190930e312e4a7b35) Thanks [@robase](https://github.com/robase)! - # New plugin hook: `afterAgentToolExecute`

  Fires once per individual tool invocation inside a `core.agent` loop, alongside the existing aggregate `afterAgentExecute`. Use it when the host needs to react to each tool call as it lands rather than waiting for the whole agent loop to finish — progress indicators, per-call telemetry, fail-fast policies on repeated tool errors, etc.

  ```ts
  const telemetryPlugin: FlowlibPluginDefinition = {
    id: 'agent-telemetry',
    backend: {
      id: 'agent-telemetry',
      hooks: {
        afterAgentToolExecute: async (ctx) => {
          recordEvent({
            metric: 'agent_tool_call',
            tool: ctx.toolName,
            ok: ctx.success,
            flowRunId: ctx.flowRunId,
            nodeId: ctx.nodeId,
            durationMs: ctx.durationMs,
          });
        },
      },
    },
  };
  ```

  ## Why a separate hook?

  `afterAgentExecute` already exists for loop-aggregate signals, but it only fires once the agent loop returns. For long-running agents that make many tool calls, that means downstream observers see nothing until the loop finishes. `afterAgentToolExecute` fires synchronously after each tool's DB record is written, so per-call observers can react in real time.

  ## Context shape

  ```ts
  {
    flowRunId: string;
    flowId: string;
    nodeId: string;       // The parent core.agent node
    toolId: string;       // Configured agent-tool instance id
    toolName: string;     // Display name (configured override or registered name)
    iteration: number;    // Iteration within the agent loop (1-indexed)
    success: boolean;     // Whether the tool returned a successful result
    error?: string;       // Error message if the tool failed (timeout, action error, etc.)
    durationMs: number;   // Wall-clock duration of the tool call
  }
  ```

  Hook errors are caught and logged at warn level; they never interrupt the agent loop.

  ## Wire-up

  The hook fires from `node-execution-coordinator.ts` inside the existing `recordToolExecution` callback that the `core.agent` action invokes per tool. No agent-action changes were required, and no new fields were added to the existing tool-execution record schema. Plugins that don't declare the hook see no behaviour change.

- Updated dependencies []:
  - @flowlib/action-kit@0.0.7
  - @flowlib/actions@0.0.7
  - @flowlib/db@0.0.7
  - @flowlib/layouts@0.0.7
  - @flowlib/sdk@0.0.7

## 0.0.6

### Patch Changes

- [#12](https://github.com/robase/flowlib/pull/12) [`8c079ae`](https://github.com/robase/flowlib/commit/8c079aeb68ef33409c96d6db762aed5715a39399) Thanks [@robase](https://github.com/robase)! - # Deprecate the legacy `Flowlib` class — use `createFlowlib()` instead

  The `Flowlib` class in `@flowlib/core` is now marked `@deprecated`. It will continue to work for the foreseeable future (no removal date set), but new code should use `createFlowlib()`:

  ```diff
  - import { Flowlib } from '@flowlib/core';
  + import { createFlowlib } from '@flowlib/core';

  - const flowlib = new Flowlib(config);
  - await flowlib.initialize();
  + const flowlib = await createFlowlib(config);

  - const flow = await flowlib.createFlow({ name: 'My Flow' });
  - const flows = await flowlib.listFlows();
  + const flow = await flowlib.flows.create({ name: 'My Flow' });
  + const flows = await flowlib.flows.list();
  ```

  ## Why

  The legacy class shipped a flat method surface (`flowlib.createFlow()`, `flowlib.listFlows()`, `flowlib.startFlowRun()`, …) that grew to ~50+ methods on a single object. The modern factory groups them into namespaced sub-APIs (`flowlib.flows.*`, `flowlib.runs.*`, `flowlib.credentials.*`, `flowlib.chat.*`, `flowlib.triggers.*`, etc.) so the surface is discoverable without scrolling.

  The factory also collapses the two-phase `new Flowlib(config)` → `await initialize()` lifecycle into a single awaitable construction step, removing the "did I forget to call initialize?" footgun.

  ## Status of consumers

  All three framework adapters (`@flowlib/express`, `@flowlib/nestjs`, `@flowlib/nextjs`) already use `createFlowlib()`. The only first-party consumers still on the legacy class are:
  - `examples/express-drizzle/seed/run-seed.ts` — example seed script
  - Plugin docs/JSDoc that reference it for back-compat

  If you're building a new app, use `createFlowlib()`. If you have an existing app on the legacy class, no immediate action is needed — the class will keep working until a future major release announces a removal date.

- Updated dependencies []:
  - @flowlib/action-kit@0.0.6
  - @flowlib/actions@0.0.6
  - @flowlib/db@0.0.6
  - @flowlib/layouts@0.0.6
  - @flowlib/sdk@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [[`7d4db0c`](https://github.com/robase/flowlib/commit/7d4db0c537d77410bc76d968a1ecd7da672da5c8)]:
  - @flowlib/db@0.0.5
  - @flowlib/action-kit@0.0.5
  - @flowlib/actions@0.0.5
  - @flowlib/layouts@0.0.5
  - @flowlib/sdk@0.0.5

## 0.0.4

### Patch Changes

- version control overhaul

- Updated dependencies []:
  - @flowlib/action-kit@0.0.4
  - @flowlib/actions@0.0.4
  - @flowlib/layouts@0.0.4
  - @flowlib/sdk@0.0.4

## 0.0.3

### Patch Changes

- [#7](https://github.com/robase/flowlib/pull/7) [`4dee9d6`](https://github.com/robase/flowlib/commit/4dee9d67222426ee5ce16ab1c8a87f1b33144870) Thanks [@robase](https://github.com/robase)! - fix: ci test ([#7](https://github.com/robase/flowlib/issues/7))

- Updated dependencies []:
  - @flowlib/action-kit@0.0.3
  - @flowlib/actions@0.0.3
  - @flowlib/layouts@0.0.3
  - @flowlib/sdk@0.0.3

## 0.0.2

### Patch Changes

- [`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe) Thanks [@robase](https://github.com/robase)! - welcome flowlib!

- Updated dependencies [[`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe)]:
  - @flowlib/action-kit@0.0.2
  - @flowlib/actions@0.0.2
  - @flowlib/layouts@0.0.2
  - @flowlib/sdk@0.0.2

## 0.0.12

### Patch Changes

- Pre release

- Updated dependencies []:
  - @flowlib/action-kit@0.0.2
  - @flowlib/actions@0.0.2
  - @flowlib/layouts@0.0.12
  - @flowlib/sdk@0.0.2

## 0.0.11

### Patch Changes

- debug nextjs

- Updated dependencies []:
  - @flowlib/layouts@0.0.11

## 0.0.10

### Patch Changes

- fix db tables

- Updated dependencies []:
  - @flowlib/layouts@0.0.10

## 0.0.9

### Patch Changes

- audit packages

- Updated dependencies []:
  - @flowlib/layouts@0.0.9

## 0.0.8

### Patch Changes

- fix frontend api

- Updated dependencies []:
  - @flowlib/layouts@0.0.8

## 0.0.7

### Patch Changes

- fix dynamic imports

- Updated dependencies []:
  - @flowlib/layouts@0.0.7

## 0.0.6

### Patch Changes

- secure-exec -> quickjs revert

- Updated dependencies []:
  - @flowlib/layouts@0.0.6

## 0.0.5

### Patch Changes

-

- Updated dependencies []:
  - @flowlib/layouts@0.0.5

## 0.0.4

### Patch Changes

- fix: nextjs imports

- Updated dependencies []:
  - @flowlib/layouts@0.0.4

## 0.0.3

### Patch Changes

- fix core exports issue

- Updated dependencies []:
  - @flowlib/layouts@0.0.3

## 0.0.2

### Patch Changes

- fix cli commands, replace quickjs wasm with secure-exec

- Updated dependencies []:
  - @flowlib/layouts@0.0.2
