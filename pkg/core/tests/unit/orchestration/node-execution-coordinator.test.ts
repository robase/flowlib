/**
 * Unit tests: NodeExecutionCoordinator
 *
 * Covers the pure data-transformation methods that don't require DB or AI:
 *   - buildIncomingDataObject  (slug-keyed upstream output aggregation)
 *   - prepareNodeInputs        (edge-based input mapping)
 *   - resolveTemplateParams    ({{ }} template resolution)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeExecutionCoordinator } from 'src/services/flow-orchestration/node-execution-coordinator';
import type { FlowNodeDefinitions, FlowEdge } from 'src/services/flow-versions/schemas-fresh';
import type { NodeOutput } from 'src/types/node-io-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(
  id: string,
  opts: { type?: string; label?: string; referenceId?: string } = {},
): FlowNodeDefinitions {
  return { id, type: opts.type ?? 'core.test', params: {}, ...opts };
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): FlowEdge {
  return {
    id,
    source,
    target,
    ...(sourceHandle !== undefined && { sourceHandle }),
    ...(targetHandle !== undefined && { targetHandle }),
  };
}

function outputWithValue(nodeType: string, value: unknown): NodeOutput {
  return {
    nodeType,
    data: {
      variables: {
        output: { value, type: typeof value === 'object' && value !== null ? 'object' : 'string' },
      },
    },
  };
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeCoordinator(): NodeExecutionCoordinator {
  return new NodeExecutionCoordinator({
    logger: mockLogger,
    nodeExecutionService: {} as never,
    nodeDataService: {} as never,
    graphService: {} as never,
    baseAIClient: {} as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildIncomingDataObject
// ---------------------------------------------------------------------------

describe('NodeExecutionCoordinator.buildIncomingDataObject', () => {
  it('returns empty object when node has no incoming edges', () => {
    const coordinator = makeCoordinator();
    const result = coordinator.buildIncomingDataObject(node('target'), new Map(), [], new Map());
    expect(result).toEqual({});
  });

  it('keys output by the source node label slug', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { label: 'Fetch User' });
    const targetNode = node('tgt-1');
    const nodeOutputs = new Map([['src-1', outputWithValue('core.test', { id: 42 })]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([
      ['src-1', sourceNode],
      ['tgt-1', targetNode],
    ]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    // "Fetch User" → "fetch_user"
    expect(result['fetch_user']).toEqual({ id: 42 });
  });

  it('uses referenceId over generated slug when available', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { label: 'Some Label', referenceId: 'my_ref' });
    const targetNode = node('tgt-1');
    const nodeOutputs = new Map([['src-1', outputWithValue('core.test', 'hello')]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([
      ['src-1', sourceNode],
      ['tgt-1', targetNode],
    ]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['my_ref']).toBe('hello');
    expect(result['some_label']).toBeUndefined();
  });

  it('extracts the .value field from the output variable', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { referenceId: 'upstream' });
    const targetNode = node('tgt-1');
    const output: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { output: { value: 'extracted-value', type: 'string' } } },
    };
    const nodeOutputs = new Map([['src-1', output]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([['src-1', sourceNode]]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['upstream']).toBe('extracted-value');
  });

  it('JSON-parses a string output value that is a valid object', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { referenceId: 'upstream' });
    const targetNode = node('tgt-1');
    const output: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { output: { value: '{"key":"value"}', type: 'string' } } },
    };
    const nodeOutputs = new Map([['src-1', output]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([['src-1', sourceNode]]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['upstream']).toEqual({ key: 'value' });
  });

  it('falls back to first variable when no "output" key exists', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { referenceId: 'upstream' });
    const targetNode = node('tgt-1');
    const output: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { result: { value: 'first-var', type: 'string' } } },
    };
    const nodeOutputs = new Map([['src-1', output]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([['src-1', sourceNode]]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['upstream']).toBe('first-var');
  });

  it('returns null for a source node with no output', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { referenceId: 'upstream' });
    const targetNode = node('tgt-1');
    const nodeOutputs = new Map<string, NodeOutput | undefined>([['src-1', undefined]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([['src-1', sourceNode]]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['upstream']).toBeNull();
  });

  it('collects indirect ancestors under previous_nodes', () => {
    // Grandparent → Parent → Target
    // Parent is direct; Grandparent is indirect
    const coordinator = makeCoordinator();
    const grandparent = node('gp-1', { referenceId: 'grand' });
    const parent = node('p-1', { referenceId: 'parent' });
    const target = node('tgt-1');
    const nodeOutputs = new Map([
      ['gp-1', outputWithValue('core.test', 'gp-value')],
      ['p-1', outputWithValue('core.test', 'p-value')],
    ]);
    const edges = [edge('e1', 'gp-1', 'p-1'), edge('e2', 'p-1', 'tgt-1')];
    const nodeMap = new Map([
      ['gp-1', grandparent],
      ['p-1', parent],
      ['tgt-1', target],
    ]);

    const result = coordinator.buildIncomingDataObject(target, nodeOutputs, edges, nodeMap);

    expect(result['parent']).toBe('p-value');
    expect((result['previous_nodes'] as Record<string, unknown>)['grand']).toBe('gp-value');
  });

  it('does not include previous_nodes when there are no indirect ancestors', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1', { referenceId: 'upstream' });
    const targetNode = node('tgt-1');
    const nodeOutputs = new Map([['src-1', outputWithValue('core.test', 'val')]]);
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([['src-1', sourceNode]]);

    const result = coordinator.buildIncomingDataObject(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['previous_nodes']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prepareNodeInputs
// ---------------------------------------------------------------------------

describe('NodeExecutionCoordinator.prepareNodeInputs', () => {
  it('returns empty object when node has no incoming edges', () => {
    const coordinator = makeCoordinator();
    const result = coordinator.prepareNodeInputs(node('tgt'), new Map(), [], new Map());
    expect(result).toEqual({});
  });

  it('maps source output to targetHandle key', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1');
    const targetNode = node('tgt-1');
    const output: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { myOutput: { value: 'result', type: 'string' } } },
    };
    const nodeOutputs = new Map([['src-1', output]]);
    const edges = [edge('e1', 'src-1', 'tgt-1', 'myOutput', 'inputData')];
    const nodeMap = new Map([
      ['src-1', sourceNode],
      ['tgt-1', targetNode],
    ]);

    const result = coordinator.prepareNodeInputs(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['inputData']).toBe('result');
  });

  it('defaults to "input" for targetHandle and "output" for sourceHandle', () => {
    const coordinator = makeCoordinator();
    const sourceNode = node('src-1');
    const targetNode = node('tgt-1');
    const output: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { output: { value: 'default-output', type: 'string' } } },
    };
    const nodeOutputs = new Map([['src-1', output]]);
    // No sourceHandle / targetHandle specified
    const edges = [edge('e1', 'src-1', 'tgt-1')];
    const nodeMap = new Map([
      ['src-1', sourceNode],
      ['tgt-1', targetNode],
    ]);

    const result = coordinator.prepareNodeInputs(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['input']).toBe('default-output');
  });

  it('returns empty and warns when source has no output at all', () => {
    const coordinator = makeCoordinator();
    const targetNode = node('tgt-1');
    const nodeOutputs = new Map<string, NodeOutput | undefined>();
    const edges = [edge('e1', 'src-1', 'tgt-1', 'output', 'input')];
    const nodeMap = new Map<string, FlowNodeDefinitions>();

    const result = coordinator.prepareNodeInputs(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['input']).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('aggregates multiple incoming edges into separate input keys', () => {
    const coordinator = makeCoordinator();
    const srcA = node('src-a');
    const srcB = node('src-b');
    const targetNode = node('tgt-1');
    const outputA: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { output: { value: 'from-a', type: 'string' } } },
    };
    const outputB: NodeOutput = {
      nodeType: 'core.test',
      data: { variables: { output: { value: 'from-b', type: 'string' } } },
    };
    const nodeOutputs = new Map([
      ['src-a', outputA],
      ['src-b', outputB],
    ]);
    const edges = [
      edge('e1', 'src-a', 'tgt-1', 'output', 'inputA'),
      edge('e2', 'src-b', 'tgt-1', 'output', 'inputB'),
    ];
    const nodeMap = new Map([
      ['src-a', srcA],
      ['src-b', srcB],
      ['tgt-1', targetNode],
    ]);

    const result = coordinator.prepareNodeInputs(targetNode, nodeOutputs, edges, nodeMap);

    expect(result['inputA']).toBe('from-a');
    expect(result['inputB']).toBe('from-b');
  });
});

// ---------------------------------------------------------------------------
// resolveTemplateParams
// ---------------------------------------------------------------------------

describe('NodeExecutionCoordinator.resolveTemplateParams', () => {
  it('leaves non-template strings unchanged', async () => {
    const mockJsService = { evaluate: vi.fn() };
    const coordinator = new NodeExecutionCoordinator({
      logger: mockLogger,
      nodeExecutionService: {} as never,
      nodeDataService: {} as never,
      graphService: {} as never,
      baseAIClient: {} as never,
      jsExpressionService: mockJsService as never,
    });

    const result = await coordinator.resolveTemplateParams({ name: 'Alice', count: 5 }, {});

    expect(result['name']).toBe('Alice');
    expect(result['count']).toBe(5);
    expect(mockJsService.evaluate).not.toHaveBeenCalled();
  });

  it('skips keys in the skipKeys list', async () => {
    const mockTemplateService = {
      isTemplate: vi.fn().mockReturnValue(true),
      render: vi.fn().mockResolvedValue('rendered'),
    };
    const coordinator = new NodeExecutionCoordinator({
      logger: mockLogger,
      nodeExecutionService: {} as never,
      nodeDataService: {} as never,
      graphService: {} as never,
      baseAIClient: {} as never,
      templateService: mockTemplateService as never,
    });

    const result = await coordinator.resolveTemplateParams(
      { template: '{{ upstream.value }}', other: '{{ upstream.value }}' },
      { upstream: { value: 'hello' } },
      ['template'],
    );

    expect(result['template']).toBe('{{ upstream.value }}'); // skipped
    expect(result['other']).toBe('rendered'); // resolved
  });

  it('keeps original value and warns on render failure', async () => {
    const mockTemplateService = {
      isTemplate: vi.fn().mockReturnValue(true),
      render: vi.fn().mockRejectedValue(new Error('render failed')),
    };
    const coordinator = new NodeExecutionCoordinator({
      logger: mockLogger,
      nodeExecutionService: {} as never,
      nodeDataService: {} as never,
      graphService: {} as never,
      baseAIClient: {} as never,
      templateService: mockTemplateService as never,
    });

    const result = await coordinator.resolveTemplateParams({ param: '{{ broken }}' }, {});

    expect(result['param']).toBe('{{ broken }}');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to resolve template param',
      expect.objectContaining({ param: 'param' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Mapper iteration — cancellation
//
// Regression: executeNodeWithMapper used to accept `_abortSignal` and drop it,
// so a cancelled run ground through every remaining item and could not
// interrupt an in-flight iteration.
// ---------------------------------------------------------------------------

describe('NodeExecutionCoordinator mapper iteration — cancellation', () => {
  interface TraceStub {
    id: string;
    status?: string;
    error?: string;
  }

  function makeMapperCoordinator(): {
    coordinator: NodeExecutionCoordinator;
    trace: TraceStub;
    updateStatus: ReturnType<typeof vi.fn>;
  } {
    const trace: TraceStub = { id: 'trace-1' };
    const updateStatus = vi.fn((_id: string, status: string, patch?: { error?: string }) => {
      trace.status = status;
      trace.error = patch?.error;
      return Promise.resolve(trace);
    });
    const nodeExecutionService = {
      createNodeExecution: vi.fn().mockResolvedValue(trace),
      updateNodeExecutionStatus: updateStatus,
    };
    const coordinator = new NodeExecutionCoordinator({
      logger: mockLogger,
      nodeExecutionService: nodeExecutionService as never,
      nodeDataService: {} as never,
      graphService: {} as never,
      baseAIClient: {} as never,
    });
    return { coordinator, trace, updateStatus };
  }

  /** Invoke the private iterating method with a stubbed per-item executor. */
  async function runIterating(
    coordinator: NodeExecutionCoordinator,
    items: unknown[],
    mapperConfig: Record<string, unknown>,
    signal: AbortSignal,
    onItem: () => void = () => {},
  ): Promise<{ iterations: number }> {
    let iterations = 0;
    // Replace the per-item executor: we're testing the loop, not node dispatch.
    (
      coordinator as unknown as {
        executeSingleMapperIteration: (...a: unknown[]) => Promise<unknown>;
      }
    ).executeSingleMapperIteration = async () => {
      iterations++;
      onItem();
      return 'ok';
    };
    await (
      coordinator as unknown as {
        executeNodeMapperIterating: (...a: unknown[]) => Promise<unknown>;
      }
    ).executeNodeMapperIterating(
      'run-1',
      node('n1'),
      {},
      {},
      undefined,
      undefined,
      undefined,
      {},
      items,
      mapperConfig,
      signal,
    );
    return { iterations };
  }

  it('runs no iterations when the signal is already aborted', async () => {
    const { coordinator, trace } = makeMapperCoordinator();
    const ctrl = new AbortController();
    ctrl.abort(new Error('cancelled by user'));

    const { iterations } = await runIterating(
      coordinator,
      [1, 2, 3],
      { expression: 'x' },
      ctrl.signal,
    );

    expect(iterations).toBe(0);
    expect(trace.status).toBe('FAILED');
    expect(trace.error).toContain('cancelled');
    expect(trace.error).toContain('cancelled by user');
  });

  it('stops launching new sequential iterations once aborted mid-run', async () => {
    const { coordinator, trace } = makeMapperCoordinator();
    const ctrl = new AbortController();

    // Abort partway through the array.
    let seen = 0;
    const { iterations } = await runIterating(
      coordinator,
      [1, 2, 3, 4, 5, 6],
      { expression: 'x', concurrency: 1 },
      ctrl.signal,
      () => {
        seen++;
        if (seen === 2) {
          ctrl.abort(new Error('cancelled by user'));
        }
      },
    );

    // Two ran; the abort stops the rest rather than grinding through all six.
    expect(iterations).toBe(2);
    expect(trace.status).toBe('FAILED');
    expect(trace.error).toContain('2/6');
  });

  it('stops launching new parallel windows once aborted', async () => {
    const { coordinator, trace } = makeMapperCoordinator();
    const ctrl = new AbortController();

    let seen = 0;
    const { iterations } = await runIterating(
      coordinator,
      [1, 2, 3, 4, 5, 6],
      { expression: 'x', concurrency: 2 },
      ctrl.signal,
      () => {
        seen++;
        if (seen === 2) {
          ctrl.abort(new Error('cancelled by user'));
        }
      },
    );

    // The first window of 2 completes; the next window is never launched.
    expect(iterations).toBe(2);
    expect(trace.status).toBe('FAILED');
    expect(trace.error).toContain('2/6');
  });

  it('runs every item to completion when never aborted', async () => {
    const { coordinator, trace } = makeMapperCoordinator();
    const ctrl = new AbortController();

    const { iterations } = await runIterating(
      coordinator,
      [1, 2, 3, 4],
      { expression: 'x', concurrency: 1 },
      ctrl.signal,
    );

    expect(iterations).toBe(4);
    expect(trace.status).toBe('SUCCESS');
  });
});
