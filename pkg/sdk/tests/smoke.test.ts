import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import {
  defineFlow,
  defineAction,
  output,
  code,
  ifElse,
  model,
  agent,
  tool,
  edge,
  trigger,
  FlowValidationError,
} from '../src';
import type { ProviderDef } from '@flowlib/action-kit';

const TEST_PROVIDER: ProviderDef = {
  id: 'test',
  name: 'Test',
  icon: 'Box',
  category: 'custom',
  nodeCategory: 'Custom',
};

describe('@flowlib/sdk', () => {
  describe('core helpers', () => {
    it('trigger.manual() produces a valid SdkFlowNode with declared inputs', () => {
      const node = trigger.manual('start', {
        inputs: [{ name: 'query', type: 'string' }] as const,
      });
      expect(node.referenceId).toBe('start');
      expect(node.type).toBe('trigger.manual');
      expect(node.params).toMatchObject({
        inputs: [{ name: 'query', type: 'string' }],
      });
    });

    it('output() maps `value` → `outputValue`', () => {
      const node = output('result', { value: '{{ answer }}' });
      expect(node.type).toBe('core.output');
      expect(node.params).toMatchObject({
        outputValue: '{{ answer }}',
        outputName: 'result',
      });
    });

    it('code() passes through the code string', () => {
      const node = code('transform', { code: 'return x * 2' });
      expect(node.type).toBe('core.javascript');
      expect(node.params).toMatchObject({ code: 'return x * 2' });
    });

    it('ifElse() wraps the condition as an expression', () => {
      const node = ifElse('check', { condition: 'x > 5' });
      expect(node.type).toBe('core.if_else');
      expect(node.params).toMatchObject({ expression: 'x > 5' });
    });

    it('model() requires credentials + prompt', () => {
      const node = model('llm', {
        credentialId: 'cred_123',
        model: 'gpt-4o',
        prompt: 'Hello',
      });
      expect(node.type).toBe('core.model');
      expect(node.params).toMatchObject({
        credentialId: 'cred_123',
        model: 'gpt-4o',
        prompt: 'Hello',
      });
    });

    it('agent() with tools embeds tool() calls under params.addedTools', () => {
      const node = agent('researcher', {
        credentialId: 'cred',
        model: 'claude-sonnet-4-6',
        taskPrompt: 'Find stuff',
        addedTools: [
          tool('github.search_issues', { description: 'Find existing issues' }),
          tool('gmail.send_message'),
        ],
      });
      expect(node.type).toBe('core.agent');
      const tools = (node.params as { addedTools?: unknown[] }).addedTools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools).toHaveLength(2);
      expect((tools as Array<Record<string, unknown>>)[0]).toMatchObject({
        toolId: 'github.search_issues',
        description: 'Find existing issues',
      });
    });

    it('NodeOptions (position, label) pass through', () => {
      const node = trigger.manual('start', undefined, {
        position: { x: 10, y: 20 },
        label: 'Custom Label',
      });
      expect(node.position).toEqual({ x: 10, y: 20 });
      expect(node.label).toBe('Custom Label');
    });
  });

  describe('defineFlow', () => {
    it('accepts tuple edges and normalizes them', () => {
      const flow = defineFlow({
        name: 'test',
        nodes: [
          trigger.manual('start', { inputs: [{ name: 'q', type: 'string' }] as const }),
          output('r', { value: '{{ start.q }}' }),
        ],
        edges: [{ from: 'start', to: 'r' }],
      });
      expect(flow.edges).toEqual([{ from: 'start', to: 'r' }]);
    });

    it('accepts object edges with handles', () => {
      const flow = defineFlow({
        nodes: [
          ifElse('check', { condition: 'true' }),
          output('yes', { value: 'yes' }),
          output('no', { value: 'no' }),
        ],
        edges: [
          { from: 'check', to: 'yes', handle: 'true_output' },
          edge('check', 'no', 'false_output'),
        ],
      });
      expect(flow.edges).toEqual([
        { from: 'check', to: 'yes', sourceHandle: 'true_output' },
        { from: 'check', to: 'no', sourceHandle: 'false_output' },
      ]);
    });

    it('rejects duplicate referenceIds', () => {
      expect(() =>
        defineFlow({
          nodes: [output('q', { value: '1' }), output('q', { value: '2' })],
          edges: [],
        }),
      ).toThrow(FlowValidationError);
    });

    it('rejects edges pointing to nonexistent nodes', () => {
      expect(() =>
        defineFlow({
          nodes: [trigger.manual('start')],
          edges: [{ from: 'start', to: 'nowhere' }],
        }),
      ).toThrow(/unknown target/);
    });

    it('preserves metadata fields', () => {
      const flow = defineFlow({
        name: 'My Flow',
        description: 'Does stuff',
        tags: ['example'],
        nodes: [trigger.manual('start')],
        edges: [],
      });
      expect(flow.name).toBe('My Flow');
      expect(flow.description).toBe('Does stuff');
      expect(flow.tags).toEqual(['example']);
    });
  });

  describe('custom actions — same mechanics as built-ins', () => {
    it('a user-defined action is callable in defineFlow just like the built-in helpers', () => {
      const myCustom = defineAction({
        id: 'myservice.custom_action',
        name: 'Custom',
        description: '',
        provider: TEST_PROVIDER,
        params: {
          schema: z.object({ channel: z.string(), summary: z.string() }),
          fields: [],
        },
        execute: async () => ({ success: true }),
      });

      const flow = defineFlow({
        nodes: [trigger.manual('event'), myCustom('notify', { channel: '#alerts', summary: 'hi' })],
        edges: [{ from: 'event', to: 'notify' }],
      });

      expect(flow.nodes).toHaveLength(2);
      expect(flow.nodes[1]).toMatchObject({
        referenceId: 'notify',
        type: 'myservice.custom_action',
        params: { channel: '#alerts', summary: 'hi' },
      });
      // The action object is still the action definition — same mechanics.
      expect(myCustom.id).toBe('myservice.custom_action');
      expect(typeof myCustom.execute).toBe('function');
    });
  });
});
