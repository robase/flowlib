/**
 * Full-pipeline integration tests.
 *
 * Exercises the complete save-path of authored SDK source:
 *   emit (DB → source) →
 *   parse (source → structured nodes/edges) →
 *   transform (arrow functions → QuickJS strings) →
 *   merge (reconcile with prior DB version)
 *
 * Verifies the critical invariant every downstream feature depends on:
 * idempotency — running the pipeline twice on the same input produces the
 * same output. Round-tripping must not churn node ids, positions, labels,
 * mapper configs, or agent-tool instanceIds.
 *
 * These tests don't touch the real evaluator (which requires jiti + a temp
 * file) — instead they use the browser-safe `parseSDKText` which is
 * sufficient for testing the emit ↔ parse contract. The evaluator path has
 * its own dedicated tests.
 */

import { describe, it, expect } from 'vitest';
import {
  emitSdkSource,
  parseSDKText,
  mergeParsedIntoDefinition,
  type DbFlowDefinition,
} from '../src';
import { transformArrowsToStrings } from '../src/transform';

function runPipeline(priorDef: DbFlowDefinition | null, source: string): DbFlowDefinition {
  const parsed = parseSDKText(source);
  const transformed = transformArrowsToStrings(parsed.nodes);
  if (!transformed.ok) {
    throw new Error(
      `Transform failed: ${transformed.diagnostics.map((d) => `${d.path}: ${d.message}`).join('; ')}`,
    );
  }
  // parseSDKText returns SdkEdge[] — we need ResolvedEdge[] for merge.
  const resolvedEdges = parsed.edges.map((e) =>
    Array.isArray(e)
      ? e.length === 3
        ? { from: e[0], to: e[1], sourceHandle: e[2] }
        : { from: e[0], to: e[1] }
      : e.handle
        ? { from: e.from, to: e.to, sourceHandle: e.handle }
        : { from: e.from, to: e.to },
  );
  return mergeParsedIntoDefinition({ nodes: transformed.nodes, edges: resolvedEdges }, priorDef);
}

