/**
 * Mapper execution integration tests.
 *
 * These tests exercise the NodeExecutionCoordinator's mapper codepath —
 * evaluating a JS expression, branching on mode (iterate vs reshape vs auto),
 * and packaging results with the configured outputMode.
 *
 * Since the coordinator delegates each iteration to executeNodeOnce() (which
 * in turn needs an action/executor + nodeExecutionService), we mock the
 * global action registry + action executor at the module level.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { JsExpressionService } from '../../../src/services/templating/js-expression.service';
import { NodeExecutionStatus } from '../../../src/types/base';
import type { FlowNodeDefinitions } from '../../../src/services/flow-versions/schemas-fresh';
import type { MapperConfig } from '../../../src/services/flow-versions/schemas-fresh';
import type { BaseAIClient } from '../../../src/services/ai/base-client';
import type { GraphService } from '../../../src/services/graph.service';
import type { NodeDataService } from '../../../src/services/node-data.service';
import type { NodeExecutionService } from '../../../src/services/node-executions/node-execution.service';

// ── Module-level mocks (must come before import of coordinator) ──────────────

const mockActionExecute = vi.fn(async () => ({
  state: NodeExecutionStatus.SUCCESS,
  output: {
    nodeType: 'core.test_action',
    data: { variables: { output: { value: { result: 'ok' }, type: 'object' } } },
  },
}));

vi.mock('@flowlib/actions/registry', () => ({
  getGlobalActionRegistry: () => ({
    get: () => ({
      id: 'core.test_action',
      name: 'Test Action',
      params: { schema: { parse: (v: unknown) => v }, fields: [] },
      execute: mockActionExecute,
    }),
  }),
}));

vi.mock('@flowlib/actions', () => ({
  executeActionAsNode: async () => {
    // Delegate to trackable mock
    return mockActionExecute();
  },
}));

// Now import the coordinator (it picks up our mocks)
import { NodeExecutionCoordinator } from '../../../src/services/flow-orchestration/node-execution-coordinator';
import type { NodeExecutionCoordinatorDeps } from '../../../src/services/flow-orchestration/node-execution-coordinator';

// ── Shared QuickJS instance (expensive to init, reuse across tests) ──────────

let jsService: JsExpressionService;

beforeAll(async () => {
  jsService = new JsExpressionService();
  await jsService.initialize();
});

afterAll(() => {
  jsService.dispose();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockNodeExecutionService() {
  let traceCounter = 0;
  return {
    createNodeExecution: vi.fn(
      async (_flowRunId: string, nodeId: string, nodeType: string, inputs: unknown) => ({
        id: `trace-${++traceCounter}`,
        nodeId,
        nodeType,
        inputs,
        status: NodeExecutionStatus.RUNNING,
        outputs: null,
      }),
    ),
    updateNodeExecutionStatus: vi.fn(
      async (traceId: string, status: string, extra?: { outputs?: unknown; error?: string }) => ({
        id: traceId,
        status,
        outputs: extra?.outputs ?? null,
        error: extra?.error ?? null,
      }),
    ),
  };
}

function buildCoordinator() {
  const logger = createMockLogger();
  const nodeExecutionService = createMockNodeExecutionService();

  const deps: NodeExecutionCoordinatorDeps = {
    logger,
    nodeExecutionService: nodeExecutionService as unknown as NodeExecutionService,
    nodeDataService: {} as NodeDataService,
    graphService: {} as GraphService,
    jsExpressionService: jsService,
    baseAIClient: {} as BaseAIClient,
  };

  const coordinator = new NodeExecutionCoordinator(deps);

  return { coordinator, logger, nodeExecutionService };
}

function makeNode(mapper?: MapperConfig): FlowNodeDefinitions {
  return {
    id: 'node-1',
    type: 'core.test_action',
    label: 'Test Node',
    params: { query: '{{ name }}' },
    mapper,
  } as FlowNodeDefinitions;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Mapper — JS Expression Evaluation', () => {
  it('no mapper → executeNodeOnce (passthrough)', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode(undefined);
    const incomingData = { upstream: { name: 'alice' } };

    await coordinator.executeNode(
      'run-1',
      node,
      {},
      {},
      undefined,
      undefined,
      undefined,
      incomingData,
    );

    // Should only create a single trace (no mapper iteration)
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(1);
  });

  it('mapper disabled → executeNodeOnce (passthrough)', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: false,
      expression: 'upstream.items',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });
    const incomingData = { upstream: { items: [1, 2, 3] } };

    await coordinator.executeNode(
      'run-1',
      node,
      {},
      {},
      undefined,
      undefined,
      undefined,
      incomingData,
    );

    // mapper disabled → no iteration
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(1);
  });

  it('mapper returns array with auto mode → iterates', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'items',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: ['a', 'b', 'c'],
    });

    // Parent trace + 3 iteration traces = 4
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(4);
  });

  it('mapper returns object with auto mode → single execution', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'return { total: items.length }',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: ['a', 'b', 'c'],
    });

    // Single execution only
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(1);
  });
});

describe('Mapper — Mode Enforcement', () => {
  it('iterate mode + non-array result → fails', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'return { total: items.length }',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: ['a', 'b', 'c'],
    });

    // Should fail with a descriptive error
    expect(nodeExecutionService.updateNodeExecutionStatus).toHaveBeenCalledWith(
      expect.any(String),
      NodeExecutionStatus.FAILED,
      expect.objectContaining({ error: expect.stringContaining('iterate') }),
    );
  });

  it('reshape mode + array result → wraps in { items: [...] }', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'items',
      mode: 'reshape',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: ['a', 'b', 'c'],
    });

    // Should execute once (reshape wraps array in object)
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(1);
  });
});

describe('Mapper — Empty Array Handling', () => {
  it('onEmpty: skip → success with empty output', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'items',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: [],
    });

    expect(nodeExecutionService.updateNodeExecutionStatus).toHaveBeenCalledWith(
      expect.any(String),
      NodeExecutionStatus.SUCCESS,
      expect.anything(),
    );
  });

  it('onEmpty: error → fails', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'items',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'error',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: [],
    });

    expect(nodeExecutionService.updateNodeExecutionStatus).toHaveBeenCalledWith(
      expect.any(String),
      NodeExecutionStatus.FAILED,
      expect.objectContaining({ error: expect.stringContaining('empty') }),
    );
  });
});

describe('Mapper — Expression Errors', () => {
  it('syntax error in expression → fails with clear message', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'const x = ;',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      items: [1],
    });

    expect(nodeExecutionService.updateNodeExecutionStatus).toHaveBeenCalledWith(
      expect.any(String),
      NodeExecutionStatus.FAILED,
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('runtime error in expression → fails', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'nonexistent.foo.bar',
      mode: 'auto',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {});

    expect(nodeExecutionService.updateNodeExecutionStatus).toHaveBeenCalledWith(
      expect.any(String),
      NodeExecutionStatus.FAILED,
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

describe('Mapper — Practical Patterns', () => {
  it('filter: users.filter(u => u.active) → iterates active only', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'users.filter(u => u.active)',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      users: [
        { name: 'alice', active: true },
        { name: 'bob', active: false },
        { name: 'carol', active: true },
      ],
    });

    // 2 active users → parent trace + 2 iteration traces = 3
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(3);
  });

  it('aggregate: reduce → single execution', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'return { total: orders.reduce((s, o) => s + o.amount, 0) }',
      mode: 'reshape',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      orders: [{ amount: 50 }, { amount: 100 }],
    });

    // Single execution (reshape)
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(1);
  });

  it('zip: users + scores → iterates pairs', async () => {
    const { coordinator, nodeExecutionService } = buildCoordinator();
    const node = makeNode({
      enabled: true,
      expression: 'users.map((u, i) => ({ ...u, score: scores[i] }))',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 1,
      onEmpty: 'skip',
    });

    await coordinator.executeNode('run-1', node, {}, {}, undefined, undefined, undefined, {
      users: [{ name: 'alice' }, { name: 'bob' }],
      scores: [95, 87],
    });

    // 2 zipped items → parent + 2 iterations = 3
    expect(nodeExecutionService.createNodeExecution).toHaveBeenCalledTimes(3);
  });
});
