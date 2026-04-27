/**
 * Regression suite for "dual-alias type-matching drift": every primitive has
 * a `core.X` (DB-origin) and `primitives.X` (SDK-origin) id. The compiler must
 * treat both as equivalent — any `type === 'core.X'` check silently skips
 * SDK-origin flows (or vice versa). This suite compiles the same logical flow
 * twice, once per prefix, and asserts both succeed and produce equivalent
 * source (branch wiring, step names, and metadata).
 */
import { describe, it, expect } from 'vitest';
import type { InvectDefinition } from '@flowlib/core/types';
import { compileFlow } from '../src/compiler/flow-compiler';

const baseMeta = {
  flowId: 'dual-variant-test',
  flowName: 'Dual Variant Test',
  version: 1,
};

function buildIfElseFlow(prefix: 'core' | 'primitives'): InvectDefinition {
  return {
    nodes: [
      {
        id: 'n1',
        type: `${prefix}.input`,
        label: 'Input',
        referenceId: 'inp',
        params: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        type: `${prefix}.if_else`,
        label: 'Gate',
        referenceId: 'gate',
        params: { condition: 'inp.active === true' },
        position: { x: 200, y: 0 },
      },
      {
        id: 'n3',
        type: 'core.template_string',
        label: 'Msg',
        referenceId: 'msg',
        params: { template: 'Active' },
        position: { x: 400, y: 0 },
      },
      {
        id: 'n4',
        type: `${prefix}.output`,
        label: 'Output',
        referenceId: 'out',
        params: {},
        position: { x: 600, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'true_output' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

function buildModelFlow(prefix: 'core' | 'primitives'): InvectDefinition {
  return {
    nodes: [
      {
        id: 'n1',
        type: `${prefix}.input`,
        label: 'Input',
        referenceId: 'inp',
        params: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        type: `${prefix}.model`,
        label: 'Summarize',
        referenceId: 'summary',
        params: { prompt: 'Summarize: {{ inp }}', model: 'gpt-4o-mini' },
        position: { x: 200, y: 0 },
      },
      {
        id: 'n3',
        type: `${prefix}.output`,
        label: 'Output',
        referenceId: 'out',
        params: {},
        position: { x: 400, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  };
}

describe('cloudflare-agents compileFlow — dual-variant node type aliases', () => {
  for (const prefix of ['core', 'primitives'] as const) {
    describe(`${prefix}.* variants`, () => {
      it(`wraps downstream nodes with a branchConditions guard for ${prefix}.if_else`, () => {
        const result = compileFlow({ ...baseMeta, definition: buildIfElseFlow(prefix) });
        expect(result.success).toBe(true);
        expect(result.metadata.hasBranching).toBe(true);
        const source = result.files[0]?.content ?? '';
        expect(source).toContain('branchConditions');
        expect(source).toContain('if (branchConditions["gate"])');
      });

      it(`emits an AI model step for ${prefix}.model`, () => {
        const result = compileFlow({ ...baseMeta, definition: buildModelFlow(prefix) });
        expect(result.success).toBe(true);
        expect(result.metadata.usesAI).toBe(true);
        const source = result.files[0]?.content ?? '';
        expect(source).toContain('chat.completions.create');
      });

      it(`emits an input binding for ${prefix}.input`, () => {
        const result = compileFlow({ ...baseMeta, definition: buildModelFlow(prefix) });
        expect(result.success).toBe(true);
        const source = result.files[0]?.content ?? '';
        // compileInputNode emits a direct assignment rather than a step.do wrapper.
        expect(source).toMatch(/const inp\s*=\s*inputs/);
      });

      it(`emits an output binding for ${prefix}.output`, () => {
        const result = compileFlow({ ...baseMeta, definition: buildModelFlow(prefix) });
        expect(result.success).toBe(true);
        const source = result.files[0]?.content ?? '';
        // compileOutputNode sets `outputs = <upstream>` instead of wrapping in step.do.
        expect(source).toMatch(/outputs\s*=\s*summary/);
      });
    });
  }

  it('produces structurally equivalent output for core.* and primitives.* if_else flows', () => {
    const coreResult = compileFlow({ ...baseMeta, definition: buildIfElseFlow('core') });
    const primResult = compileFlow({ ...baseMeta, definition: buildIfElseFlow('primitives') });
    expect(coreResult.success).toBe(true);
    expect(primResult.success).toBe(true);
    expect(coreResult.metadata.hasBranching).toBe(primResult.metadata.hasBranching);
    expect(coreResult.metadata.usesAI).toBe(primResult.metadata.usesAI);
    expect(coreResult.metadata.nodeCount).toBe(primResult.metadata.nodeCount);
    const coreSrc = coreResult.files[0]?.content ?? '';
    const primSrc = primResult.files[0]?.content ?? '';
    // Both must wire the branch guard; the only expected diff is the node type
    // string baked into comments, which we normalise before diffing.
    const normalise = (s: string): string =>
      s
        .replace(/core\.(if_else|input|output|model|javascript|switch)/g, 'X.$1')
        .replace(/primitives\.(if_else|input|output|model|javascript|switch)/g, 'X.$1');
    expect(normalise(coreSrc)).toEqual(normalise(primSrc));
  });

  it('produces structurally equivalent output for core.* and primitives.* model flows', () => {
    const coreResult = compileFlow({ ...baseMeta, definition: buildModelFlow('core') });
    const primResult = compileFlow({ ...baseMeta, definition: buildModelFlow('primitives') });
    expect(coreResult.success).toBe(true);
    expect(primResult.success).toBe(true);
    expect(coreResult.metadata.usesAI).toBe(primResult.metadata.usesAI);
  });
});