describe('Full pipeline: emit → parse → transform → merge', () => {
  describe('idempotency', () => {
    it('round-trips a simple linear flow without drift', () => {
      const initial: DbFlowDefinition = {
        nodes: [
          {
            id: 'node_abc',
            type: 'trigger.manual',
            referenceId: 'query',
            label: 'Query Input',
            position: { x: 100, y: 50 },
            params: { variableName: 'query' },
          },
          {
            id: 'node_def',
            type: 'core.output',
            referenceId: 'result',
            position: { x: 100, y: 200 },
            params: { outputValue: '{{ query }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'node_abc', target: 'node_def' }],
        metadata: { name: 'Round-trip test' },
      };

      const { code: source1 } = emitSdkSource(initial, { flowName: 'myFlow' });
      const merged1 = runPipeline(initial, source1);

      expect(merged1.nodes[0].id).toBe('node_abc');
      expect(merged1.nodes[0].position).toEqual({ x: 100, y: 50 });
      expect(merged1.nodes[0].label).toBe('Query Input');
      expect(merged1.nodes[1].id).toBe('node_def');
      expect(merged1.edges[0].source).toBe('node_abc');
      expect(merged1.edges[0].target).toBe('node_def');

      // Second round-trip from the merged state — should match the first.
      const { code: source2 } = emitSdkSource(merged1, { flowName: 'myFlow' });
      const merged2 = runPipeline(merged1, source2);

      expect(merged2.nodes[0].id).toBe('node_abc');
      expect(merged2.nodes[0].position).toEqual({ x: 100, y: 50 });
      expect(merged2.nodes[1].params.outputValue).toBe(merged1.nodes[1].params.outputValue);
    });

    it('preserves agent node addedTools instanceIds through the pipeline', () => {
      const initial: DbFlowDefinition = {
        nodes: [
          {
            id: 'node_agent',
            type: 'core.agent',
            referenceId: 'assistant',
            params: {
              credentialId: 'cred',
              model: 'gpt-4o',
              taskPrompt: 'Do things',
              addedTools: [
                {
                  instanceId: 'tool_fixed_1',
                  toolId: 'gmail.send_message',
                  name: 'Email',
                  description: 'Send email',
                  params: {},
                },
                {
                  instanceId: 'tool_fixed_2',
                  toolId: 'slack.send_message',
                  name: 'Slack',
                  description: 'Post to slack',
                  params: {},
                },
              ],
            },
          },
        ],
        edges: [],
      };

      const { code } = emitSdkSource(initial);
      const merged = runPipeline(initial, code);

      const tools = merged.nodes[0].params.addedTools as Array<{
        instanceId: string;
        toolId: string;
      }>;
      expect(tools).toHaveLength(2);
      expect(tools[0].instanceId).toBe('tool_fixed_1');
      expect(tools[1].instanceId).toBe('tool_fixed_2');
    });

    it('preserves branching flows with switch cases', () => {
      const initial: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'kind', params: {} },
          {
            id: 'n2',
            type: 'core.switch',
            referenceId: 'route',
            params: {
              matchMode: 'first',
              cases: [
                { slug: 'a', label: 'Case A', expression: 'kind === "a"' },
                { slug: 'b', label: 'Case B', expression: 'kind === "b"' },
              ],
            },
          },
          { id: 'n3', type: 'core.output', referenceId: 'out_a', params: { outputValue: 'A' } },
          { id: 'n4', type: 'core.output', referenceId: 'out_b', params: { outputValue: 'B' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'a' },
          { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'b' },
        ],
      };

      const { code } = emitSdkSource(initial);
      const merged = runPipeline(initial, code);

      expect(merged.nodes).toHaveLength(4);
      const switchNode = merged.nodes.find((n) => n.referenceId === 'route')!;
      const cases = switchNode.params.cases as Array<{ slug: string; expression: string }>;
      expect(cases[0].slug).toBe('a');
      expect(cases[0].expression).toContain('kind === "a"');
      expect(merged.edges.find((e) => e.sourceHandle === 'a')?.target).toBe('n3');
      expect(merged.edges.find((e) => e.sourceHandle === 'b')?.target).toBe('n4');
    });

    it('preserves mapper config through the round-trip', () => {
      // Mapper runs before the node, so the node's `code` body references
      // whatever shape the mapper produces — NOT the upstream refs the
      // transform's identifier-validation pass sees. Use a static code body
      // here (no upstream references) so the transform doesn't flag the
      // mapper-provided binding as unknown. The mapper config itself is the
      // thing we're testing.
      const mapperConfig = {
        enabled: true,
        expression: 'users',
        mode: 'iterate' as const,
        outputMode: 'array' as const,
        concurrency: 5,
        onEmpty: 'skip' as const,
      };
      const initial: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.javascript',
            referenceId: 'transform',
            params: { code: 'return 1' },
            mapper: mapperConfig,
          },
        ],
        edges: [],
      };

      const { code } = emitSdkSource(initial);
      const merged = runPipeline(initial, code);

      expect(merged.nodes[0].mapper).toEqual(mapperConfig);
    });
  });

  describe('edits preserve identity', () => {
    it('renaming an output label keeps node id + position', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'node_x',
            type: 'trigger.manual',
            referenceId: 'q',
            label: 'Old Label',
            position: { x: 50, y: 50 },
            params: { variableName: 'q' },
          },
          {
            id: 'node_y',
            type: 'core.output',
            referenceId: 'result',
            position: { x: 50, y: 200 },
            params: { outputValue: '{{ q }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'node_x', target: 'node_y' }],
      };

      const { code } = emitSdkSource(prior);
      // Simulate an edit: change the outputValue template.
      const editedSource = code.replace('return (q);', 'return ("Prefixed: " + String(q));');
      const merged = runPipeline(prior, editedSource);

      expect(merged.nodes.find((n) => n.referenceId === 'q')?.id).toBe('node_x');
      expect(merged.nodes.find((n) => n.referenceId === 'q')?.position).toEqual({ x: 50, y: 50 });
      expect(merged.nodes.find((n) => n.referenceId === 'q')?.label).toBe('Old Label');
      expect(merged.nodes.find((n) => n.referenceId === 'result')?.id).toBe('node_y');
      // New outputValue should contain the edit.
      expect(
        String(merged.nodes.find((n) => n.referenceId === 'result')?.params.outputValue),
      ).toContain('Prefixed');
    });

    it('adding a new node mints a fresh id while keeping existing ids', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          {
            id: 'node_orig',
            type: 'trigger.manual',
            referenceId: 'q',
            params: { variableName: 'q' },
          },
        ],
        edges: [],
      };

      // Emit + parse the authored source for a flow with a new node added.
      const { code } = emitSdkSource(prior);
      // Phase 9 emitter produces named-record `nodes: { q: trigger.manual(), }`.
      // Inject a sibling entry alongside `q`.
      const editedSource = code.replace(
        '    q: trigger.manual(),\n',
        '    q: trigger.manual(),\n    double: code({ code: (ctx) => ctx.q }),\n',
      );
      // The edit also needs an edge to the new node — add one.
      const withEdge = editedSource.replace(
        '  edges: [\n',
        '  edges: [\n    { from: "q", to: "double" },\n',
      );
      const counter = 0;
      const merged = runPipeline(prior, withEdge);

      const origNode = merged.nodes.find((n) => n.referenceId === 'q');
      const newNode = merged.nodes.find((n) => n.referenceId === 'double');
      expect(origNode?.id).toBe('node_orig');
      expect(newNode?.id).toMatch(/^node_/); // auto-generated
      expect(newNode?.id).not.toBe('node_orig');
      expect(merged.edges).toHaveLength(1);
      expect(merged.edges[0].source).toBe('node_orig');
      expect(merged.edges[0].target).toBe(newNode!.id);
      // Reference `counter` to avoid lint noise about unused bindings.
      void counter;
    });

    it('removing a node drops its edges cleanly', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'a', type: 'trigger.manual', referenceId: 'first', params: {} },
          {
            id: 'b',
            type: 'core.javascript',
            referenceId: 'middle',
            params: { code: 'return first' },
          },
          {
            id: 'c',
            type: 'core.output',
            referenceId: 'end',
            params: { outputValue: '{{ middle }}' },
          },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'c' },
        ],
      };

      // Rewrite the flow without the middle node (just input → output).
      const newSource = `
        nodes: [
          trigger.manual('first'),
          output('end', { value: '{{ first }}' }),
        ],
        edges: [
          { from: 'first', to: 'end' },
        ],
      `;
      const merged = runPipeline(prior, newSource);

      expect(merged.nodes).toHaveLength(2);
      expect(merged.nodes.find((n) => n.referenceId === 'middle')).toBeUndefined();
      expect(merged.nodes.find((n) => n.referenceId === 'first')?.id).toBe('a');
      expect(merged.nodes.find((n) => n.referenceId === 'end')?.id).toBe('c');
      expect(merged.edges).toHaveLength(1);
      expect(merged.edges[0].source).toBe('a');
      expect(merged.edges[0].target).toBe('c');
    });
  });

  describe('emit output is stable across iterations', () => {
    it('emitting twice from the same definition produces identical source', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'x', params: {} },
          { id: 'n2', type: 'core.javascript', referenceId: 'y', params: { code: 'return x + 1' } },
          { id: 'n3', type: 'core.output', referenceId: 'z', params: { outputValue: '{{ y }}' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      };

      const { code: first } = emitSdkSource(def);
      const { code: second } = emitSdkSource(def);
      expect(first).toBe(second);
    });

    it('round-tripping does not drift after 3 iterations', () => {
      let def: DbFlowDefinition = {
        nodes: [
          {
            id: 'stable_id',
            type: 'trigger.manual',
            referenceId: 'q',
            position: { x: 75, y: 125 },
            params: { variableName: 'q', defaultValue: 'hello' },
          },
          {
            id: 'stable_out',
            type: 'core.output',
            referenceId: 'r',
            position: { x: 75, y: 275 },
            params: { outputValue: 'Result: {{ q }}' },
          },
        ],
        edges: [{ id: 'e', source: 'stable_id', target: 'stable_out' }],
      };

      for (let i = 0; i < 3; i++) {
        const { code } = emitSdkSource(def);
        def = runPipeline(def, code);
      }

      expect(def.nodes[0].id).toBe('stable_id');
      expect(def.nodes[0].position).toEqual({ x: 75, y: 125 });
      expect(def.nodes[1].id).toBe('stable_out');
      expect(def.nodes[1].position).toEqual({ x: 75, y: 275 });
      expect(def.edges[0].source).toBe('stable_id');
      expect(def.edges[0].target).toBe('stable_out');
    });
  });

  describe('provider actions', () => {
    // Note: full provider-action round-trip requires the jiti-based evaluator
    // (to resolve `@flowlib/actions/<provider>` imports). See
    // `tests/evaluator.test.ts` for those tests — `parseSDKText` only knows
    // about the core SDK helpers.
    it('emits correct imports for provider actions (emit-only, not parse)', () => {
      const prior: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'event', params: {} },
          {
            id: 'n2',
            type: 'gmail.send_message',
            referenceId: 'notify',
            params: {
              credentialId: 'cred_gmail',
              to: 'alice@example.com',
              subject: 'Alert',
              body: 'Something happened',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };

      const { code, actionImports } = emitSdkSource(prior);
      expect(code).toContain(`import { gmailSendMessageAction } from "@flowlib/actions/gmail"`);
      expect(code).toContain(`notify: gmailSendMessageAction({`);
      expect(actionImports['@flowlib/actions/gmail']).toEqual(['gmailSendMessageAction']);
    });
  });
});
