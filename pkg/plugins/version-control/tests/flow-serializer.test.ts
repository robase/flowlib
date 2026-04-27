/**
 * Tests for the sync-plugin flow serialisation path.
 *
 * The plugin no longer owns a bespoke serializer — it uses `emitSdkSource`
 * from `@flowlib/sdk` with `includeJsonFooter: true`. These tests exercise
 * the emitter output shape as the sync plugin invokes it, plus the
 * round-trip through the plugin's JSON-footer parser.
 */

import { describe, it, expect } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';

describe('sync plugin flow serialisation (via @flowlib/sdk emitter)', () => {
  it('emits a simple input → model → output flow with the JSON footer', () => {
    const definition = {
      nodes: [
        {
          id: 'node-query',
          type: 'core.input',
          label: 'Query Input',
          referenceId: 'query',
          position: { x: 0, y: 0 },
          params: { variableName: 'query' },
        },
        {
          id: 'node-answer',
          type: 'core.model',
          label: 'Answer',
          referenceId: 'answer',
          position: { x: 200, y: 0 },
          params: {
            credentialId: 'cred_openai_123',
            model: 'gpt-4o',
            prompt: '{{ query }}',
          },
        },
        {
          id: 'node-result',
          type: 'core.output',
          label: 'Result',
          referenceId: 'result',
          position: { x: 400, y: 0 },
          params: { outputName: 'answer', outputValue: '{{ answer }}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'node-query', target: 'node-answer' },
        { id: 'e2', source: 'node-answer', target: 'node-result' },
      ],
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'questionAnsweringFlow',
      includeJsonFooter: true,
      metadata: { name: 'Question Answering', description: 'A simple Q&A flow' },
    });

    // Top-level structure.
    expect(code).toContain(`import {`);
    expect(code).toContain(`from "@flowlib/sdk"`);
    expect(code).toContain(`export const questionAnsweringFlow = defineFlow({`);
    expect(code).toContain(`name: "Question Answering"`);
    expect(code).toContain(`description: "A simple Q&A flow"`);
    // Core helpers in named-record form (key: helper(...)).
    expect(code).toContain(`query: input(`);
    expect(code).toContain(`answer: model(`);
    expect(code).toContain(`result: output(`);
    // Edges use object form with preserved referenceIds.
    expect(code).toContain(`{ from: "query", to: "answer" }`);
    expect(code).toContain(`{ from: "answer", to: "result" }`);
    // Footer carries the authoritative JSON for reliable round-trip.
    expect(code).toContain('/* @flowlib-definition');
    expect(code).toContain('*/');
  });

  it('emits provider actions as direct action-callable imports', () => {
    const definition = {
      nodes: [
        {
          id: 'node-send',
          type: 'gmail.send_message',
          label: 'Send Email',
          referenceId: 'send',
          position: { x: 0, y: 0 },
          params: {
            credentialId: 'cred',
            to: 'test@example.com',
            subject: 'Hello',
            body: 'World',
          },
        },
      ],
      edges: [],
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'emailFlow',
      includeJsonFooter: true,
      metadata: { name: 'Email Flow' },
    });

    // Unified emitter pulls in the action callable directly from the
    // provider package, no namespace aliasing.
    expect(code).toContain(`import { gmailSendMessageAction } from "@flowlib/actions/gmail"`);
    expect(code).toContain(`send: gmailSendMessageAction(`);
  });

  it('preserves sourceHandle on edges in object form', () => {
    const definition = {
      nodes: [
        {
          id: 'node-check',
          type: 'core.if_else',
          referenceId: 'check',
          position: { x: 0, y: 0 },
          params: { expression: 'value > 10' },
        },
        {
          id: 'node-yes',
          type: 'core.output',
          referenceId: 'yes',
          position: { x: 200, y: 0 },
          params: {},
        },
      ],
      edges: [{ id: 'e1', source: 'node-check', target: 'node-yes', sourceHandle: 'true_output' }],
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'branchFlow',
      includeJsonFooter: true,
      metadata: { name: 'Branch' },
    });

    expect(code).toContain(`{ from: "check", to: "yes", handle: "true_output" }`);
  });

  it('includes tags in metadata when present', () => {
    const definition = {
      nodes: [
        {
          id: 'node-x',
          type: 'core.input',
          referenceId: 'x',
          position: { x: 0, y: 0 },
          params: {},
        },
      ],
      edges: [],
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'taggedFlow',
      includeJsonFooter: true,
      metadata: { name: 'Tagged', tags: ['production', 'v2'] },
    });

    expect(code).toContain(`tags: ["production","v2"]`);
  });

  it('JSON footer faithfully preserves the full definition for round-trip', () => {
    const original = {
      nodes: [
        {
          id: 'node_abc',
          type: 'core.input',
          referenceId: 'q',
          label: 'Query',
          position: { x: 100, y: 50 },
          params: { variableName: 'q' },
        },
        {
          id: 'node_def',
          type: 'core.output',
          referenceId: 'out',
          params: { outputValue: '{{ q }}' },
        },
      ],
      edges: [{ id: 'e1', source: 'node_abc', target: 'node_def' }],
      metadata: { name: 'Round-trip test' },
    };

    const { code } = emitSdkSource(original, {
      flowName: 'roundTripFlow',
      includeJsonFooter: true,
    });

    // Extract footer the same way the plugin's parseFlowTsContent does.
    const match = code.match(/\/\*\s*@flowlib-definition\s+([\s\S]*?)\s*\*\//);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);

    // Everything the authoring source discards (opaque ids, positions,
    // labels) is preserved in the footer for the pull path.
    expect(parsed.nodes[0].id).toBe('node_abc');
    expect(parsed.nodes[0].position).toEqual({ x: 100, y: 50 });
    expect(parsed.nodes[0].label).toBe('Query');
    expect(parsed.edges[0].source).toBe('node_abc');
    expect(parsed.edges[0].target).toBe('node_def');
    expect(parsed.metadata.name).toBe('Round-trip test');
  });
});
