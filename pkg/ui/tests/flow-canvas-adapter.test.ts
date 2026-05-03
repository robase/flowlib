/**
 * Lane L2: FlowCanvas adapter round-trip tests.
 *
 * The canvas' source of truth is an `FlowlibDefinition` passed in via
 * props. Internally, the flow-editor store operates on React Flow's
 * `Node[]`/`Edge[]`. The adapter must round-trip cleanly for the
 * editor ↔ caller boundary to be stable.
 */

import { describe, it, expect } from 'vitest';
import type { FlowlibDefinition } from '@flowlib/core/types';
import {
  flowlibDefinitionToReactFlowData,
  reactFlowToFlowlibDefinition,
} from '~/flow-canvas/flow-adapter';
import type { ActionMetadata } from '~/flow-canvas/types';
import { InMemoryApiClient } from '~/flow-canvas/InMemoryApiClient';

const sampleActions: ActionMetadata[] = [
  {
    type: 'trigger.manual',
    label: 'Flow Input',
    description: 'Flow input',
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [],
    provider: { id: 'core', name: 'Core', icon: 'Input' },
  },
  {
    type: 'core.javascript',
    label: 'JavaScript',
    description: 'Run JavaScript',
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [{ name: 'code', label: 'Code', type: 'code', required: true }],
    provider: { id: 'core', name: 'Core', icon: 'Code' },
  },
  {
    type: 'core.output',
    label: 'Flow Output',
    description: 'Flow output',
    outputs: [],
    paramFields: [],
    provider: { id: 'core', name: 'Core', icon: 'Output' },
  },
];

const simpleFlow: FlowlibDefinition = {
  nodes: [
    {
      id: 'n1',
      type: 'trigger.manual',
      position: { x: 0, y: 0 },
      params: { value: 'hello' },
    },
    {
      id: 'n2',
      type: 'core.javascript',
      position: { x: 200, y: 0 },
      params: { code: 'return inputs.n1' },
      label: 'Transform',
    },
    {
      id: 'n3',
      type: 'core.output',
      position: { x: 400, y: 0 },
      params: {},
    },
  ] as FlowlibDefinition['nodes'],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ],
};

describe('flow-canvas adapter', () => {
  it('converts FlowlibDefinition → ReactFlowData with expected node data', () => {
    const rf = flowlibDefinitionToReactFlowData({
      flow: simpleFlow,
      actions: sampleActions,
    });
    expect(rf.nodes).toHaveLength(3);
    expect(rf.edges).toHaveLength(2);
    expect(rf.nodes[0].id).toBe('n1');
    expect(rf.nodes[0].type).toBe('trigger.manual');
    expect(rf.nodes[0].position).toEqual({ x: 0, y: 0 });
    // Display name falls back to action label when node.label absent
    expect(rf.nodes[0].data.display_name).toBe('Flow Input');
    // Node label wins over action label when set
    expect(rf.nodes[1].data.display_name).toBe('Transform');
    // Reference ID is derived snake_case
    expect(rf.nodes[1].data.reference_id).toBe('transform');
    // Params are accessible
    expect(rf.nodes[1].data.params).toEqual({ code: 'return inputs.n1' });
  });

  it('maps nodeRunStatus into visual status', () => {
    const rf = flowlibDefinitionToReactFlowData({
      flow: simpleFlow,
      actions: sampleActions,
      nodeRunStatus: { n1: 'success', n2: 'running', n3: 'failed' },
    });
    expect(rf.nodes[0].data.status).toBe('completed');
    expect(rf.nodes[1].data.status).toBe('running');
    expect(rf.nodes[2].data.status).toBe('error');
  });

  it('round-trips FlowlibDefinition → ReactFlow → FlowlibDefinition preserving structure', () => {
    const rf = flowlibDefinitionToReactFlowData({
      flow: simpleFlow,
      actions: sampleActions,
    });
    // Simulate what the store does — node.data.type must be present for
    // the reverse transform; our adapter already populates it.
    const round = reactFlowToFlowlibDefinition(rf.nodes as never[], rf.edges as never[]);
    expect(round.nodes).toHaveLength(3);
    expect(round.edges).toHaveLength(2);
    const byId = Object.fromEntries(round.nodes.map((n) => [n.id, n]));
    expect(byId.n1.type).toBe('trigger.manual');
    expect(byId.n1.position).toEqual({ x: 0, y: 0 });
    expect(byId.n1.params).toEqual({ value: 'hello' });
    expect(byId.n2.type).toBe('core.javascript');
    expect((byId.n2 as { label?: string }).label).toBe('Transform');
  });

  it('handles a flow with no actions registered (degraded but not broken)', () => {
    const rf = flowlibDefinitionToReactFlowData({
      flow: simpleFlow,
      actions: [],
    });
    expect(rf.nodes).toHaveLength(3);
    // Falls back to humanised type string
    expect(rf.nodes[0].data.display_name).toBe('Trigger Manual');
  });
});

