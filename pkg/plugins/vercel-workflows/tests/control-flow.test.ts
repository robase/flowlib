import { describe, it, expect } from 'vitest';
import { defineFlow, input, output, ifElse, code, switchNode } from '@flowlib/primitives';
import { analyzeFlow, CompileError } from '../src/compiler/control-flow';

describe('analyzeFlow — control-flow analyzer', () => {
  it('emits a linear block list for a simple pipeline', () => {
    const flow = defineFlow({
      nodes: [
        input('name'),
        code('greet', { code: (ctx) => `Hello, ${ctx.name}!` }),
        output('result', { value: (ctx) => ctx.greet }),
      ],
      edges: [
        ['name', 'greet'],
        ['greet', 'result'],
      ],
    });

    const { blocks, outputNodes } = analyzeFlow(flow);

    expect(blocks).toEqual([
      { kind: 'step', nodeRef: 'name' },
      { kind: 'step', nodeRef: 'greet' },
      { kind: 'step', nodeRef: 'result' },
    ]);
    expect(outputNodes).toEqual(['result']);
  });

  it('emits an ifElse block with convergence after a diamond', () => {
    const flow = defineFlow({
      nodes: [
        input('value'),
        ifElse('check', { condition: (ctx) => (ctx.value as number) > 0 }),
        code('positive_side', { code: (ctx) => `pos:${JSON.stringify(ctx)}` }),
        code('negative_side', { code: (ctx) => `neg:${JSON.stringify(ctx)}` }),
        output('result', { value: (ctx) => ctx.previous_nodes }),
      ],
      edges: [
        ['value', 'check'],
        ['check', 'positive_side', 'true_output'],
        ['check', 'negative_side', 'false_output'],
        ['positive_side', 'result'],
        ['negative_side', 'result'],
      ],
    });

    const { blocks } = analyzeFlow(flow);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: 'step', nodeRef: 'value' });

    const branch = blocks[1];
    expect(branch?.kind).toBe('ifElse');
    if (branch?.kind === 'ifElse') {
      expect(branch.nodeRef).toBe('check');
      expect(branch.trueBlock).toEqual([{ kind: 'step', nodeRef: 'positive_side' }]);
      expect(branch.falseBlock).toEqual([{ kind: 'step', nodeRef: 'negative_side' }]);
    }

    expect(blocks[2]).toEqual({ kind: 'step', nodeRef: 'result' });
  });

  it('handles ifElse with terminal arms (no convergence)', () => {
    const flow = defineFlow({
      nodes: [
        input('value'),
        ifElse('check', { condition: (ctx) => (ctx.value as number) > 0 }),
        output('positive', { value: (ctx) => 'yes' }),
        output('negative', { value: (ctx) => 'no' }),
      ],
      edges: [
        ['value', 'check'],
        ['check', 'positive', 'true_output'],
        ['check', 'negative', 'false_output'],
      ],
    });

    const { blocks } = analyzeFlow(flow);

    const branch = blocks.find((b) => b.kind === 'ifElse');
    expect(branch).toBeDefined();
    if (branch?.kind === 'ifElse') {
      expect(branch.trueBlock).toEqual([{ kind: 'step', nodeRef: 'positive' }]);
      expect(branch.falseBlock).toEqual([{ kind: 'step', nodeRef: 'negative' }]);
    }
  });

  it('handles nested ifElse inside an arm', () => {
    const flow = defineFlow({
      nodes: [
        input('value'),
        ifElse('outer', { condition: (ctx) => (ctx.value as number) > 0 }),
        ifElse('inner', { condition: (ctx) => (ctx.value as number) > 10 }),
        output('big', { value: () => 'big' }),
        output('small', { value: () => 'small' }),
        output('negative', { value: () => 'neg' }),
      ],
      edges: [
        ['value', 'outer'],
        ['outer', 'inner', 'true_output'],
        ['inner', 'big', 'true_output'],
        ['inner', 'small', 'false_output'],
        ['outer', 'negative', 'false_output'],
      ],
    });

    const { blocks } = analyzeFlow(flow);

    const outer = blocks.find((b) => b.kind === 'ifElse' && b.nodeRef === 'outer');
    expect(outer).toBeDefined();
    if (outer?.kind === 'ifElse') {
      const innerBlock = outer.trueBlock[0];
      expect(innerBlock?.kind).toBe('ifElse');
      if (innerBlock?.kind === 'ifElse') {
        expect(innerBlock.nodeRef).toBe('inner');
        expect(innerBlock.trueBlock).toEqual([{ kind: 'step', nodeRef: 'big' }]);
        expect(innerBlock.falseBlock).toEqual([{ kind: 'step', nodeRef: 'small' }]);
      }
      expect(outer.falseBlock).toEqual([{ kind: 'step', nodeRef: 'negative' }]);
    }
  });

  it('emits a switch block with static case slugs', () => {
    const flow = defineFlow({
      nodes: [
        input('kind'),
        switchNode('route', {
          cases: [
            { slug: 'a', label: 'A', condition: (ctx) => ctx.kind === 'a' },
            { slug: 'b', label: 'B', condition: (ctx) => ctx.kind === 'b' },
          ],
          matchMode: 'first',
        }),
        output('a_out', { value: () => 'a' }),
        output('b_out', { value: () => 'b' }),
        output('def_out', { value: () => 'def' }),
      ],
      edges: [
        ['kind', 'route'],
        ['route', 'a_out', 'a'],
        ['route', 'b_out', 'b'],
        ['route', 'def_out', 'default'],
      ],
    });

    const { blocks } = analyzeFlow(flow);
    const sw = blocks.find((b) => b.kind === 'switch');
    expect(sw).toBeDefined();
    if (sw?.kind === 'switch') {
      expect(sw.cases.map((c) => c.slug)).toEqual(['a', 'b']);
      expect(sw.cases[0]!.block).toEqual([{ kind: 'step', nodeRef: 'a_out' }]);
      expect(sw.cases[1]!.block).toEqual([{ kind: 'step', nodeRef: 'b_out' }]);
      expect(sw.defaultBlock).toEqual([{ kind: 'step', nodeRef: 'def_out' }]);
    }
  });

  it('rejects switch matchMode="all"', () => {
    const flow = defineFlow({
      nodes: [
        input('kind'),
        switchNode('route', {
          cases: [
            { slug: 'a', label: 'A', condition: () => true },
            { slug: 'b', label: 'B', condition: () => true },
          ],
          matchMode: 'all',
        }),
        output('a_out', { value: () => 'a' }),
        output('b_out', { value: () => 'b' }),
      ],
      edges: [
        ['kind', 'route'],
        ['route', 'a_out', 'a'],
        ['route', 'b_out', 'b'],
      ],
    });

    expect(() => analyzeFlow(flow)).toThrow(CompileError);
    expect(() => analyzeFlow(flow)).toThrow(/matchMode="all"/);
  });

  it('rejects unexpected fan-out from a non-branching node', () => {
    const flow = defineFlow({
      nodes: [
        input('x'),
        code('split', { code: (ctx) => ctx.x }),
        output('a', { value: () => 'a' }),
        output('b', { value: () => 'b' }),
      ],
      edges: [
        ['x', 'split'],
        ['split', 'a'],
        ['split', 'b'],
      ],
    });

    expect(() => analyzeFlow(flow)).toThrow(/Fan-out/);
  });

  it('places each node exactly once even with diamond convergence', () => {
    const flow = defineFlow({
      nodes: [
        input('v'),
        ifElse('check', { condition: () => true }),
        code('a', { code: () => 'a' }),
        code('b', { code: () => 'b' }),
        code('join', { code: () => 'j' }),
        output('out', { value: (ctx) => ctx.join }),
      ],
      edges: [
        ['v', 'check'],
        ['check', 'a', 'true_output'],
        ['check', 'b', 'false_output'],
        ['a', 'join'],
        ['b', 'join'],
        ['join', 'out'],
      ],
    });

    const { blocks } = analyzeFlow(flow);
    const placed: string[] = [];
    const walk = (bs: typeof blocks) => {
      for (const b of bs) {
        if (b.kind === 'step') {
          placed.push(b.nodeRef);
        } else if (b.kind === 'ifElse') {
          placed.push(b.nodeRef);
          walk(b.trueBlock);
          walk(b.falseBlock);
        } else {
          placed.push(b.nodeRef);
          for (const c of b.cases) {
            walk(c.block);
          }
          walk(b.defaultBlock);
        }
      }
    };
    walk(blocks);

    expect(placed.sort()).toEqual(['a', 'b', 'check', 'join', 'out', 'v']);
    expect(new Set(placed).size).toBe(placed.length); // no duplicates
  });
});
