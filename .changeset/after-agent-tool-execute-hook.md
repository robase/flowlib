---
'@flowlib/core': minor
---

# New plugin hook: `afterAgentToolExecute`

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
