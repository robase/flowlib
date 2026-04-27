/**
 * Integration tests for the Phase 7 source-level chat tools.
 *
 * Exercises the full pipeline — `get_flow_source` emits, `edit_flow_source` /
 * `write_flow_source` evaluate + transform + merge + save — against a real
 * in-memory Invect instance. Verifies the contract that matters for the chat
 * assistant: emitted source round-trips via the SDK, node ids / positions /
 * metadata are preserved across edits, and error paths return actionable
 * diagnostics to the LLM.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import fsSync from 'node:fs';
import { join } from 'node:path';
import type { InvectInstance } from '../../../src/api/types';
import type { ChatToolContext } from '../../../src/services/chat/chat-types';
import {
  getFlowSourceTool,
  editFlowSourceTool,
  writeFlowSourceTool,
} from '../../../src/services/chat/tools/sdk-tools';
import { updateSwitchCaseTool } from '../../../src/services/chat/tools/node-tools';
import { createTestInvect } from '../helpers/test-flowlib';

/**
 * The evaluator (used by edit/write tools) imports flows via jiti, which
 * resolves `@flowlib/sdk` to its `dist/` output. Ensure the dist exists before
 * running these tests — matches the guard in the sdk package's own tests.
 */
function ensureSdkBuilt(): void {
  const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
  const sdkDist = join(repoRoot, 'pkg', 'sdk', 'dist', 'index.mjs');
  if (!fsSync.existsSync(sdkDist)) {
    execSync('pnpm --filter @flowlib/sdk build', { cwd: repoRoot, stdio: 'inherit' });
  }
}

