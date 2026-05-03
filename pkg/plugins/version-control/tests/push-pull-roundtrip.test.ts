/**
 * Push/pull round-trip tests.
 *
 * Exercises the full sync contract: the DB flow definition goes through the
 * unified emitter (with the JSON footer enabled), the resulting `.flow.ts`
 * text is what a git push would write, and the parser (`parseFlowTsContent`)
 * pulls it back into a definition compatible with `importFlowContent`.
 *
 * Covers:
 *   - Footer-first resolution (clean source + intact footer).
 *   - TS hand-edit wins over footer only when the footer is broken/stripped.
 *   - The fallback AST/object-literal path for legacy `.flow.ts` files
 *     without a footer.
 *   - Complex shapes (branching, agent with tools, mapper) survive.
 */

import { describe, it, expect } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';
import { parseFlowTsContent } from '../src/backend/sync-service';

describe('Sync plugin push/pull round-trip', () => {
  describe('JSON footer resolution', () => {
    it('pull reads the footer and returns the authoritative definition', () => {
      const definition = {
        nodes: [
          {
            id: 'node_alpha',
            type: 'trigger.manual',
            referenceId: 'q',
            label: 'Query',
            position: { x: 100, y: 50 },
            params: { variableName: 'q' },
          },
          {
            id: 'node_beta',
            type: 'core.output',
            referenceId: 'result',
            position: { x: 100, y: 200 },
            params: { outputValue: '{{ q }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'node_alpha', target: 'node_beta' }],
        metadata: { name: 'Footer test', description: 'seeded' },
      };

      const { code } = emitSdkSource(definition, {
        flowName: 'footerTestFlow',
        includeJsonFooter: true,
      });

      const parsed = parseFlowTsContent(code);
      expect(parsed).not.toBeNull();
      expect(parsed!.nodes).toHaveLength(2);

      const firstNode = parsed!.nodes[0] as {
        id: string;
        referenceId: string;
        position: { x: number; y: number };
        label: string;
      };
      expect(firstNode.id).toBe('node_alpha');
      expect(firstNode.position).toEqual({ x: 100, y: 50 });
      expect(firstNode.label).toBe('Query');

      const edges = parsed!.edges as Array<{ source: string; target: string }>;
      expect(edges[0].source).toBe('node_alpha');
      expect(edges[0].target).toBe('node_beta');
    });

    it('footer survives even if the TS body is hand-edited into nonsense', () => {
      const definition = {
        nodes: [{ id: 'node_a', type: 'trigger.manual', referenceId: 'x', params: {} }],
        edges: [],
      };
      const { code } = emitSdkSource(definition, {
        flowName: 'myFlow',
        includeJsonFooter: true,
      });

      // Pretend someone hand-edited the TS section and broke the syntax.
      const bodySection = code.split('/* @flowlib-definition')[0];
      const footerSection = '/* @flowlib-definition' + code.split('/* @flowlib-definition')[1];
      const corrupted = bodySection.replace('input("x")', '{{{ BAD SYNTAX }}}') + footerSection;

      const parsed = parseFlowTsContent(corrupted);
      // Footer is preferred — it's intact, so the parse succeeds.
      expect(parsed).not.toBeNull();
      expect(parsed!.nodes).toHaveLength(1);
      const first = parsed!.nodes[0] as { referenceId: string; id: string };
      expect(first.referenceId).toBe('x');
      expect(first.id).toBe('node_a');
    });

    it('footer preserves agent addedTools with instanceIds', () => {
      const definition = {
        nodes: [
          {
            id: 'agent_n1',
            type: 'core.agent',
            referenceId: 'researcher',
            params: {
              credentialId: 'cred_abc',
              model: 'gpt-4o',
              taskPrompt: 'Find things',
              addedTools: [
                {
                  instanceId: 'tool_original_1',
                  toolId: 'github.search_issues',
                  name: 'Search Issues',
                  description: 'Find open issues',
                  params: {},
                },
              ],
            },
          },
        ],
        edges: [],
      };

      const { code } = emitSdkSource(definition, { includeJsonFooter: true });
      const parsed = parseFlowTsContent(code);

      expect(parsed).not.toBeNull();
      const agent = parsed!.nodes[0] as {
        params: {
          addedTools: Array<{ instanceId: string; toolId: string }>;
        };
      };
      expect(agent.params.addedTools).toHaveLength(1);
      expect(agent.params.addedTools[0].instanceId).toBe('tool_original_1');
      expect(agent.params.addedTools[0].toolId).toBe('github.search_issues');
    });

    it('footer preserves mapper config', () => {
      const mapper = {
        enabled: true,
        expression: 'items',
        mode: 'iterate' as const,
        outputMode: 'array' as const,
        concurrency: 5,
        onEmpty: 'skip' as const,
      };
      const definition = {
        nodes: [
          {
            id: 'mapper_n1',
            type: 'core.javascript',
            referenceId: 'process',
            params: { code: 'return item' },
            mapper,
          },
        ],
        edges: [],
      };

      const { code } = emitSdkSource(definition, { includeJsonFooter: true });
      const parsed = parseFlowTsContent(code);

      const node = parsed!.nodes[0] as { mapper: unknown };
      expect(node.mapper).toEqual(mapper);
    });

    it('footer preserves switch cases with source handles', () => {
      const definition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'kind', params: {} },
          {
            id: 'n2',
            type: 'core.switch',
            referenceId: 'route',
            params: {
              matchMode: 'first',
              cases: [
                { slug: 'a', label: 'A', expression: 'kind === "a"' },
                { slug: 'b', label: 'B', expression: 'kind === "b"' },
              ],
            },
          },
          { id: 'n3', type: 'core.output', referenceId: 'out_a', params: {} },
          { id: 'n4', type: 'core.output', referenceId: 'out_b', params: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'a' },
          { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'b' },
        ],
      };

      const { code } = emitSdkSource(definition, { includeJsonFooter: true });
      const parsed = parseFlowTsContent(code);

      const edges = parsed!.edges as Array<{
        source: string;
        target: string;
        sourceHandle?: string;
      }>;
      expect(edges.find((e) => e.sourceHandle === 'a')?.target).toBe('n3');
      expect(edges.find((e) => e.sourceHandle === 'b')?.target).toBe('n4');
    });
  });

  describe('fallback path: footer missing', () => {
    it('parses the TS body via the AST/object-literal fallback', () => {
      // Simulate a hand-authored `.flow.ts` without the JSON footer.
      const source = `
import { defineFlow, input, output } from '@flowlib/core/sdk';

export default defineFlow({
  name: 'Hand-authored',
  nodes: [
    input('query', { variableName: 'query' }),
    output('result', { outputValue: '{{ query }}' }),
  ],
  edges: [
    ['query', 'result'],
  ],
});
`;

      const parsed = parseFlowTsContent(source);
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed!.nodes)).toBe(true);
      expect(Array.isArray(parsed!.edges)).toBe(true);
    });

    it('returns null for source that has neither footer nor defineFlow call', () => {
      const bogus = `console.log('not a flow file');`;
      expect(parseFlowTsContent(bogus)).toBeNull();
    });
  });

  describe('emit → push → pull → import round-trip', () => {
    it('a full linear flow preserves identity across the sync cycle', () => {
      const original = {
        nodes: [
          {
            id: 'node_a1',
            type: 'trigger.manual',
            referenceId: 'q',
            label: 'Q',
            position: { x: 100, y: 100 },
            params: { variableName: 'q' },
          },
          {
            id: 'node_a2',
            type: 'core.javascript',
            referenceId: 'transform',
            label: 'Transform',
            position: { x: 100, y: 250 },
            params: { code: 'return q.toUpperCase()' },
          },
          {
            id: 'node_a3',
            type: 'core.output',
            referenceId: 'out',
            position: { x: 100, y: 400 },
            params: { outputValue: '{{ transform }}' },
          },
        ],
        edges: [
          { id: 'e1', source: 'node_a1', target: 'node_a2' },
          { id: 'e2', source: 'node_a2', target: 'node_a3' },
        ],
        metadata: { name: 'Round-trip flow' },
      };

      // Push: emit to TS + footer.
      const { code: pushed } = emitSdkSource(original, {
        flowName: 'roundTripFlow',
        includeJsonFooter: true,
      });

      // Pull: parse back.
      const parsed = parseFlowTsContent(pushed);
      expect(parsed).not.toBeNull();

      // Full-identity check: every node id + position + label preserved.
      const nodes = parsed!.nodes as Array<{
        id: string;
        referenceId: string;
        label?: string;
        position?: { x: number; y: number };
      }>;
      expect(nodes).toHaveLength(3);
      expect(nodes.find((n) => n.referenceId === 'q')?.id).toBe('node_a1');
      expect(nodes.find((n) => n.referenceId === 'q')?.position).toEqual({ x: 100, y: 100 });
      expect(nodes.find((n) => n.referenceId === 'q')?.label).toBe('Q');
      expect(nodes.find((n) => n.referenceId === 'transform')?.id).toBe('node_a2');
      expect(nodes.find((n) => n.referenceId === 'transform')?.label).toBe('Transform');
      expect(nodes.find((n) => n.referenceId === 'out')?.id).toBe('node_a3');

      const edges = parsed!.edges as Array<{ id: string; source: string; target: string }>;
      expect(edges).toHaveLength(2);
      expect(edges[0].source).toBe('node_a1');
      expect(edges[0].target).toBe('node_a2');
      expect(edges[1].source).toBe('node_a2');
      expect(edges[1].target).toBe('node_a3');
    });

    it('subsequent pushes of the same definition produce identical content', () => {
      const definition = {
        nodes: [{ id: 'stable', type: 'trigger.manual', referenceId: 'x', params: {} }],
        edges: [],
        metadata: { name: 'Stable flow' },
      };

      const { code: first } = emitSdkSource(definition, {
        flowName: 'stableFlow',
        includeJsonFooter: true,
      });
      const { code: second } = emitSdkSource(definition, {
        flowName: 'stableFlow',
        includeJsonFooter: true,
      });
      expect(first).toBe(second);
    });

    it('imported definitions can be re-emitted without drift', () => {
      const definition = {
        nodes: [
          {
            id: 'stable_a',
            type: 'trigger.manual',
            referenceId: 'q',
            position: { x: 0, y: 0 },
            params: { variableName: 'q' },
          },
          {
            id: 'stable_b',
            type: 'core.output',
            referenceId: 'out',
            position: { x: 200, y: 0 },
            params: { outputValue: '{{ q }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'stable_a', target: 'stable_b' }],
      };

      // Round 1: push → pull.
      const { code: pushed1 } = emitSdkSource(definition, { includeJsonFooter: true });
      const pulled1 = parseFlowTsContent(pushed1)!;

      // Round 2: re-push from the pulled definition → pull again.
      const { code: pushed2 } = emitSdkSource(
        pulled1 as unknown as Parameters<typeof emitSdkSource>[0],
        { includeJsonFooter: true },
      );
      const pulled2 = parseFlowTsContent(pushed2)!;

      // The node graph should remain identical through both cycles.
      expect(pulled2.nodes).toEqual(pulled1.nodes);
      expect(pulled2.edges).toEqual(pulled1.edges);
    });
  });

  describe('tags + metadata', () => {
    it('metadata flows through emit → parse round-trip', () => {
      const definition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'x', params: {} }],
        edges: [],
        metadata: { name: 'Tagged', description: 'Test', tags: ['prod', 'v2'] },
      };

      const { code } = emitSdkSource(definition, { includeJsonFooter: true });
      const parsed = parseFlowTsContent(code) as unknown as {
        nodes: unknown[];
        edges: unknown[];
        metadata?: { name?: string; description?: string; tags?: string[] };
      };
      expect(parsed.metadata?.name).toBe('Tagged');
      expect(parsed.metadata?.description).toBe('Test');
      expect(parsed.metadata?.tags).toEqual(['prod', 'v2']);
    });
  });
});
