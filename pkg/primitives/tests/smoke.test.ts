import { describe, it, expect } from 'vitest';
import { createFlowRunner, defineFlow, triggerManual, output, ifElse, code } from '../src/index';

describe('flow executor smoke tests', () => {
  it('runs a linear trigger → transform → output flow', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'name', type: 'string' }] }),
        code('greet', {
          code: (ctx) => `Hello, ${(ctx.start as { name: string }).name}!`,
        }),
        output('result', { value: (ctx) => ctx.greet }),
      ],
      edges: [
        ['start', 'greet'],
        ['greet', 'result'],
      ],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, { name: 'World' });

    expect(result.status).toBe('success');
    expect(result.outputs.result).toBe('Hello, World!');
  });

  it('routes true branch when condition is truthy', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'value', type: 'number' }] }),
        ifElse('check', {
          condition: (ctx) => ((ctx.start as { value: number }).value as number) > 0,
        }),
        output('positive', { value: (ctx) => ctx.check }),
        output('negative', { value: (ctx) => ctx.check }),
      ],
      edges: [
        ['start', 'check'],
        ['check', 'positive', 'true_output'],
        ['check', 'negative', 'false_output'],
      ],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, { value: 5 });

    expect(result.status).toBe('success');
    expect(result.outputs).toHaveProperty('positive');
    expect(result.outputs).not.toHaveProperty('negative');
  });

  it('routes false branch when condition is falsy', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'value', type: 'number' }] }),
        ifElse('check', {
          condition: (ctx) => ((ctx.start as { value: number }).value as number) > 0,
        }),
        output('positive', { value: (ctx) => ctx.check }),
        output('negative', { value: (ctx) => ctx.check }),
      ],
      edges: [
        ['start', 'check'],
        ['check', 'positive', 'true_output'],
        ['check', 'negative', 'false_output'],
      ],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, { value: -1 });

    expect(result.status).toBe('success');
    expect(result.outputs).toHaveProperty('negative');
    expect(result.outputs).not.toHaveProperty('positive');
  });

  it('validates reserved key "previous_nodes"', () => {
    expect(() =>
      defineFlow({
        nodes: [triggerManual('previous_nodes')],
        edges: [],
      }),
    ).toThrow('reserved');
  });

  it('validates duplicate referenceIds', () => {
    expect(() =>
      defineFlow({
        nodes: [output('x', { value: '1' }), output('x', { value: '2' })],
        edges: [],
      }),
    ).toThrow('Duplicate');
  });

  it('validates colon in referenceId', () => {
    expect(() =>
      defineFlow({
        nodes: [triggerManual('bad:id')],
        edges: [],
      }),
    ).toThrow('colon');
  });

  it('exposes previous_nodes with all ancestor outputs', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'a', type: 'string' }] }),
        code('b', { code: (ctx) => String((ctx.start as { a: string }).a) + '_b' }),
        code('c', { code: (ctx) => String(ctx.b) + '_c' }),
        output('result', {
          value: (ctx) => ({
            direct: ctx.c,
            previous: ctx.previous_nodes,
          }),
        }),
      ],
      edges: [
        ['start', 'b'],
        ['b', 'c'],
        ['c', 'result'],
      ],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, { a: 'start' });

    expect(result.status).toBe('success');
    const resultValue = result.outputs.result as Record<string, unknown>;
    expect(resultValue.direct).toBe('start_b_c');
    const prev = resultValue.previous as Record<string, unknown>;
    expect((prev.start as { a: string }).a).toBe('start');
    expect(prev.b).toBe('start_b');
    expect(prev.c).toBe('start_b_c');
  });

  it('switch routes first matching case', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'score', type: 'number' }] }),
        {
          referenceId: 'route',
          type: 'primitives.switch',
          params: {
            cases: [
              {
                slug: 'high',
                label: 'High',
                condition: (ctx: never) =>
                  (((ctx as Record<string, unknown>).start as { score: number }).score as number) >=
                  90,
              },
              {
                slug: 'mid',
                label: 'Mid',
                condition: (ctx: never) =>
                  (((ctx as Record<string, unknown>).start as { score: number }).score as number) >=
                  50,
              },
            ],
            matchMode: 'first',
          },
        },
        output('tier_high', { value: (_ctx) => 'high' }),
        output('tier_mid', { value: (_ctx) => 'mid' }),
        output('tier_low', { value: (_ctx) => 'low' }),
      ],
      edges: [
        ['start', 'route'],
        ['route', 'tier_high', 'high'],
        ['route', 'tier_mid', 'mid'],
        ['route', 'tier_low', 'default'],
      ],
    });

    const runner = createFlowRunner();
    const result75 = await runner.run(flow, { score: 75 });
    expect(result75.status).toBe('success');
    expect(result75.outputs).toHaveProperty('tier_mid');
    expect(result75.outputs).not.toHaveProperty('tier_high');
    expect(result75.outputs).not.toHaveProperty('tier_low');
  });

  it('surfaces node failures in FlowRunResult', async () => {
    const flow = defineFlow({
      nodes: [
        {
          referenceId: 'fail',
          type: 'core.unknown_action_that_does_not_exist',
          params: {},
        },
      ],
      edges: [],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, {});

    expect(result.status).toBe('failed');
    expect(result.error?.nodeId).toBe('fail');
  });

  it('mapper reshapes context before params are resolved', async () => {
    const flow = defineFlow({
      nodes: [
        triggerManual('start', { inputs: [{ name: 'raw', type: 'string' }] }),
        code('process', {
          code: (ctx) => (ctx.uppercased as string).toUpperCase(),
          mapper: (ctx) => ({
            ...ctx,
            uppercased: String((ctx.start as { raw: string }).raw),
          }),
        }),
        output('result', { value: (ctx) => ctx.process }),
      ],
      edges: [
        ['start', 'process'],
        ['process', 'result'],
      ],
    });

    const runner = createFlowRunner();
    const result = await runner.run(flow, { raw: 'hello' });

    expect(result.status).toBe('success');
    expect(result.outputs.result).toBe('HELLO');
  });
});
