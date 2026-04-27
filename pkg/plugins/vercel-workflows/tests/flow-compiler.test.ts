import { describe, it, expect } from 'vitest';
import { defineFlow, input, output, ifElse, code, switchNode } from '@flowlib/primitives';
import { compile } from '../src/compiler/flow-compiler';

const defaultOptions = {
  workflowName: 'myWorkflow',
  flowImport: './my-flow',
  flowExport: 'myFlow',
  configImport: './my-flow.config',
  configExport: 'getFlowConfig',
};

describe('compile — emitter integration', () => {
  it('emits a valid workflow function for a linear flow', () => {
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

    const { code: generated, stepCount, outputCount, warnings } = compile(flow, defaultOptions);

    expect(stepCount).toBe(3);
    expect(outputCount).toBe(1);
    expect(warnings).toHaveLength(0);

    expect(generated).toContain(`'use workflow'`);
    expect(generated).toContain(`globalThis.fetch = fetch`);
    expect(generated).toContain(`export async function myWorkflow`);
    expect(generated).toContain(`step_name`);
    expect(generated).toContain(`step_greet`);
    expect(generated).toContain(`step_result`);
    expect(generated).toContain(`'use step'`);
    expect(generated).toContain(`flowOutputs[`);
    expect(generated).toContain(`return flowOutputs`);
  });

  it('emits if/else control flow for a diamond', () => {
    const flow = defineFlow({
      nodes: [
        input('value'),
        ifElse('check', { condition: (ctx) => (ctx.value as number) > 0 }),
        code('pos', { code: () => 'p' }),
        code('neg', { code: () => 'n' }),
        output('result', { value: (ctx) => ctx.previous_nodes }),
      ],
      edges: [
        ['value', 'check'],
        ['check', 'pos', 'true_output'],
        ['check', 'neg', 'false_output'],
        ['pos', 'result'],
        ['neg', 'result'],
      ],
    });

    const { code: generated } = compile(flow, defaultOptions);

    expect(generated).toContain(`if ("true_output" in (r_check.outputVariables ?? {}))`);
    expect(generated).toMatch(/step_pos\(/);
    expect(generated).toMatch(/step_neg\(/);
    // result is emitted after the branch converges
    const idxBranch = generated.indexOf(`if ("true_output"`);
    const idxResult = generated.indexOf(`step_result({`);
    expect(idxBranch).toBeGreaterThanOrEqual(0);
    expect(idxResult).toBeGreaterThan(idxBranch);
  });

  it('emits else-if chain for switch matchMode=first', () => {
    const flow = defineFlow({
      nodes: [
        input('kind'),
        switchNode('route', {
          cases: [
            { slug: 'case_a', label: 'A', condition: () => true },
            { slug: 'case_b', label: 'B', condition: () => true },
          ],
          matchMode: 'first',
        }),
        output('a_out', { value: () => 'a' }),
        output('b_out', { value: () => 'b' }),
        output('def_out', { value: () => 'def' }),
      ],
      edges: [
        ['kind', 'route'],
        ['route', 'a_out', 'case_a'],
        ['route', 'b_out', 'case_b'],
        ['route', 'def_out', 'default'],
      ],
    });

    const { code: generated } = compile(flow, defaultOptions);

    expect(generated).toContain(`if ("case_a" in (r_route.outputVariables ?? {}))`);
    expect(generated).toContain(`} else if ("case_b" in (r_route.outputVariables ?? {}))`);
    expect(generated).toContain(`} else {`);
  });

  it('rejects referenceIds that collide after identifier sanitization', () => {
    const flow = defineFlow({
      nodes: [
        input('foo-bar'),
        code('foo_bar', { code: () => 'x' }),
        output('out', { value: () => 'y' }),
      ],
      edges: [
        ['foo-bar', 'foo_bar'],
        ['foo_bar', 'out'],
      ],
    });

    expect(() => compile(flow, defaultOptions)).toThrow(/collide after identifier sanitization/);
  });

  it('warns when a flow has no output nodes', () => {
    const flow = defineFlow({
      nodes: [input('x'), code('end', { code: (ctx) => ctx.x })],
      edges: [{ from: 'x', to: 'end' }],
    });

    const { warnings } = compile(flow, defaultOptions);
    expect(warnings).toContain(
      'Flow has no output nodes; compiled workflow will always return an empty object',
    );
  });

  it('emits step functions for every node in the flow', () => {
    const flow = defineFlow({
      nodes: [
        input('a'),
        code('b', { code: () => 'b' }),
        code('c', { code: () => 'c' }),
        output('d', { value: () => 'd' }),
      ],
      edges: [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ],
    });

    const { code: generated } = compile(flow, defaultOptions);

    for (const id of ['a', 'b', 'c', 'd']) {
      expect(generated).toMatch(new RegExp(`async function step_${id}\\(`));
      expect(generated).toContain(`nodeRef: "${id}"`);
    }
  });
});
