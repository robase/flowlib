/**
 * Copy-paste round-trip tests.
 *
 * The flow editor's copy/paste bridges React-Flow state to the unified
 * `@flowlib/sdk` emitter + parser. These tests verify the two helpers that
 * make that bridge work:
 *
 *   - `clipboardToSdkText(data, isFullGraph)` — ClipboardData → SDK source.
 *   - `sdkResultToClipboard(parsed, flowId)` — parsed SDK source → ClipboardData.
 *
 * The end-to-end contract: a user copies nodes from the canvas, pastes into
 * a text editor, and can paste back into the canvas (or into a different
 * canvas) without losing node structure, referenceIds, params, or edge
 * connectivity. Opaque DB ids don't survive (the SDK source doesn't carry
 * them), but `materializePaste` regenerates ids anyway, so that's fine.
 */

import { describe, it, expect } from 'vitest';
import { parseSDKText } from '@flowlib/sdk';
import {
  clipboardToSdkText,
  sdkResultToClipboard,
} from '../src/components/flow-editor/use-copy-paste';
import type {
  ClipboardData,
  ClipboardNode,
  ClipboardEdge,
} from '../src/components/flow-editor/use-copy-paste.types';

// Small helper — build a ClipboardNode with minimal repetition.
function clipNode(opts: {
  originalId: string;
  type: string;
  referenceId: string;
  displayName?: string;
  params?: Record<string, unknown>;
  relativePosition?: { x: number; y: number };
  absolutePosition?: { x: number; y: number };
  mapper?: unknown;
}): ClipboardNode {
  return {
    originalId: opts.originalId,
    type: opts.type,
    relativePosition: opts.relativePosition ?? { x: 0, y: 0 },
    absolutePosition: opts.absolutePosition ?? { x: 100, y: 100 },
    data: {
      display_name: opts.displayName ?? opts.referenceId,
      reference_id: opts.referenceId,
      params: opts.params ?? {},
      ...(opts.mapper !== undefined && { mapper: opts.mapper }),
    },
  };
}

