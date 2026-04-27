/**
 * Guards against "dual-alias type-matching drift" — every primitive has a
 * `core.X` (DB-origin) and `primitives.X` (SDK-origin) string id. Any compiler
 * check that matches only one variant silently breaks flows from the other
 * origin. This suite runs the compiler over the same logical flow twice, once
 * per prefix, and asserts both succeed identically.
 *
 * If you add a new primitive, add its core.X and primitives.X id to the
 * aliases loop so the regression net grows with the surface.
 */
import { describe, it, expect } from 'vitest';
import type { PrimitiveFlowDefinition } from '@flowlib/primitives';
import { analyzeFlow } from '../src/compiler/control-flow';
import { compile } from '../src/compiler/flow-compiler';

const compileOptions = {
  workflowName: 'dualVariantWorkflow',
  flowImport: './flow',
  flowExport: 'flow',
  configImport: './flow.config',
  configExport: 'getFlowConfig',
};

// Helper: builds a diamond flow with a single branching node. `prefix` controls
// whether the branch + javascript + output nodes carry core.X or primitives.X types.
function buildIfElseDiamond(prefix: 'core' | 'primitives'): PrimitiveFlowDefinition {
  return {
    nodes: [
      { referenceId: 'value', type: `${prefix}.input`, params: { variableName: 'value' } },
      {
        referenceId: 'gate',
        type: `${prefix}.if_else`,
        params: { condition: ((ctx) => (ctx.value as number) > 0) as unknown as boolean },
      },
      {
        referenceId: 'pos',
        type: `${prefix}.javascript`,
        params: { result: (() => 'positive') as unknown as string },
      },
      {
        referenceId: 'neg',
        type: `${prefix}.javascript`,
        params: { result: (() => 'negative') as unknown as string },
      },
      {
        referenceId: 'out',
        type: `${prefix}.output`,
        params: { outputValue: ((ctx) => ctx.previous_nodes) as unknown, outputName: 'out' },
      },
    ],
    edges: [
      ['value', 'gate'],
      ['gate', 'pos', 'true_output'],
      ['gate', 'neg', 'false_output'],
      ['pos', 'out'],
      ['neg', 'out'],
    ],
  };
}

function buildSwitchFanOut(prefix: 'core' | 'primitives'): PrimitiveFlowDefinition {
  return {
    nodes: [
      { referenceId: 'kind', type: `${prefix}.input`, params: { variableName: 'kind' } },
      {
        referenceId: 'router',
        type: `${prefix}.switch`,
        params: {
          matchMode: 'first',
          cases: [
            { slug: 'a', label: 'A', condition: (() => true) as unknown as boolean },
            { slug: 'b', label: 'B', condition: (() => false) as unknown as boolean },
          ],
        },
      },
      {
        referenceId: 'a_out',
        type: `${prefix}.output`,
        params: { outputValue: 'A' as unknown, outputName: 'a' },
      },
      {
        referenceId: 'b_out',
        type: `${prefix}.output`,
        params: { outputValue: 'B' as unknown, outputName: 'b' },
      },
      {
        referenceId: 'd_out',
        type: `${prefix}.output`,
        params: { outputValue: 'D' as unknown, outputName: 'd' },
      },
    ],
    edges: [
      ['kind', 'router'],
      ['router', 'a_out', 'a'],
      ['router', 'b_out', 'b'],
      ['router', 'd_out', 'default'],
    ],
  };
}

describe('vercel-workflows compiler — dual-variant node type aliases', () => {
  for (const prefix of ['core', 'primitives'] as const) {
    describe(`${prefix}.* variants`, () => {
      it(`analyzeFlow recognizes ${prefix}.if_else as a branching node`, () => {
        const flow = buildIfElseDiamond(prefix);
        const { blocks, outputNodes } = analyzeFlow(flow);
        const branch = blocks.find((b) => b.kind === 'ifElse');
        expect(branch, `${prefix}.if_else was not recognized as a branching node`).toBeDefined();
        expect(outputNodes).toContain('out');
      });

      it(`analyzeFlow recognizes ${prefix}.switch as a branching node`, () => {
        const flow = buildSwitchFanOut(prefix);
        const { blocks } = analyzeFlow(flow);
        const branch = blocks.find((b) => b.kind === 'switch');
        expect(branch, `${prefix}.switch was not recognized as a branching node`).toBeDefined();
      });

      it(`compile() emits a workflow function for a ${prefix}.if_else diamond`, () => {
        const flow = buildIfElseDiamond(prefix);
        const { code, warnings } = compile(flow, compileOptions);
        expect(warnings).toHaveLength(0);
        expect(code).toContain(`export async function dualVariantWorkflow`);
        expect(code).toContain(`'use workflow'`);
      });

      it(`compile() emits a workflow function for a ${prefix}.switch fan-out`, () => {
        const flow = buildSwitchFanOut(prefix);
        const { code, warnings } = compile(flow, compileOptions);
        expect(warnings).toHaveLength(0);
        expect(code).toContain(`export async function dualVariantWorkflow`);
      });
    });
  }

  it('produces structurally equivalent ifElse blocks across prefixes', () => {
    const corePlan = analyzeFlow(buildIfElseDiamond('core'));
    const primPlan = analyzeFlow(buildIfElseDiamond('primitives'));
    // Stripping nodeRef differences aside, the control-flow shape must match.
    const shape = (blocks: typeof corePlan.blocks): string => JSON.stringify(blocks, null, 0);
    expect(shape(corePlan.blocks)).toEqual(shape(primPlan.blocks));
  });
});
