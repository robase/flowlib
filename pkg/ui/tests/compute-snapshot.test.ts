import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { computeSnapshot, transformToFlowlibDefinition } from '../src/utils/flowTransformations';

// Helper: minimal valid node for tests
function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    type: 'core.model',
    position: { x: 100, y: 200 },
    data: {
      id: 'node-1',
      type: 'core.model',
      display_name: 'My Model',
      reference_id: 'my_model',
      params: { prompt: 'hello' },
    },
    ...overrides,
  };
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    ...overrides,
  };
}

describe('transformToFlowlibDefinition', () => {
  it('strips ReactFlow-internal fields (selected, measured, dragging)', () => {
    const node: Node = {
      ...makeNode(),
      selected: true,
      dragging: true,
      measured: { width: 200, height: 100 },
    };

    const result = transformToFlowlibDefinition([node], []);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('"selected"');
    expect(serialized).not.toContain('"dragging"');
    expect(serialized).not.toContain('"measured"');
  });

  it('preserves structural fields (id, type, position, params, label)', () => {
    const result = transformToFlowlibDefinition([makeNode()], []);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('node-1');
    expect(result.nodes[0].type).toBe('core.model');
    expect(result.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(result.nodes[0].params).toEqual({ prompt: 'hello' });
    expect(result.nodes[0].label).toBe('My Model');
  });

  it('preserves edge core properties and strips extras', () => {
    const edge: Edge = {
      ...makeEdge(),
      selected: true,
      animated: true,
      type: 'smoothstep',
      sourceHandle: 'out',
      targetHandle: null,
    };

    const result = transformToFlowlibDefinition([], [edge]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      sourceHandle: 'out',
      targetHandle: undefined, // null → undefined
    });
    // `selected`, `animated`, `type` should not be in the edge
    const serialized = JSON.stringify(result.edges[0]);
    expect(serialized).not.toContain('"selected"');
    expect(serialized).not.toContain('"animated"');
  });
});

describe('computeSnapshot', () => {
  it('returns a stable JSON string', () => {
    const nodes = [makeNode()];
    const edges = [makeEdge()];

    const snap1 = computeSnapshot(nodes, edges);
    const snap2 = computeSnapshot(nodes, edges);

    expect(snap1).toBe(snap2);
    expect(typeof snap1).toBe('string');
  });

  it('produces identical snapshots for structurally identical flows', () => {
    const nodesA = [makeNode()];
    const nodesB = [makeNode()];

    expect(computeSnapshot(nodesA, [])).toBe(computeSnapshot(nodesB, []));
  });

  it('ignores selection state changes', () => {
    const nodeA = makeNode({ selected: false });
    const nodeB = makeNode({ selected: true });

    expect(computeSnapshot([nodeA], [])).toBe(computeSnapshot([nodeB], []));
  });

  it('detects position changes', () => {
    const nodeA = makeNode({ position: { x: 0, y: 0 } });
    const nodeB = makeNode({ position: { x: 100, y: 200 } });

    expect(computeSnapshot([nodeA], [])).not.toBe(computeSnapshot([nodeB], []));
  });

  it('detects param changes', () => {
    const nodeA = makeNode({ data: { params: { prompt: 'v1' } } });
    const nodeB = makeNode({ data: { params: { prompt: 'v2' } } });

    expect(computeSnapshot([nodeA], [])).not.toBe(computeSnapshot([nodeB], []));
  });

  it('detects edge additions', () => {
    const nodes = [makeNode()];
    const s1 = computeSnapshot(nodes, []);
    const s2 = computeSnapshot(nodes, [makeEdge()]);

    expect(s1).not.toBe(s2);
  });
});