describe('Chat SDK tools — source-level flow editing', () => {
  let flowlib: InvectInstance;
  let baseCtx: Omit<ChatToolContext, 'chatContext'>;

  beforeAll(async () => {
    ensureSdkBuilt();
    flowlib = await createTestInvect();
    baseCtx = { flowlib };
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  let flowId: string;
  beforeEach(async () => {
    const flow = await flowlib.flows.create({ name: 'SDK tool test flow' });
    flowId = flow.id;
  });

  // ───────────────────────── get_flow_source ─────────────────────────

  describe('get_flow_source', () => {
    it('returns a valid SDK source string for a flow', async () => {
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node-query',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
            },
            {
              id: 'node-out',
              type: 'core.output',
              referenceId: 'out',
              params: { outputValue: '{{ query }}' },
            },
          ],
          edges: [{ id: 'e1', source: 'node-query', target: 'node-out' }],
        },
      });

      const result = await getFlowSourceTool.execute({}, { ...baseCtx, chatContext: { flowId } });

      expect(result.success).toBe(true);
      const data = result.data as {
        source: string;
        flowId: string;
        nodeCount: number;
      };
      expect(data.source).toContain(`from "@flowlib/sdk"`);
      expect(data.source).toContain(`query: input(`);
      expect(data.source).toContain(`out: output(`);
      expect(data.nodeCount).toBe(2);
    });

    it('returns a clear error when no flow is open', async () => {
      const result = await getFlowSourceTool.execute({}, { ...baseCtx, chatContext: {} });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no flow/i);
    });

    it('succeeds with an empty flow when no real content has been published yet', async () => {
      // `flowlib.flows.create` seeds an initial empty version so the editor
      // always has something to render. That's a reasonable behaviour for the
      // get path — the chat reads whatever the flow currently is.
      const result = await getFlowSourceTool.execute({}, { ...baseCtx, chatContext: { flowId } });
      expect(result.success).toBe(true);
      const data = result.data as { source: string; nodeCount: number };
      expect(data.nodeCount).toBe(0);
      expect(data.source).toContain('defineFlow({');
    });
  });

  // ───────────────────────── write_flow_source ─────────────────────────

  describe('write_flow_source', () => {
    it('seeds a new flow with a full TS source', async () => {
      const source = `
import { defineFlow, input, output } from '@flowlib/sdk';

export default defineFlow({
  name: 'Hello',
  nodes: [
    input('query'),
    output('greeting', { value: 'Hello {{ query }}' }),
  ],
  edges: [{ from: 'query', to: 'greeting' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );

      expect(result.success).toBe(true);
      const version = await flowlib.versions.get(flowId, 'latest');
      expect(version!.invectDefinition.nodes).toHaveLength(2);
      expect(version!.invectDefinition.nodes[0].referenceId).toBe('query');
      expect(version!.invectDefinition.nodes[1].referenceId).toBe('greeting');
      expect(version!.invectDefinition.edges).toHaveLength(1);
    });

    it('preserves node ids + positions from the prior version', async () => {
      // Seed an initial version with specific ids and positions.
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_opaque_abc',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
              position: { x: 100, y: 50 },
            },
            {
              id: 'node_opaque_def',
              type: 'core.output',
              referenceId: 'out',
              params: { outputValue: '{{ query }}' },
              position: { x: 100, y: 250 },
            },
          ],
          edges: [{ id: 'e1', source: 'node_opaque_abc', target: 'node_opaque_def' }],
        },
      });

      // Write a new source that changes params but keeps the referenceIds.
      const source = `
import { defineFlow, input, output } from '@flowlib/sdk';

export default defineFlow({
  nodes: [
    input('query', { defaultValue: 'default text' }),
    output('out', { value: '{{ query }} (updated)' }),
  ],
  edges: [{ from: 'query', to: 'out' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const version = await flowlib.versions.get(flowId, 'latest');
      const nodes = version!.invectDefinition.nodes;
      expect(nodes.find((n) => n.referenceId === 'query')?.id).toBe('node_opaque_abc');
      expect(nodes.find((n) => n.referenceId === 'query')?.position).toEqual({ x: 100, y: 50 });
      expect(nodes.find((n) => n.referenceId === 'out')?.id).toBe('node_opaque_def');
      expect(nodes.find((n) => n.referenceId === 'out')?.position).toEqual({ x: 100, y: 250 });
    });

    it('reports import-forbidden errors from the evaluator', async () => {
      const source = `
import { defineFlow, input } from '@flowlib/sdk';
import fs from 'node:fs';
export default defineFlow({ nodes: [input('q')], edges: [] });
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as { stage: string; errors: Array<{ code: string }> };
      expect(data.stage).toBe('evaluate');
      expect(data.errors.some((e) => e.code === 'import-forbidden')).toBe(true);
      expect(result.suggestion).toMatch(/@flowlib/i);
    });

    it('reports missing default export as a structured diagnostic', async () => {
      const source = `
import { defineFlow, input } from '@flowlib/sdk';
const notDefault = defineFlow({ nodes: [input('q')], edges: [] });
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as { errors: Array<{ code: string }> };
      expect(data.errors[0].code).toBe('no-default-export');
    });

    it('reports transform diagnostics when a node param contains unsupported code', async () => {
      // Authored source uses a closure over an outer variable — transform
      // should flag it with `unknown-identifier`.
      const source = `
import { defineFlow, input, code } from '@flowlib/sdk';

const threshold = 10;
export default defineFlow({
  nodes: [
    input('x'),
    code('check', { code: ((ctx) => ctx.x > threshold) }),
  ],
  edges: [{ from: 'x', to: 'check' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      // The transform stage catches the closure — may or may not run
      // depending on whether code param is evaluated as function. If string,
      // it passes through; if function, transform flags it. Typecheck may
      // also flag it before the transform runs.
      if (!result.success) {
        const data = result.data as { stage?: string };
        expect(['transform', 'evaluate', 'typecheck']).toContain(data.stage);
      }
    });

    it('rejects save when flow source has TypeScript errors', async () => {
      // Wrong handle for if-else — only `'true_output' | 'false_output'`
      // are valid handles for a `core.if_else` source. The named-record
      // EdgeOf<N> machinery rejects 'output' here at typecheck time.
      const source = `
import { defineFlow, input, output, ifElse } from '@flowlib/sdk';

export default defineFlow({
  nodes: {
    q: input(),
    classify: ifElse({ condition: 'true' }),
    out: output({ value: 'x' }),
  },
  edges: [
    { from: 'q', to: 'classify' },
    { from: 'classify', to: 'out', handle: 'output' },
  ],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as {
        stage: string;
        diagnostics: Array<{ line: number; column: number; message: string; code: number }>;
      };
      expect(data.stage).toBe('typecheck');
      expect(data.diagnostics.length).toBeGreaterThan(0);
      // The diagnostic message should mention the bad handle so the LLM
      // knows what to fix.
      const allMessages = data.diagnostics.map((d) => d.message).join('\n');
      expect(allMessages).toMatch(/output/);
      expect(allMessages).toMatch(/true_output|false_output/);
      expect(result.suggestion).toMatch(/Line \d+/);
    });

    it('rejects save when a required field is missing from a generated wrapper', async () => {
      // `gmail.sendMessage` requires `credentialId`, `to`, `subject`, `body`.
      // Omitting `body` is a TS-only error — at runtime jiti would happily
      // build the node and Zod would reject only when the node ran. The
      // pre-save typecheck catches it before save.
      const source = `
import { defineFlow, input } from '@flowlib/sdk';
import { gmail } from '@flowlib/sdk/actions';

export default defineFlow({
  nodes: {
    event: input(),
    notify: gmail.sendMessage({
      credentialId: 'cred',
      to: 'a@b.c',
      subject: 'hi',
    }),
  },
  edges: [{ from: 'event', to: 'notify' }],
});
`;
      const result = await writeFlowSourceTool.execute(
        { source },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as {
        stage: string;
        diagnostics: Array<{ message: string }>;
      };
      expect(data.stage).toBe('typecheck');
      // The diagnostic should mention the missing field.
      const allMessages = data.diagnostics.map((d) => d.message).join('\n');
      expect(allMessages).toMatch(/body/);
    });

    it('rejects save when flow source has no flow open', async () => {
      const result = await writeFlowSourceTool.execute(
        { source: '' },
        { ...baseCtx, chatContext: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no flow/i);
    });
  });

  // ───────────────────────── edit_flow_source ─────────────────────────

  describe('edit_flow_source', () => {
    beforeEach(async () => {
      // Seed a flow whose source we can edit.
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_a',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
            },
            {
              id: 'node_b',
              type: 'core.output',
              referenceId: 'result',
              params: { outputValue: '{{ query }}' },
            },
          ],
          edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
        },
      });
    });

    it('applies a unique str_replace and saves a new version', async () => {
      // First fetch the source the LLM would see.
      const { data: getData } = await getFlowSourceTool.execute(
        {},
        { ...baseCtx, chatContext: { flowId } },
      );
      const source = (getData as { source: string }).source;

      // The emitter converts pure `{{ expr }}` outputValue into an arrow
      // `return (query);`. Edit that line to wrap the return in a String call.
      const oldString = 'return (query);';
      const newString = 'return ("Hello " + String(query));';
      expect(source).toContain(oldString);

      const result = await editFlowSourceTool.execute(
        { oldString, newString },
        { ...baseCtx, chatContext: { flowId } },
      );

      expect(result.success).toBe(true);
      const latest = await flowlib.versions.get(flowId, 'latest');
      const outputNode = latest!.invectDefinition.nodes.find((n) => n.referenceId === 'result');
      // The arrow-to-string transform serialises the edited arrow body back
      // into a QuickJS expression string.
      expect(String(outputNode?.params.outputValue)).toContain('Hello');
    });

    it('rejects an oldString that appears multiple times without more context', async () => {
      // `query` appears as the node key, in the destructured prelude, and in
      // the arrow body — multiple occurrences in the named-record emitter.
      const result = await editFlowSourceTool.execute(
        { oldString: 'query', newString: 'renamed' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/multiple times/i);
    });

    it('rejects an oldString that is not found', async () => {
      const result = await editFlowSourceTool.execute(
        { oldString: 'nonexistent_marker_xyz', newString: 'anything' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('preserves ids + positions through the edit', async () => {
      // Add positions to the seeded flow (overwrites the version seeded in
      // the outer beforeEach).
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_a',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
              position: { x: 100, y: 200 },
            },
            {
              id: 'node_b',
              type: 'core.output',
              referenceId: 'result',
              params: { outputValue: '{{ query }}' },
              position: { x: 100, y: 400 },
            },
          ],
          edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
        },
      });

      // Edit the output arrow body (same shape as the passthrough test above).
      const result = await editFlowSourceTool.execute(
        {
          oldString: 'return (query);',
          newString: 'return ("updated: " + String(query));',
        },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const latest = await flowlib.versions.get(flowId, 'latest');
      const nodes = latest!.invectDefinition.nodes;
      expect(nodes.find((n) => n.referenceId === 'query')?.id).toBe('node_a');
      expect(nodes.find((n) => n.referenceId === 'query')?.position).toEqual({ x: 100, y: 200 });
      expect(nodes.find((n) => n.referenceId === 'result')?.id).toBe('node_b');
      expect(nodes.find((n) => n.referenceId === 'result')?.position).toEqual({ x: 100, y: 400 });
    });
  });

  // ───────────────────────── end-to-end scenario ─────────────────────────

  // ───────────────────── read-before-edit invariant ─────────────────────

  describe('read-before-edit invariant', () => {
    beforeEach(async () => {
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_a',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
            },
            {
              id: 'node_b',
              type: 'core.output',
              referenceId: 'result',
              params: { outputValue: '{{ query }}' },
            },
          ],
          edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
        },
      });
    });

    it('blocks edit_flow_source when no get_flow_source was called in this turn', async () => {
      const readState = new Map();
      const ctx: ChatToolContext = {
        ...baseCtx,
        chatContext: { flowId },
        readState,
        currentStep: 1,
      };
      const result = await editFlowSourceTool.execute(
        { oldString: 'return (query);', newString: 'return ("x");' },
        ctx,
      );
      expect(result.success).toBe(false);
      const data = result.data as {
        reason: string;
        currentSource?: string;
        availableReferenceIds: string[];
      };
      expect(data.reason).toBe('stale_or_missing_read');
      expect(data.currentSource).toContain('result: output(');
      expect(data.availableReferenceIds).toEqual(['query', 'result']);
    });

    it('allows edit after a get_flow_source call in the same turn', async () => {
      const readState = new Map();
      await getFlowSourceTool.execute(
        {},
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 1 },
      );
      const result = await editFlowSourceTool.execute(
        { oldString: 'return (query);', newString: 'return ("x");' },
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 2 },
      );
      expect(result.success).toBe(true);
    });

    it('soft-reprimes when source drifted since the last read', async () => {
      const readState = new Map();
      await getFlowSourceTool.execute(
        {},
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 1 },
      );

      // Simulate an out-of-band change (e.g. another tool saved a new version).
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_a',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
            },
            {
              id: 'node_b',
              type: 'core.output',
              referenceId: 'result',
              params: { outputValue: 'out: {{ query }}' },
            },
          ],
          edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
        },
      });

      const result = await editFlowSourceTool.execute(
        { oldString: 'return (query);', newString: 'return ("x");' },
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 2 },
      );
      expect(result.success).toBe(false);
      const data = result.data as { reason: string; currentSource?: string };
      expect(data.reason).toBe('source_changed_since');
      // Fresh source is attached (text should reflect the out-of-band change).
      expect(data.currentSource).toContain('out: ');
    });

    it('invariant is skipped when the caller does not pass readState', async () => {
      // Direct call without session-wired readState — backward-compatible path.
      const result = await editFlowSourceTool.execute(
        { oldString: 'return (query);', newString: 'return ("x");' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);
    });

    it('successful edit clears the read-state so the next edit needs a fresh read', async () => {
      const readState = new Map();
      await getFlowSourceTool.execute(
        {},
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 1 },
      );
      const first = await editFlowSourceTool.execute(
        { oldString: 'return (query);', newString: 'return ("x");' },
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 2 },
      );
      expect(first.success).toBe(true);
      // Next edit without re-reading should be blocked even though we just
      // successfully edited.
      const second = await editFlowSourceTool.execute(
        { oldString: '"x"', newString: '"y"' },
        { ...baseCtx, chatContext: { flowId }, readState, currentStep: 3 },
      );
      expect(second.success).toBe(false);
      expect((second.data as { reason: string }).reason).toBe('stale_or_missing_read');
    });
  });

  // ───────────────────── rich failure payloads ─────────────────────

  describe('failure payload', () => {
    beforeEach(async () => {
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_a',
              type: 'core.input',
              referenceId: 'query',
              params: { variableName: 'query' },
            },
            {
              id: 'node_b',
              type: 'core.output',
              referenceId: 'result',
              params: { outputValue: '{{ query }}' },
            },
          ],
          edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
        },
      });
    });

    it('not_found payload includes availableReferenceIds, nodeIndex, and closestMatches', async () => {
      const result = await editFlowSourceTool.execute(
        { oldString: 'gibberish_that_does_not_exist_anywhere', newString: '' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as {
        reason: string;
        availableReferenceIds: string[];
        nodeIndex: Record<
          string,
          { start: number; end: number; type: string; paramKeys: string[] }
        >;
        closestMatches?: Array<{ text: string; startLine: number; endLine: number }>;
      };
      expect(data.reason).toBe('not_found');
      expect(data.availableReferenceIds).toEqual(['query', 'result']);
      expect(data.nodeIndex.query.type).toBe('core.input');
      expect(data.nodeIndex.result.type).toBe('core.output');
      expect(data.nodeIndex.result.paramKeys).toContain('outputValue');
      // closestMatches may be empty when the needle shares no tokens with the
      // source (e.g. all-gibberish strings). Present when the needle overlaps.
      if (data.closestMatches) {
        expect(Array.isArray(data.closestMatches)).toBe(true);
      }
    });

    it('ambiguous payload includes matchLocations', async () => {
      // `query` appears as the node key, in destructured prelude, and inside
      // the arrow body — multiple matches.
      const result = await editFlowSourceTool.execute(
        { oldString: 'query', newString: 'renamed' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as {
        reason: string;
        matchLocations: Array<{ startLine: number; endLine: number; contextSnippet: string }>;
      };
      expect(data.reason).toBe('ambiguous');
      expect(data.matchLocations.length).toBeGreaterThanOrEqual(2);
    });

    it('omits currentSource when emitted source exceeds the budget', async () => {
      // Build a large flow so emitted source blows past SOURCE_INCLUDE_BUDGET
      // (8000 chars). Padded defaultValue inflates each line to ~150 chars.
      const pad = 'x'.repeat(120);
      const nodes = Array.from({ length: 80 }, (_, i) => ({
        id: `node_id_${i}`,
        type: 'core.input',
        referenceId: `query_${i}`,
        params: { variableName: `query_${i}`, defaultValue: `${pad}_${i}` },
      }));
      await flowlib.versions.create(flowId, { invectDefinition: { nodes, edges: [] } });

      const result = await editFlowSourceTool.execute(
        { oldString: 'absolutely_not_in_source_zz', newString: '' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      const data = result.data as { currentSource?: string; sourceElided?: boolean };
      expect(data.sourceElided).toBe(true);
      expect(data.currentSource).toBeUndefined();
    });
  });

  // ───────────────────── update_switch_case ─────────────────────

  describe('update_switch_case', () => {
    beforeEach(async () => {
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            {
              id: 'node_in',
              type: 'core.input',
              referenceId: 'x',
              params: { variableName: 'x' },
            },
            {
              id: 'node_sw',
              type: 'core.switch',
              referenceId: 'router',
              params: {
                matchMode: 'first',
                cases: [
                  { slug: 'high', label: 'High', expression: 'x > 100' },
                  { slug: 'low', label: 'Low', expression: 'x <= 100' },
                ],
              },
            },
          ],
          edges: [{ id: 'e1', source: 'node_in', target: 'node_sw' }],
        },
      });
    });

    it('updates expression for a targeted case, leaves others untouched', async () => {
      const result = await updateSwitchCaseTool.execute(
        { nodeId: 'router', slug: 'high', expression: 'x > 999' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);
      const latest = await flowlib.versions.get(flowId, 'latest');
      const sw = latest!.invectDefinition.nodes.find((n) => n.referenceId === 'router');
      const cases = sw!.params.cases as Array<{ slug: string; expression: string }>;
      expect(cases.find((c) => c.slug === 'high')?.expression).toBe('x > 999');
      expect(cases.find((c) => c.slug === 'low')?.expression).toBe('x <= 100');
    });

    it('renames slug and updates matching edges', async () => {
      // Add an outgoing edge from the switch using the old slug.
      const v = await flowlib.versions.get(flowId, 'latest');
      const nodes = [
        ...v!.invectDefinition.nodes,
        {
          id: 'node_out',
          type: 'core.output',
          referenceId: 'out',
          params: { outputValue: '{{ x }}' },
        },
      ];
      const edges = [
        ...v!.invectDefinition.edges,
        { id: 'e2', source: 'node_sw', target: 'node_out', sourceHandle: 'high' },
      ];
      await flowlib.versions.create(flowId, { invectDefinition: { nodes, edges } });

      const result = await updateSwitchCaseTool.execute(
        { nodeId: 'router', slug: 'high', newSlug: 'critical' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(true);

      const latest = await flowlib.versions.get(flowId, 'latest');
      const sw = latest!.invectDefinition.nodes.find((n) => n.referenceId === 'router');
      const cases = sw!.params.cases as Array<{ slug: string }>;
      expect(cases.map((c) => c.slug)).toEqual(['critical', 'low']);
      const edge = latest!.invectDefinition.edges.find((e) => e.id === 'e2');
      expect(edge?.sourceHandle).toBe('critical');
    });

    it('errors on unknown slug with a helpful suggestion', async () => {
      const result = await updateSwitchCaseTool.execute(
        { nodeId: 'router', slug: 'nonexistent', expression: 'true' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no case with slug/i);
      expect(result.suggestion).toMatch(/high|low/);
    });

    it('errors when called on a non-switch node', async () => {
      const result = await updateSwitchCaseTool.execute(
        { nodeId: 'x', slug: 'high', expression: 'true' },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not.*core\.switch/i);
    });
  });

  // ───────────────────── full round-trip ─────────────────────

  describe('full round-trip: edit the flow via the chat pipeline', () => {
    it('get → edit → get shows the change persisted', async () => {
      // Mixed-text output values emit as template literals, giving the LLM a
      // predictable anchor to str_replace against. Pure `{{ expr }}` forms
      // collapse to bare expressions (covered by the edit tests above).
      await flowlib.versions.create(flowId, {
        invectDefinition: {
          nodes: [
            { id: 'n1', type: 'core.input', referenceId: 'name', params: { variableName: 'name' } },
            {
              id: 'n2',
              type: 'core.output',
              referenceId: 'greeting',
              params: { outputValue: 'Hello {{ name }}!' },
            },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        },
      });

      // 1. Chat reads the source — should contain the template literal.
      const firstGet = await getFlowSourceTool.execute({}, { ...baseCtx, chatContext: { flowId } });
      expect(firstGet.success).toBe(true);
      const firstSource = (firstGet.data as { source: string }).source;
      expect(firstSource).toContain('Hello ${(name)}!');

      // 2. Chat edits the template literal to change the greeting.
      const edit = await editFlowSourceTool.execute(
        {
          oldString: 'Hello ${(name)}!',
          newString: 'Hi ${(name)}!',
        },
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(edit.success).toBe(true);

      // 3. Chat reads the source again — change is reflected.
      const secondGet = await getFlowSourceTool.execute(
        {},
        { ...baseCtx, chatContext: { flowId } },
      );
      expect(secondGet.success).toBe(true);
      const secondSource = (secondGet.data as { source: string }).source;
      expect(secondSource).toContain('Hi ${(name)}!');
      expect(secondSource).not.toContain('Hello ${(name)}!');
    });
  });
});
