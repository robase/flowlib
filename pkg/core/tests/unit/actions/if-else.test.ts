/**
 * Unit tests: core.if_else action — JS expression evaluation
 */
import { describe, it, expect, vi } from 'vitest';
import { ifElseAction } from '@flowlib/actions';

const evaluator = {
  evaluate: async (expression: string, data: Record<string, unknown>): Promise<unknown> => {
    const keys = Object.keys(data);
    const values = Object.values(data);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return (${expression})`);
    return fn(...values);
  },
};

function makeContext(incomingData: Record<string, unknown> = {}) {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    incomingData,
    credential: null,
    flowInputs: {},
    flowContext: { nodeId: 'if-1', flowRunId: 'run-1' },
    functions: { evaluator },
    flowRunState: undefined,
  } as unknown as Parameters<typeof ifElseAction.execute>[1];
}

describe('core.if_else action', () => {
  it('should evaluate JS expression to true and populate true_output', async () => {
    const result = await ifElseAction.execute(
      { expression: 'age >= 18' },
      makeContext({ age: 25 }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.true_output).toBeDefined();
    expect(result.outputVariables!.false_output).toBeUndefined();
    expect(result.metadata?.conditionResult).toBe(true);
    expect(result.metadata?.branchTaken).toBe('true_branch');
  });

  it('should evaluate JS expression to false and populate false_output', async () => {
    const result = await ifElseAction.execute(
      { expression: 'age >= 18' },
      makeContext({ age: 10 }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.false_output).toBeDefined();
    expect(result.outputVariables!.true_output).toBeUndefined();
    expect(result.metadata?.conditionResult).toBe(false);
    expect(result.metadata?.branchTaken).toBe('false_branch');
  });

  it('should handle JS expression errors gracefully (defaults to false)', async () => {
    const result = await ifElseAction.execute(
      { expression: 'nonexistent.property.deep' },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.false_output).toBeDefined();
    expect(result.metadata?.evaluationError).toBeDefined();
  });

  it('should passthrough incoming data as output', async () => {
    const data = { user: 'Alice', score: 99 };
    const result = await ifElseAction.execute({ expression: 'score > 50' }, makeContext(data));

    expect(result.success).toBe(true);
    const outputValue = result.outputVariables!.true_output!.value;
    expect(JSON.parse(outputValue as string)).toEqual(data);
  });

  it('should not call markDownstreamNodesAsSkipped', async () => {
    const markFn = vi.fn();
    const ctx = makeContext({ value: 10 });
    (ctx as unknown as Record<string, unknown>).flowRunState = {
      edges: [{ id: 'e1', source: 'if-1', target: 'other', sourceHandle: 'false_output' }],
      skippedNodeIds: new Set(),
    };
    (ctx as unknown as Record<string, unknown>).functions = {
      evaluator,
      markDownstreamNodesAsSkipped: markFn,
    };

    await ifElseAction.execute({ expression: 'true' }, ctx);

    // The action should NOT call mark — the coordinator handles it now
    expect(markFn).not.toHaveBeenCalled();
  });
});
