import { describe, it, expect } from 'vitest';
import { mergeParsedIntoDefinition } from '../src/merge';
import type { DbFlowDefinition } from '../src/emitter/types';

describe('mergeParsedIntoDefinition', () => {
  describe('id preservation', () => {
    it('preserves original DB node ids when referenceId matches', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'node_opaque_abc', type: 'trigger.manual', referenceId: 'query', params: {} },
          { id: 'node_opaque_def', type: 'core.output', referenceId: 'out', params: {} },
        ],
        edges: [{ id: 'e_opaque', source: 'node_opaque_abc', target: 'node_opaque_def' }],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            { referenceId: 'query', type: 'trigger.manual', params: {} },
            { referenceId: 'out', type: 'core.output', params: { outputValue: 'hello' } },
          ],
          edges: [{ from: 'query', to: 'out' }],
        },
        prior,
      );

      expect(merged.nodes[0].id).toBe('node_opaque_abc');
      expect(merged.nodes[1].id).toBe('node_opaque_def');
      // Edges reference the merged (preserved) node ids.
      expect(merged.edges[0].source).toBe('node_opaque_abc');
      expect(merged.edges[0].target).toBe('node_opaque_def');
    });

    it('generates new ids for truly new nodes', () => {
      const prior: DbFlowDefinition = {
        nodes: [{ id: 'node_existing', type: 'trigger.manual', referenceId: 'query', params: {} }],
        edges: [],
      };
      let counter = 0;
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            { referenceId: 'query', type: 'trigger.manual', params: {} },
            { referenceId: 'new_node', type: 'core.javascript', params: { code: 'return 1' } },
          ],
          edges: [],
        },
        prior,
        { newNodeId: () => `fresh_${++counter}` },
      );

      expect(merged.nodes[0].id).toBe('node_existing');
      expect(merged.nodes[1].id).toBe('fresh_1');
    });

    it('generates new ids for all nodes when there is no prior', () => {
      let counter = 0;
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            { referenceId: 'a', type: 'trigger.manual', params: {} },
            { referenceId: 'b', type: 'core.output', params: {} },
          ],
          edges: [{ from: 'a', to: 'b' }],
        },
        null,
        { newNodeId: () => `new_${++counter}` },
      );

      expect(merged.nodes[0].id).toBe('new_1');
      expect(merged.nodes[1].id).toBe('new_2');
      expect(merged.edges[0].source).toBe('new_1');
      expect(merged.edges[0].target).toBe('new_2');
    });

    it('respects explicit ids provided in parsed nodes', () => {
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {}, id: 'explicit_abc' }],
          edges: [],
        },
        null,
      );
      expect(merged.nodes[0].id).toBe('explicit_abc');
    });
  });

  describe('position preservation', () => {
    it('keeps prior positions when parsed nodes have none', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'q',
            params: {},
            position: { x: 100, y: 200 },
          },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        { nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {} }], edges: [] },
        prior,
      );
      expect(merged.nodes[0].position).toEqual({ x: 100, y: 200 });
    });

    it('overrides prior position when parsed supplies a new one', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'q',
            params: {},
            position: { x: 100, y: 200 },
          },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            {
              referenceId: 'q',
              type: 'trigger.manual',
              params: {},
              position: { x: 999, y: 888 },
            },
          ],
          edges: [],
        },
        prior,
      );
      expect(merged.nodes[0].position).toEqual({ x: 999, y: 888 });
    });
  });

  describe('label preservation', () => {
    it('keeps prior label when parsed has none', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {}, label: 'My Query' },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        { nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {} }], edges: [] },
        prior,
      );
      expect(merged.nodes[0].label).toBe('My Query');
    });

    it('parsed label overrides prior', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {}, label: 'Old Label' },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {}, label: 'New Label' }],
          edges: [],
        },
        prior,
      );
      expect(merged.nodes[0].label).toBe('New Label');
    });
  });

  describe('mapper preservation', () => {
    it('keeps prior mapper when parsed has none', () => {
      const priorMapper = {
        enabled: true,
        expression: 'items',
        mode: 'iterate',
        outputMode: 'array',
        concurrency: 1,
        onEmpty: 'skip',
      };
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.javascript',
            referenceId: 'x',
            params: { code: 'return 1' },
            mapper: priorMapper,
          },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [{ referenceId: 'x', type: 'core.javascript', params: { code: 'return 1' } }],
          edges: [],
        },
        prior,
      );
      expect(merged.nodes[0].mapper).toEqual(priorMapper);
    });
  });

  describe('agent tool instanceId preservation', () => {
    it('preserves instanceIds for exact-match tools (toolId + name + description)', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'assistant',
            params: {
              credentialId: 'cred',
              model: 'gpt-4o',
              taskPrompt: 'hi',
              addedTools: [
                {
                  instanceId: 'tool_original_1',
                  toolId: 'gmail.send_message',
                  name: 'Send Email',
                  description: 'Sends an email',
                  params: {},
                },
                {
                  instanceId: 'tool_original_2',
                  toolId: 'slack.send_message',
                  name: 'Send Slack',
                  description: 'Posts to slack',
                  params: {},
                },
              ],
            },
          },
        ],
        edges: [],
      };

      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            {
              referenceId: 'assistant',
              type: 'core.agent',
              params: {
                credentialId: 'cred',
                model: 'gpt-4o',
                taskPrompt: 'hi',
                addedTools: [
                  {
                    instanceId: '',
                    toolId: 'gmail.send_message',
                    name: 'Send Email',
                    description: 'Sends an email',
                    params: {},
                  },
                  {
                    instanceId: '',
                    toolId: 'slack.send_message',
                    name: 'Send Slack',
                    description: 'Posts to slack',
                    params: {},
                  },
                ],
              },
            },
          ],
          edges: [],
        },
        prior,
      );

      const tools = merged.nodes[0].params.addedTools as Array<{
        instanceId: string;
        toolId: string;
      }>;
      expect(tools[0].instanceId).toBe('tool_original_1');
      expect(tools[1].instanceId).toBe('tool_original_2');
    });

    it('preserves instanceId on secondary match (toolId-only) when name/description change', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'a',
            params: {
              credentialId: 'c',
              model: 'm',
              taskPrompt: 'p',
              addedTools: [
                {
                  instanceId: 'tool_kept',
                  toolId: 'gmail.send_message',
                  name: 'Original Name',
                  description: 'Original Desc',
                  params: {},
                },
              ],
            },
          },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            {
              referenceId: 'a',
              type: 'core.agent',
              params: {
                credentialId: 'c',
                model: 'm',
                taskPrompt: 'p',
                addedTools: [
                  {
                    instanceId: '',
                    toolId: 'gmail.send_message',
                    name: 'Renamed',
                    description: 'New description',
                    params: {},
                  },
                ],
              },
            },
          ],
          edges: [],
        },
        prior,
      );
      const tools = merged.nodes[0].params.addedTools as Array<{ instanceId: string }>;
      expect(tools[0].instanceId).toBe('tool_kept');
    });

    it('generates new instanceId for genuinely new tools', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'a',
            params: {
              credentialId: 'c',
              model: 'm',
              taskPrompt: 'p',
              addedTools: [],
            },
          },
        ],
        edges: [],
      };
      let counter = 0;
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            {
              referenceId: 'a',
              type: 'core.agent',
              params: {
                credentialId: 'c',
                model: 'm',
                taskPrompt: 'p',
                addedTools: [
                  {
                    instanceId: '',
                    toolId: 'gmail.send_message',
                    name: 'Send',
                    description: '',
                    params: {},
                  },
                ],
              },
            },
          ],
          edges: [],
        },
        prior,
        { newToolInstanceId: () => `fresh_${++counter}` },
      );
      const tools = merged.nodes[0].params.addedTools as Array<{ instanceId: string }>;
      expect(tools[0].instanceId).toBe('fresh_1');
    });

    it('handles duplicate toolIds — each parsed instance claims its own prior match', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'a',
            params: {
              credentialId: 'c',
              model: 'm',
              taskPrompt: 'p',
              addedTools: [
                {
                  instanceId: 'tool_A',
                  toolId: 'gmail.send_message',
                  name: 'A',
                  description: '',
                  params: {},
                },
                {
                  instanceId: 'tool_B',
                  toolId: 'gmail.send_message',
                  name: 'B',
                  description: '',
                  params: {},
                },
              ],
            },
          },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            {
              referenceId: 'a',
              type: 'core.agent',
              params: {
                credentialId: 'c',
                model: 'm',
                taskPrompt: 'p',
                addedTools: [
                  {
                    instanceId: '',
                    toolId: 'gmail.send_message',
                    name: 'A',
                    description: '',
                    params: {},
                  },
                  {
                    instanceId: '',
                    toolId: 'gmail.send_message',
                    name: 'B',
                    description: '',
                    params: {},
                  },
                ],
              },
            },
          ],
          edges: [],
        },
        prior,
      );
      const tools = merged.nodes[0].params.addedTools as Array<{
        instanceId: string;
        name: string;
      }>;
      expect(tools.find((t) => t.name === 'A')?.instanceId).toBe('tool_A');
      expect(tools.find((t) => t.name === 'B')?.instanceId).toBe('tool_B');
    });
  });

  describe('edge reconstruction', () => {
    it('rewrites edge endpoints from referenceIds to node ids', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'node_a', type: 'trigger.manual', referenceId: 'q', params: {} },
          { id: 'node_b', type: 'core.output', referenceId: 'out', params: {} },
        ],
        edges: [],
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            { referenceId: 'q', type: 'trigger.manual', params: {} },
            { referenceId: 'out', type: 'core.output', params: {} },
          ],
          edges: [{ from: 'q', to: 'out' }],
        },
        prior,
      );
      expect(merged.edges).toHaveLength(1);
      expect(merged.edges[0].source).toBe('node_a');
      expect(merged.edges[0].target).toBe('node_b');
    });

    it('preserves sourceHandle on edges', () => {
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [
            { referenceId: 'check', type: 'core.if_else', params: { expression: 'true' } },
            { referenceId: 'yes', type: 'core.output', params: {} },
          ],
          edges: [{ from: 'check', to: 'yes', sourceHandle: 'true_output' }],
        },
        null,
      );
      expect(merged.edges[0].sourceHandle).toBe('true_output');
    });

    it('throws on edge referencing missing node', () => {
      expect(() =>
        mergeParsedIntoDefinition(
          {
            nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {} }],
            edges: [{ from: 'q', to: 'nowhere' }],
          },
          null,
        ),
      ).toThrow(/missing node/);
    });
  });

  describe('metadata', () => {
    it('uses parsed metadata when provided', () => {
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {} }],
          edges: [],
          metadata: { name: 'New Name' },
        },
        null,
      );
      expect(merged.metadata).toEqual({ name: 'New Name' });
    });

    it('falls back to prior metadata when parsed has none', () => {
      const prior: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {} }],
        edges: [],
        metadata: { name: 'Old Name', description: 'old' },
      };
      const merged = mergeParsedIntoDefinition(
        {
          nodes: [{ referenceId: 'q', type: 'trigger.manual', params: {} }],
          edges: [],
        },
        prior,
      );
      expect(merged.metadata).toEqual({ name: 'Old Name', description: 'old' });
    });
  });

  describe('end-to-end round-trip', () => {
    it('DB → parsed-like → merge → DB preserves all identity/layout data', () => {
      const original: DbFlowDefinition = {
        nodes: [
          {
            id: 'node_abc',
            type: 'trigger.manual',
            referenceId: 'query',
            params: { variableName: 'query' },
            label: 'Query Input',
            position: { x: 100, y: 50 },
          },
          {
            id: 'node_def',
            type: 'core.javascript',
            referenceId: 'transform',
            params: { code: 'return query.toUpperCase()' },
            label: 'Uppercase',
            position: { x: 100, y: 200 },
          },
          {
            id: 'node_ghi',
            type: 'core.output',
            referenceId: 'result',
            params: { outputValue: '{{ transform }}', outputName: 'result' },
            position: { x: 100, y: 350 },
          },
        ],
        edges: [
          { id: 'e1', source: 'node_abc', target: 'node_def' },
          { id: 'e2', source: 'node_def', target: 'node_ghi' },
        ],
        metadata: { name: 'Uppercase Flow' },
      };

      // Simulate what the parser would produce — no ids, no positions.
      const parsed = {
        nodes: original.nodes.map((n) => ({
          referenceId: n.referenceId!,
          type: n.type,
          params: n.params,
        })),
        edges: [
          { from: 'query', to: 'transform' },
          { from: 'transform', to: 'result' },
        ],
      };

      const merged = mergeParsedIntoDefinition(parsed, original);

      // All node ids + positions preserved.
      expect(merged.nodes[0].id).toBe('node_abc');
      expect(merged.nodes[0].position).toEqual({ x: 100, y: 50 });
      expect(merged.nodes[0].label).toBe('Query Input');
      expect(merged.nodes[1].id).toBe('node_def');
      expect(merged.nodes[1].position).toEqual({ x: 100, y: 200 });
      expect(merged.nodes[2].id).toBe('node_ghi');
      expect(merged.nodes[2].position).toEqual({ x: 100, y: 350 });

      // Edges rewired correctly (new edge ids, old node ids).
      expect(merged.edges).toHaveLength(2);
      expect(merged.edges[0].source).toBe('node_abc');
      expect(merged.edges[0].target).toBe('node_def');
      expect(merged.edges[1].source).toBe('node_def');
      expect(merged.edges[1].target).toBe('node_ghi');

      // Metadata preserved.
      expect(merged.metadata?.name).toBe('Uppercase Flow');
    });
  });
});
