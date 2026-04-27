/**
 * Unit tests: core.switch action
 *
 * Tests evaluate against a mock context without a full Flowlib instance.
 */
import { describe, it, expect, vi } from 'vitest';
import { switchAction } from '@flowlib/actions';

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
    flowContext: { nodeId: 'switch-1', flowRunId: 'run-1' },
    functions: { evaluator },
    flowRunState: undefined,
  } as unknown as Parameters<typeof switchAction.execute>[1];
}

describe('core.switch action', () => {
  it('should match the first truthy case', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'high', label: 'High', expression: 'priority === "high"' },
          { slug: 'medium', label: 'Medium', expression: 'priority === "medium"' },
          { slug: 'low', label: 'Low', expression: 'priority === "low"' },
        ],
      },
      makeContext({ priority: 'high' }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables).toBeDefined();
    expect(result.outputVariables!.high).toBeDefined();
    expect(result.outputVariables!.medium).toBeUndefined();
    expect(result.outputVariables!.low).toBeUndefined();
    expect(result.outputVariables!.default).toBeUndefined();
    expect(result.metadata?.matchedSlug).toBe('high');
  });

  it('should match the second case when first is falsy', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'high', label: 'High', expression: 'priority === "high"' },
          { slug: 'medium', label: 'Medium', expression: 'priority === "medium"' },
        ],
      },
      makeContext({ priority: 'medium' }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.medium).toBeDefined();
    expect(result.outputVariables!.high).toBeUndefined();
    expect(result.metadata?.matchedSlug).toBe('medium');
  });

  it('should fall through to default when no case matches', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'high', label: 'High', expression: 'priority === "high"' },
          { slug: 'low', label: 'Low', expression: 'priority === "low"' },
        ],
      },
      makeContext({ priority: 'critical' }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.default).toBeDefined();
    expect(result.outputVariables!.high).toBeUndefined();
    expect(result.outputVariables!.low).toBeUndefined();
    expect(result.metadata?.matchedSlug).toBe('default');
  });

  it('should only match the first truthy case (short-circuit routing)', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'first', label: 'First', expression: 'true' },
          { slug: 'second', label: 'Second', expression: 'true' },
        ],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.first).toBeDefined();
    expect(result.outputVariables!.second).toBeUndefined();
    expect(result.metadata?.matchedSlug).toBe('first');
  });

  it('should passthrough incoming data as output', async () => {
    const data = { user: { name: 'Alice', age: 30 } };
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [{ slug: 'adult', label: 'Adult', expression: 'user.age >= 18' }],
      },
      makeContext(data),
    );

    expect(result.success).toBe(true);
    const outputValue = result.outputVariables!.adult!.value;
    expect(JSON.parse(outputValue as string)).toEqual(data);
  });

  it('should handle expression errors gracefully and continue', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'error_case', label: 'Error', expression: 'nonexistent.property.access' },
          { slug: 'safe', label: 'Safe', expression: 'true' },
        ],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    // Error case fails, falls through to safe case
    expect(result.outputVariables!.safe).toBeDefined();
    expect(result.metadata?.matchedSlug).toBe('safe');
    const errorCaseResults = result.metadata?.caseResults as Array<{ error?: unknown }> | undefined;
    expect(errorCaseResults?.[0]?.error).toBeDefined();
  });

  it('should include all case results in metadata', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'a', label: 'A', expression: 'false' },
          { slug: 'b', label: 'B', expression: 'true' },
          { slug: 'c', label: 'C', expression: 'true' },
        ],
      },
      makeContext({}),
    );

    const caseResults = result.metadata?.caseResults as Array<{
      slug: string;
      matched: boolean;
    }>;
    expect(caseResults).toHaveLength(3);
    expect(caseResults[0]!.matched).toBe(false);
    expect(caseResults[1]!.matched).toBe(true);
    expect(caseResults[2]!.matched).toBe(true); // evaluated but not the winner
  });

  it('should work with empty incoming data (default branch)', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [{ slug: 'has_data', label: 'Has Data', expression: 'items.length > 0' }],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.default).toBeDefined();
  });

  it('should have correct action metadata', () => {
    expect(switchAction.id).toBe('core.switch');
    expect(switchAction.dynamicOutputs).toBe(true);
    expect(switchAction.excludeFromTools).toBe(true);
  });

  // ------- matchMode: 'all' tests -------

  it('matchMode all: should activate multiple matching branches', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'all',
        cases: [
          { slug: 'even', label: 'Even', expression: 'num % 2 === 0' },
          { slug: 'positive', label: 'Positive', expression: 'num > 0' },
          { slug: 'big', label: 'Big', expression: 'num > 100' },
        ],
      },
      makeContext({ num: 42 }),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.even).toBeDefined();
    expect(result.outputVariables!.positive).toBeDefined();
    expect(result.outputVariables!.big).toBeUndefined();
    expect(result.outputVariables!.default).toBeUndefined();
  });

  it('matchMode all: should fall through to default when nothing matches', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'all',
        cases: [
          { slug: 'a', label: 'A', expression: 'false' },
          { slug: 'b', label: 'B', expression: 'false' },
        ],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.default).toBeDefined();
    expect(result.outputVariables!.a).toBeUndefined();
    expect(result.outputVariables!.b).toBeUndefined();
  });

  it('matchMode all: should activate all branches when all match', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'all',
        cases: [
          { slug: 'first', label: 'First', expression: 'true' },
          { slug: 'second', label: 'Second', expression: 'true' },
        ],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.first).toBeDefined();
    expect(result.outputVariables!.second).toBeDefined();
    expect(result.outputVariables!.default).toBeUndefined();
  });

  it('matchMode first: defaults to first-match behavior', async () => {
    const result = await switchAction.execute(
      {
        matchMode: 'first',
        cases: [
          { slug: 'first', label: 'First', expression: 'true' },
          { slug: 'second', label: 'Second', expression: 'true' },
        ],
      },
      makeContext({}),
    );

    expect(result.success).toBe(true);
    expect(result.outputVariables!.first).toBeDefined();
    expect(result.outputVariables!.second).toBeUndefined();
  });
});
