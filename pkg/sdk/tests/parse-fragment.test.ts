import { describe, it, expect } from 'vitest';
import { parseSDKText } from '../src/parse-fragment';

describe('parseSDKText', () => {
  describe('fragment form (structured)', () => {
    it('parses nodes + edges fragments', () => {
      const { nodes, edges } = parseSDKText(`
        nodes: [
          trigger.manual('query'),
          output('result', { value: '{{ query }}' }),
        ],
        edges: [
          { from: 'query', to: 'result' },
        ],
      `);

      expect(nodes).toHaveLength(2);
      expect(nodes[0].referenceId).toBe('query');
      expect(nodes[0].type).toBe('trigger.manual');
      expect(nodes[1].referenceId).toBe('result');
      expect(edges).toEqual([{ from: 'query', to: 'result' }]);
    });

    it('accepts object-form edges with handles', () => {
      const { edges } = parseSDKText(`
        nodes: [
          ifElse('check', { condition: 'x > 0' }),
          output('yes', { value: 'yes' }),
        ],
        edges: [
          { from: 'check', to: 'yes', handle: 'true_output' },
        ],
      `);

      expect(edges).toEqual([{ from: 'check', to: 'yes', handle: 'true_output' }]);
    });

    it('rejects legacy tuple-form edges (Phase 6 removed tuple support)', () => {
      const { edges } = parseSDKText(`
        nodes: [
          ifElse('check', { condition: 'x > 0' }),
          output('no', { value: 'no' }),
        ],
        edges: [
          ['check', 'no', 'false_output'],
        ],
      `);
      expect(edges).toEqual([]);
    });
  });

  describe('full-file form (emitter output)', () => {
    it('unwraps `export const ... = defineFlow(...)` (emitter default)', () => {
      const source = `
import { defineFlow, trigger, output } from '@flowlib/sdk';
import { gmailSendMessageAction } from '@flowlib/actions/gmail';

export const myFlow = defineFlow({
  name: 'My Flow',
  nodes: [
    trigger.manual('query'),
    output('result', { value: '{{ query }}' }),
  ],
  edges: [
    { from: 'query', to: 'result' },
  ],
});
      `;
      const { nodes, edges } = parseSDKText(source);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].referenceId).toBe('query');
      expect(edges).toEqual([{ from: 'query', to: 'result' }]);
    });

    it('unwraps `export default defineFlow(...)`', () => {
      const source = `
import { defineFlow, trigger } from '@flowlib/sdk';
export default defineFlow({
  nodes: [trigger.manual('q')],
  edges: [],
});
      `;
      const { nodes } = parseSDKText(source);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].referenceId).toBe('q');
    });

    it('strips single-line + block comments', () => {
      const source = `
import { defineFlow, trigger } from '@flowlib/sdk';
export default defineFlow({
  // this is a comment
  /* block comment */
  nodes: [trigger.manual('q')],
  edges: [],
});
      `;
      const { nodes } = parseSDKText(source);
      expect(nodes).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('returns empty result for empty input', () => {
      expect(parseSDKText('')).toEqual({ nodes: [], edges: [] });
    });

    it('throws on syntax errors with a helpful message', () => {
      expect(() => parseSDKText('nodes: [ oops not JS ,,, ],')).toThrow(/Failed to parse/);
    });

    it('skips items that do not look like nodes or edges', () => {
      // Mixed valid and garbage — valid items pass through, garbage drops.
      // Tuple-form edges are now garbage too (Phase 6 removed tuple support).
      const { nodes, edges } = parseSDKText(`
        nodes: [
          trigger.manual('x'),
          { notANode: true },
          42,
        ],
        edges: [
          { from: 'x', to: 'y' },
          ['x', 'y'],
          'not an edge',
        ],
      `);
      expect(nodes).toHaveLength(1);
      expect(edges).toEqual([{ from: 'x', to: 'y' }]);
    });
  });

  describe('round-trip via emitSdkSource', () => {
    it('emit → parse preserves nodes and edges', async () => {
      // Use a dynamic import to reach the sibling emitter module.
      const { emitSdkSource } = await import('../src/emitter');
      const definition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'name',
            params: { variableName: 'name' },
          },
          {
            id: 'n2',
            type: 'core.output',
            referenceId: 'greeting',
            params: { outputValue: 'Hello {{ name }}!' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(definition, { flowName: 'roundTripFlow' });

      const { nodes, edges } = parseSDKText(code);
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.referenceId).sort()).toEqual(['greeting', 'name']);
      expect(edges).toHaveLength(1);
    });
  });
});