describe('InMemoryApiClient', () => {
  it('returns the provided flow as ReactFlowData via getFlowReactFlowData', async () => {
    const client = new InMemoryApiClient({
      flowId: '__flow-canvas__',
      flow: simpleFlow,
      actions: sampleActions,
      credentials: [],
      agentTools: [],
      chatEnabled: false,
    });
    const rf = await client.getFlowReactFlowData('__flow-canvas__');
    expect(rf.nodes).toHaveLength(3);
    expect(rf.edges).toHaveLength(2);
  });

  it('returns actions via getAvailableNodes', async () => {
    const client = new InMemoryApiClient({
      flowId: '__flow-canvas__',
      flow: simpleFlow,
      actions: sampleActions,
      credentials: [],
      agentTools: [],
      chatEnabled: false,
    });
    const actions = await client.getAvailableNodes();
    expect(actions).toHaveLength(3);
    expect(actions[0].type).toBe('trigger.manual');
  });

  it('createFlowVersion calls onEdit with the new definition', async () => {
    let emitted: FlowlibDefinition | null = null;
    const client = new InMemoryApiClient(
      {
        flowId: '__flow-canvas__',
        flow: simpleFlow,
        actions: sampleActions,
        credentials: [],
        agentTools: [],
        chatEnabled: false,
      },
      { onEdit: (f) => (emitted = f) },
    );
    const newFlow: FlowlibDefinition = {
      nodes: [simpleFlow.nodes[0]],
      edges: [],
    } as FlowlibDefinition;
    await client.createFlowVersion('__flow-canvas__', { flowlibDefinition: newFlow });
    expect(emitted).not.toBeNull();
    expect(emitted!.nodes).toHaveLength(1);
  });

  it('executeFlow calls onRequestRun with the inputs', async () => {
    let capturedInputs: Record<string, unknown> | null = null;
    const client = new InMemoryApiClient(
      {
        flowId: '__flow-canvas__',
        flow: simpleFlow,
        actions: sampleActions,
        credentials: [],
        agentTools: [],
        chatEnabled: false,
      },
      { onRequestRun: (inputs) => (capturedInputs = inputs) },
    );
    await client.executeFlow('__flow-canvas__', { foo: 'bar' } as never);
    expect(capturedInputs).toEqual({ foo: 'bar' });
  });

  it('unsupported mutations throw a clear error mentioning "connected backend"', async () => {
    const client = new InMemoryApiClient({
      flowId: '__flow-canvas__',
      flow: simpleFlow,
      actions: sampleActions,
      credentials: [],
      agentTools: [],
      chatEnabled: false,
    });
    await expect(client.createFlow()).rejects.toThrow(/connected backend/);
    await expect(client.getFlowRun()).rejects.toThrow(/connected backend/);
    await expect(client.deleteFlow()).rejects.toThrow(/connected backend/);
  });
});
