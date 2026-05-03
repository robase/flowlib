/**
 * Integration tests: Plugin Hooks
 *
 * Tests that plugin hooks fire correctly during flow execution when wired
 * through the real Flowlib core. Uses lightweight test plugins that record
 * hook invocations so assertions can inspect ordering and side effects.
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type {
  FlowlibPlugin,
  FlowRunHookContext,
  NodeExecutionHookContext,
} from '../../../src/types/plugin.types';
import { createTestFlowlib } from '../helpers/test-flowlib';
import type { FlowlibInstance } from '../../../src/api/types';

/** Simple flow definition used across hook tests */
const simpleFlowDef = {
  nodes: [
    {
      id: 'input-1',
      type: 'trigger.manual' as const,
      label: 'Data',
      referenceId: 'data',
      params: { inputs: [{ name: 'x', type: 'json', defaultValue: '"hello"' }] },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [] as Array<{ id: string; source: string; target: string }>,
};

async function createAndRunFlow(flowlib: FlowlibInstance) {
  const flow = await flowlib.flows.create({ name: `hook-test-${Date.now()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: simpleFlowDef });
  return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
}

// ---------------------------------------------------------------------------
// beforeFlowRun / afterFlowRun
// ---------------------------------------------------------------------------

describe('Plugin Hooks — Flow Run Lifecycle', () => {
  it('should call beforeFlowRun and afterFlowRun hooks', async () => {
    const beforeCalls: FlowRunHookContext[] = [];
    const afterCalls: FlowRunHookContext[] = [];

    const plugin: FlowlibPlugin = {
      id: 'hook-recorder',
      hooks: {
        beforeFlowRun: async (ctx) => {
          beforeCalls.push(ctx);
        },
        afterFlowRun: async (ctx) => {
          afterCalls.push(ctx);
        },
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [plugin] });

    try {
      const result = await createAndRunFlow(flowlib);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(beforeCalls.length).toBe(1);
      expect(afterCalls.length).toBe(1);
      expect(beforeCalls[0].flowId).toBeTruthy();
      expect(afterCalls[0].flowId).toBeTruthy();
    } finally {
      await flowlib.shutdown();
    }
  });

  it('should cancel flow execution when beforeFlowRun returns cancel', async () => {
    const plugin: FlowlibPlugin = {
      id: 'canceller',
      hooks: {
        beforeFlowRun: async () => {
          return { cancel: true, reason: 'blocked by test' };
        },
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [plugin] });

    try {
      const flow = await flowlib.flows.create({ name: `cancel-test-${Date.now()}` });
      await flowlib.versions.create(flow.id, { flowlibDefinition: simpleFlowDef });
      const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

      // Flow should be failed when cancelled by plugin hook
      expect(result.status).toBe(FlowRunStatus.FAILED);
      expect(result.error).toContain('blocked by test');
    } finally {
      await flowlib.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// beforeNodeExecute / afterNodeExecute
// ---------------------------------------------------------------------------

describe('Plugin Hooks — Node Execution Lifecycle', () => {
  it('should call beforeNodeExecute and afterNodeExecute hooks', async () => {
    const beforeCalls: NodeExecutionHookContext[] = [];
    const afterCalls: NodeExecutionHookContext[] = [];

    const plugin: FlowlibPlugin = {
      id: 'node-hook-recorder',
      hooks: {
        beforeNodeExecute: async (ctx) => {
          beforeCalls.push(ctx);
        },
        afterNodeExecute: async (ctx) => {
          afterCalls.push(ctx);
        },
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [plugin] });

    try {
      const result = await createAndRunFlow(flowlib);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      // At least one node should have triggered both hooks
      expect(beforeCalls.length).toBeGreaterThanOrEqual(1);
      expect(afterCalls.length).toBeGreaterThanOrEqual(1);
      expect(beforeCalls[0].nodeId).toBeTruthy();
    } finally {
      await flowlib.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// Hook execution order across multiple plugins
// ---------------------------------------------------------------------------

describe('Plugin Hooks — Ordering', () => {
  it('should execute hooks in plugin registration order', async () => {
    const order: string[] = [];

    const pluginA: FlowlibPlugin = {
      id: 'order-a',
      hooks: {
        beforeFlowRun: async () => {
          order.push('A-before');
        },
        afterFlowRun: async () => {
          order.push('A-after');
        },
      },
    };

    const pluginB: FlowlibPlugin = {
      id: 'order-b',
      hooks: {
        beforeFlowRun: async () => {
          order.push('B-before');
        },
        afterFlowRun: async () => {
          order.push('B-after');
        },
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [pluginA, pluginB] });

    try {
      await createAndRunFlow(flowlib);

      // before hooks should fire in registration order
      expect(order.indexOf('A-before')).toBeLessThan(order.indexOf('B-before'));
      // after hooks should fire in registration order
      expect(order.indexOf('A-after')).toBeLessThan(order.indexOf('B-after'));
    } finally {
      await flowlib.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin init lifecycle
// ---------------------------------------------------------------------------

describe('Plugin Hooks — Init & Shutdown', () => {
  it('should call plugin init during initialize', async () => {
    const initSpy = vi.fn();

    const plugin: FlowlibPlugin = {
      id: 'init-test',
      init: async () => {
        initSpy();
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [plugin] });

    try {
      expect(initSpy).toHaveBeenCalledOnce();
    } finally {
      await flowlib.shutdown();
    }
  });

  it('should call plugin shutdown in reverse order', async () => {
    const order: string[] = [];

    const pluginA: FlowlibPlugin = {
      id: 'shutdown-a',
      shutdown: async () => {
        order.push('A');
      },
    };

    const pluginB: FlowlibPlugin = {
      id: 'shutdown-b',
      shutdown: async () => {
        order.push('B');
      },
    };

    const flowlib = await createTestFlowlib({ plugins: [pluginA, pluginB] });
    await flowlib.shutdown();

    // Shutdown should be reverse order (B before A)
    expect(order).toEqual(['B', 'A']);
  });
});