function clipEdge(source: string, target: string, sourceHandle?: string): ClipboardEdge {
  return {
    originalId: `edge-${source}-${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

describe('clipboardToSdkText', () => {
  it('emits a full-file SDK source for a full-graph selection', () => {
    const data: ClipboardData = {
      sourceFlowId: 'flow-1',
      nodes: [
        clipNode({
          originalId: 'n1',
          type: 'core.input',
          referenceId: 'query',
          params: { variableName: 'query' },
        }),
        clipNode({
          originalId: 'n2',
          type: 'core.output',
          referenceId: 'result',
          params: { outputValue: '{{ query }}' },
        }),
      ],
      edges: [clipEdge('n1', 'n2')],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(data, true);

    expect(source).toContain(`import { defineFlow, input, output } from "@flowlib/sdk"`);
    expect(source).toContain(`export const copiedFlow = defineFlow({`);
    expect(source).toContain(`query: input(`);
    expect(source).toContain(`result: output(`);
  });

  it('emits just the fragment body for a partial selection', () => {
    const data: ClipboardData = {
      sourceFlowId: 'flow-1',
      nodes: [clipNode({ originalId: 'n1', type: 'core.input', referenceId: 'q' })],
      edges: [],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(data, false);

    // Fragment form has no top-level `import` / `export` wrappers.
    expect(source).not.toContain('import');
    expect(source).not.toContain('export');
    expect(source).not.toContain('defineFlow');
    // But it does carry the nodes/edges entries.
    expect(source).toContain('nodes: {');
    expect(source).toContain(`q: input(`);
  });

  it('preserves sourceHandle on edges (if_else true/false branches)', () => {
    const data: ClipboardData = {
      sourceFlowId: 'flow-1',
      nodes: [
        clipNode({
          originalId: 'n1',
          type: 'core.if_else',
          referenceId: 'check',
          params: { expression: 'x > 0' },
        }),
        clipNode({ originalId: 'n2', type: 'core.output', referenceId: 'yes' }),
        clipNode({ originalId: 'n3', type: 'core.output', referenceId: 'no' }),
      ],
      edges: [clipEdge('n1', 'n2', 'true_output'), clipEdge('n1', 'n3', 'false_output')],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(data, true);
    expect(source).toContain(`{ from: "check", to: "yes", handle: "true_output" }`);
    expect(source).toContain(`{ from: "check", to: "no", handle: "false_output" }`);
  });

  it('preserves mapper config in emitted source', () => {
    const mapper = {
      enabled: true,
      expression: 'items',
      mode: 'iterate',
      outputMode: 'array',
      concurrency: 3,
      onEmpty: 'skip',
    };
    const data: ClipboardData = {
      sourceFlowId: 'flow-1',
      nodes: [
        clipNode({
          originalId: 'n1',
          type: 'core.javascript',
          referenceId: 'transform',
          params: { code: 'return 1' },
          mapper,
        }),
      ],
      edges: [],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(data, true);
    expect(source).toContain('mapper:');
    expect(source).toContain(`expression: "items"`);
    expect(source).toContain(`mode: "iterate"`);
  });
});

describe('sdkResultToClipboard', () => {
  it('converts parsed SDK source back to a ClipboardData structure', () => {
    const parsed = parseSDKText(`
      nodes: [
        input('query'),
        output('result', { value: '{{ query }}' }),
      ],
      edges: [
        { from: 'query', to: 'result' },
      ],
    `);

    const clipboard = sdkResultToClipboard(parsed, 'flow-destination');

    expect(clipboard.sourceFlowId).toBe('flow-destination');
    expect(clipboard.nodes).toHaveLength(2);
    expect(clipboard.nodes[0].data.reference_id).toBe('query');
    expect(clipboard.nodes[0].type).toBe('core.input');
    expect(clipboard.nodes[0].originalId).toContain('query');
    expect(clipboard.nodes[1].data.reference_id).toBe('result');
    expect(clipboard.nodes[1].type).toBe('core.output');

    // Edge endpoints should be remapped from referenceIds to the synthetic
    // originalIds the clipboard converter generated.
    expect(clipboard.edges).toHaveLength(1);
    expect(clipboard.edges[0].source).toBe(clipboard.nodes[0].originalId);
    expect(clipboard.edges[0].target).toBe(clipboard.nodes[1].originalId);
  });

  it('handles object-form edges with handle', () => {
    const parsed = parseSDKText(`
      nodes: [
        ifElse('check', { condition: 'x > 0' }),
        output('yes', { value: 'yes' }),
      ],
      edges: [
        { from: 'check', to: 'yes', handle: 'true_output' },
      ],
    `);

    const clipboard = sdkResultToClipboard(parsed, 'flow-x');
    expect(clipboard.edges[0].sourceHandle).toBe('true_output');
  });

  it('synthesises unique originalIds per node', () => {
    const parsed = parseSDKText(`
      nodes: [
        input('a'),
        input('b'),
        input('c'),
      ],
      edges: [],
    `);

    const clipboard = sdkResultToClipboard(parsed, 'flow-x');
    const ids = clipboard.nodes.map((n) => n.originalId);
    expect(new Set(ids).size).toBe(3);
  });

  it('computes relative positions anchored to the bounding-box top-left', () => {
    // parseSDKText drops positions — these come from the options passed to
    // the helpers. Synthesise a flow with positions to validate the math.
    const parsed = parseSDKText(`
      nodes: [
        input('a', {}, { position: { x: 200, y: 100 } }),
        input('b', {}, { position: { x: 300, y: 200 } }),
      ],
      edges: [],
    `);

    const clipboard = sdkResultToClipboard(parsed, 'flow-x');
    // Top-left of the bounding box should be at (0,0) in relative space.
    expect(clipboard.nodes[0].relativePosition).toEqual({ x: 0, y: 0 });
    expect(clipboard.nodes[1].relativePosition).toEqual({ x: 100, y: 100 });
    // Absolute positions preserved.
    expect(clipboard.nodes[0].absolutePosition).toEqual({ x: 200, y: 100 });
    expect(clipboard.nodes[1].absolutePosition).toEqual({ x: 300, y: 200 });
  });
});

describe('full copy-paste round-trip', () => {
  it('clipboard → source → parsed → clipboard preserves node types + refs + edges', () => {
    // Note: `code` / `output` params go through arrow-function emission; when
    // parsed back in the browser (no Node-only transform available) they
    // surface as function values rather than strings. That's expected — the
    // clipboard's materializePaste regenerates them server-side. This test
    // exercises only the fields that survive the browser-side round-trip.
    const original: ClipboardData = {
      sourceFlowId: 'flow-src',
      nodes: [
        clipNode({
          originalId: 'src_n1',
          type: 'core.input',
          referenceId: 'input_x',
          displayName: 'Input X',
          params: { variableName: 'x', defaultValue: 'default' },
          absolutePosition: { x: 100, y: 100 },
        }),
        clipNode({
          originalId: 'src_n2',
          type: 'core.template_string',
          referenceId: 'compose',
          params: { template: 'Value is {{ input_x }}' },
          absolutePosition: { x: 100, y: 300 },
        }),
      ],
      edges: [clipEdge('src_n1', 'src_n2')],
      copyTime: Date.now(),
    };

    // 1. Copy → SDK text.
    const source = clipboardToSdkText(original, true);

    // 2. Paste → parse.
    const parsed = parseSDKText(source);

    // 3. Map parsed back to ClipboardData (what the paste hook does).
    const pasted = sdkResultToClipboard(parsed, 'flow-dst');

    // Node structure preserved (types + referenceIds).
    expect(pasted.nodes).toHaveLength(2);
    expect(pasted.nodes.map((n) => n.data.reference_id)).toEqual(['input_x', 'compose']);
    expect(pasted.nodes.map((n) => n.type)).toEqual(['core.input', 'core.template_string']);

    // Edge connectivity preserved (via new originalIds).
    expect(pasted.edges).toHaveLength(1);
    const ids = new Map(pasted.nodes.map((n) => [n.data.reference_id, n.originalId]));
    expect(pasted.edges[0].source).toBe(ids.get('input_x'));
    expect(pasted.edges[0].target).toBe(ids.get('compose'));

    // Params that stay as strings through the emit/parse round-trip.
    expect(pasted.nodes[0].data.params.variableName).toBe('x');
    expect(pasted.nodes[0].data.params.defaultValue).toBe('default');
    expect(pasted.nodes[1].data.params.template).toBe('Value is {{ input_x }}');
  });

  it('branching flow survives copy-paste round-trip', () => {
    const original: ClipboardData = {
      sourceFlowId: 'flow-src',
      nodes: [
        clipNode({
          originalId: 'n1',
          type: 'core.input',
          referenceId: 'age',
        }),
        clipNode({
          originalId: 'n2',
          type: 'core.if_else',
          referenceId: 'adult_check',
          params: { expression: 'age >= 18' },
        }),
        clipNode({
          originalId: 'n3',
          type: 'core.output',
          referenceId: 'adult',
          params: { outputValue: 'adult' },
        }),
        clipNode({
          originalId: 'n4',
          type: 'core.output',
          referenceId: 'minor',
          params: { outputValue: 'minor' },
        }),
      ],
      edges: [
        clipEdge('n1', 'n2'),
        clipEdge('n2', 'n3', 'true_output'),
        clipEdge('n2', 'n4', 'false_output'),
      ],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(original, true);
    const parsed = parseSDKText(source);
    const pasted = sdkResultToClipboard(parsed, 'flow-dst');

    expect(pasted.nodes).toHaveLength(4);
    expect(pasted.edges).toHaveLength(3);
    // Both branch-handle edges survive the round-trip.
    const handles = pasted.edges
      .map((e) => e.sourceHandle)
      .filter(Boolean)
      .sort();
    expect(handles).toEqual(['false_output', 'true_output']);
  });

  it('agent node with tools round-trips with addedTools intact', () => {
    const original: ClipboardData = {
      sourceFlowId: 'flow-src',
      nodes: [
        clipNode({
          originalId: 'agent_1',
          type: 'core.agent',
          referenceId: 'researcher',
          params: {
            credentialId: 'cred_123',
            model: 'gpt-4o',
            taskPrompt: 'Find things',
            addedTools: [
              {
                instanceId: 'tool_source_1',
                toolId: 'github.search_issues',
                name: 'Find Issues',
                description: 'Look for existing issues',
                params: {},
              },
            ],
          },
        }),
      ],
      edges: [],
      copyTime: Date.now(),
    };

    const source = clipboardToSdkText(original, true);
    expect(source).toContain('researcher: agent(');
    expect(source).toContain('tool("github.search_issues"');
    // Source instanceId should not appear in the emitted text (stripped for
    // paste; merge assigns fresh ids on save).
    expect(source).not.toContain('tool_source_1');

    const parsed = parseSDKText(source);
    expect(parsed.nodes).toHaveLength(1);
    const agentNode = parsed.nodes[0];
    expect(agentNode.type).toBe('core.agent');
    const tools = (agentNode.params as { addedTools: Array<Record<string, unknown>> }).addedTools;
    expect(tools).toHaveLength(1);
    expect(tools[0].toolId).toBe('github.search_issues');
    expect(tools[0].description).toBe('Look for existing issues');
  });
});
