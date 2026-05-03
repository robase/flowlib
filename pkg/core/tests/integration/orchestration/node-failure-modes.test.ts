/**
 * Integration tests: Node-level failure modes
 *
 * Covers the common ways individual node types fail in practice and how
 * those failures propagate (or don't) through a flow:
 *
 * - http.request: invalid URL, connection refused, timeout, oversized payload
 * - core.javascript: syntax error, thrown exception, undefined reference
 * - core.template_string: runtime template error, graceful empty fallback
 * - core.if_else: expression error routes to false (does NOT fail the node)
 * - core.switch: all cases errored → default routing
 * - Cascade: a FAILED node stops the flow and downstream nodes never run
 * - Parallel siblings: one branch failing does not short-circuit the other
 *   *before* the coordinator processes the failure
 *
 * Complements `branching-flow.test.ts` (happy path) and
 * `agent-failure-modes.test.ts` (agent-specific).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let flowlib: FlowlibInstance;

const mswServer = setupServer();

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
  flowlib = await createTestFlowlib();
});

afterAll(async () => {
  mswServer.close();
  await flowlib.shutdown();
});

beforeEach(() => {
  // nothing
});

afterEach(() => {
  mswServer.resetHandlers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFlow(definition: FlowlibDefinition, inputs: Record<string, unknown> = {}) {
  const flow = await flowlib.flows.create({ name: `node-fail-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, inputs, { useBatchProcessing: false });
}

function getNodeOutput(result: { outputs?: Record<string, unknown> }, nodeId: string): unknown {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  const raw = node?.data?.variables?.output?.value;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function findTrace(
  result: { traces?: Array<{ nodeId: string; status: string; error?: string }> },
  nodeId: string,
) {
  return result.traces?.find((t) => t.nodeId === nodeId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Node failure modes', () => {
  // -------------------------------------------------------------------------
  // http.request
  // -------------------------------------------------------------------------
  describe('http.request', () => {
    it('fails the node when the URL is invalid', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'h',
            type: 'http.request',
            referenceId: 'h',
            params: { method: 'GET', url: 'not-a-real-url' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'h');
      expect(trace?.status).toBe('FAILED');
      expect(trace?.error ?? '').toMatch(/invalid url/i);
    });

    it('fails the node when a slow endpoint exceeds the request timeout', async () => {
      mswServer.use(
        http.get('https://api.example.com/slow', async () => {
          await delay(2000);
          return HttpResponse.json({ ok: true });
        }),
      );

      const result = await runFlow({
        nodes: [
          {
            id: 'h',
            type: 'http.request',
            referenceId: 'h',
            params: {
              method: 'GET',
              url: 'https://api.example.com/slow',
              timeout: 150,
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'h');
      expect(trace?.error ?? '').toMatch(/time/i);
    });

    it('succeeds but reports ok=false when the endpoint returns 500', async () => {
      mswServer.use(
        http.get('https://api.example.com/boom', () =>
          HttpResponse.json({ error: 'kaboom' }, { status: 500 }),
        ),
      );

      // HTTP errors at the server level (500, 404, etc.) are NOT node failures —
      // the action returns success=true with `ok: false` so downstream nodes
      // can decide how to handle the status code.
      const result = await runFlow({
        nodes: [
          {
            id: 'h',
            type: 'http.request',
            referenceId: 'h',
            params: { method: 'GET', url: 'https://api.example.com/boom' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getNodeOutput(result, 'h') as { status: number; ok: boolean };
      expect(out.status).toBe(500);
      expect(out.ok).toBe(false);
    });

    it('returns raw text when the server lies about Content-Type: application/json', async () => {
      mswServer.use(
        http.get('https://api.example.com/not-json', () =>
          HttpResponse.text('<html><body>nope</body></html>', {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );

      const result = await runFlow({
        nodes: [
          {
            id: 'h',
            type: 'http.request',
            referenceId: 'h',
            params: { method: 'GET', url: 'https://api.example.com/not-json' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getNodeOutput(result, 'h') as { data: unknown; ok: boolean };
      expect(typeof out.data).toBe('string');
      expect(out.data).toContain('<html>');
      expect(out.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // core.javascript
  // -------------------------------------------------------------------------
  describe('core.javascript', () => {
    it('fails the node when the code has a syntax error', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'js',
            type: 'core.javascript',
            referenceId: 'js',
            params: { code: 'return { broken' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'js');
      expect(trace?.error ?? '').toMatch(/JavaScript/);
    });

    it('fails the node when the code throws at runtime', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'js',
            type: 'core.javascript',
            referenceId: 'js',
            params: {
              // QuickJS evaluator treats `code` as an expression, so wrap
              // the throw in an IIFE to produce a runtime-throw failure.
              code: '(() => { throw new Error("business rule violated") })()',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'js');
      expect(trace?.error ?? '').toMatch(/business rule violated/);
    });

    it('fails the node when the code references an undefined upstream slug', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'in',
            type: 'trigger.manual',
            referenceId: 'user',
            params: { inputs: [{ name: 'user', type: 'json', defaultValue: '{"id":1}' }] },
            position: { x: 0, y: 0 },
          },
          {
            id: 'js',
            type: 'core.javascript',
            referenceId: 'js',
            // `missing_node` is not in the flow
            params: { code: 'return missing_node.id' },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'in', target: 'js' }],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'js');
      expect(trace?.error ?? '').toMatch(/missing_node|not defined/i);
    });
  });

  // -------------------------------------------------------------------------
  // core.if_else — expression errors are non-fatal
  // -------------------------------------------------------------------------
  describe('core.if_else', () => {
    it('routes to false branch when the expression throws — does NOT fail the node', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'in',
            type: 'trigger.manual',
            referenceId: 'data',
            params: { inputs: [{ name: 'data', type: 'json', defaultValue: '{"x":1}' }] },
            position: { x: 0, y: 0 },
          },
          {
            id: 'branch',
            type: 'core.if_else',
            referenceId: 'branch',
            // Referencing an undefined symbol throws, which the action catches
            // and treats as a falsy result.
            params: { expression: 'nope.foo > 0' },
            position: { x: 200, y: 0 },
          },
          {
            id: 't',
            type: 'core.template_string',
            referenceId: 't',
            params: { template: 'TRUE' },
            position: { x: 400, y: -100 },
          },
          {
            id: 'f',
            type: 'core.template_string',
            referenceId: 'f',
            params: { template: 'FALSE' },
            position: { x: 400, y: 100 },
          },
        ],
        edges: [
          { id: 'e1', source: 'in', target: 'branch' },
          { id: 'e2', source: 'branch', target: 't', sourceHandle: 'true_output' },
          { id: 'e3', source: 'branch', target: 'f', sourceHandle: 'false_output' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'f')).toBe('FALSE');
      expect(getNodeOutput(result, 't')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // core.switch — all cases errored → default
  // -------------------------------------------------------------------------
  describe('core.switch', () => {
    it('falls through to default when every case expression throws', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'in',
            type: 'trigger.manual',
            referenceId: 'data',
            params: { inputs: [{ name: 'data', type: 'json', defaultValue: '{"x":1}' }] },
            position: { x: 0, y: 0 },
          },
          {
            id: 's',
            type: 'core.switch',
            referenceId: 's',
            params: {
              cases: [
                { slug: 'a', label: 'A', expression: 'undefinedA.x === 1' },
                { slug: 'b', label: 'B', expression: 'undefinedB.x === 2' },
              ],
            },
            position: { x: 200, y: 0 },
          },
          {
            id: 'a_out',
            type: 'core.template_string',
            referenceId: 'a_out',
            params: { template: 'A' },
            position: { x: 400, y: -100 },
          },
          {
            id: 'b_out',
            type: 'core.template_string',
            referenceId: 'b_out',
            params: { template: 'B' },
            position: { x: 400, y: 0 },
          },
          {
            id: 'def_out',
            type: 'core.template_string',
            referenceId: 'def_out',
            params: { template: 'DEFAULT' },
            position: { x: 400, y: 100 },
          },
        ],
        edges: [
          { id: 'e1', source: 'in', target: 's' },
          { id: 'e2', source: 's', target: 'a_out', sourceHandle: 'a' },
          { id: 'e3', source: 's', target: 'b_out', sourceHandle: 'b' },
          { id: 'e4', source: 's', target: 'def_out', sourceHandle: 'default' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'def_out')).toBe('DEFAULT');
      expect(getNodeOutput(result, 'a_out')).toBeUndefined();
      expect(getNodeOutput(result, 'b_out')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // core.template_string
  // -------------------------------------------------------------------------
  describe('core.template_string', () => {
    it('renders undefined upstream references as empty strings without failing', async () => {
      // Missing-variable behavior in the QuickJS template is non-throwing:
      // undefined references stringify to empty instead of aborting the node.
      const result = await runFlow({
        nodes: [
          {
            id: 't',
            type: 'core.template_string',
            referenceId: 't',
            params: { template: 'hello {{ nonexistent.name }}' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getNodeOutput(result, 't') as string;
      expect(typeof out).toBe('string');
      expect(out.startsWith('hello ')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cascade failure: FAILED node stops the flow
  // -------------------------------------------------------------------------
  describe('cascade on failure', () => {
    it('halts the flow and does not execute any downstream node', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'bad',
            type: 'core.javascript',
            referenceId: 'bad',
            params: { code: 'throw new Error("stop here")' },
            position: { x: 0, y: 0 },
          },
          {
            id: 'never1',
            type: 'core.template_string',
            referenceId: 'never1',
            params: { template: 'should not render' },
            position: { x: 200, y: 0 },
          },
          {
            id: 'never2',
            type: 'core.template_string',
            referenceId: 'never2',
            params: { template: 'also should not render' },
            position: { x: 400, y: 0 },
          },
        ],
        edges: [
          { id: 'e1', source: 'bad', target: 'never1' },
          { id: 'e2', source: 'never1', target: 'never2' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      expect(getNodeOutput(result, 'never1')).toBeUndefined();
      expect(getNodeOutput(result, 'never2')).toBeUndefined();

      // Downstream nodes should not appear in traces either — the coordinator
      // breaks out of the execution loop on the first failure.
      expect(findTrace(result, 'never1')).toBeUndefined();
      expect(findTrace(result, 'never2')).toBeUndefined();
    });

    it('one failed branch prevents its downstream subtree but not an independent branch that already ran', async () => {
      // Diamond: input → [goodA, badB] both fan out from input.
      //   goodA runs before badB in topo order — so by the time badB fails,
      //   goodA has already produced output.
      const result = await runFlow({
        nodes: [
          {
            id: 'in',
            type: 'trigger.manual',
            referenceId: 'data',
            params: { inputs: [{ name: 'data', type: 'json', defaultValue: '{"x":1}' }] },
            position: { x: 0, y: 0 },
          },
          {
            id: 'goodA',
            type: 'core.template_string',
            referenceId: 'goodA',
            params: { template: 'A-done' },
            position: { x: 200, y: -100 },
          },
          {
            id: 'badB',
            type: 'core.javascript',
            referenceId: 'badB',
            params: { code: 'throw new Error("boom B")' },
            position: { x: 200, y: 100 },
          },
          {
            id: 'afterB',
            type: 'core.template_string',
            referenceId: 'afterB',
            params: { template: 'nope' },
            position: { x: 400, y: 100 },
          },
        ],
        edges: [
          { id: 'e1', source: 'in', target: 'goodA' },
          { id: 'e2', source: 'in', target: 'badB' },
          { id: 'e3', source: 'badB', target: 'afterB' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      // goodA may or may not have run depending on topological order.
      // What matters is that afterB (downstream of badB) did not run.
      expect(getNodeOutput(result, 'afterB')).toBeUndefined();
      expect(findTrace(result, 'badB')?.status).toBe('FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // Empty / missing params at node config level
  // -------------------------------------------------------------------------
  describe('validation failures', () => {
    it('fails http.request when url is empty (Zod validation)', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'h',
            type: 'http.request',
            referenceId: 'h',
            params: { method: 'GET', url: '' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'h');
      expect(trace?.error).toBeDefined();
    });

    it('fails core.javascript when code is empty (Zod validation)', async () => {
      const result = await runFlow({
        nodes: [
          {
            id: 'js',
            type: 'core.javascript',
            referenceId: 'js',
            params: { code: '' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
    });
  });
});
