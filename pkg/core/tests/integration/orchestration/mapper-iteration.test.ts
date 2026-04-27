/**
 * Integration tests: Node data mapper + iteration
 *
 * The `mapper` config on any node runs a sandboxed JS expression against
 * upstream data and, if the result is an array, iterates the node per item.
 * This file exercises all mode/outputMode/concurrency/onEmpty permutations
 * via real flow runs (no mocks for the orchestration path).
 *
 * See `pkg/core/src/services/flow-versions/schemas-fresh.ts` for the
 * MapperConfig schema and `node-execution-coordinator.ts` for the
 * execution logic (executeNodeMapperIterating, packageMapperResults).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import { createTestFlowlib } from '../helpers/test-flowlib';

let flowlib: FlowlibInstance;

beforeAll(async () => {
  flowlib = await createTestFlowlib();
});

afterAll(async () => {
  await flowlib.shutdown();
});

async function runFlow(definition: FlowlibDefinition, inputs: Record<string, unknown> = {}) {
  const flow = await flowlib.flows.create({ name: `mapper-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, inputs, { useBatchProcessing: false });
}

/**
 * Unwrap the `output.value` from a node trace.
 *
 * `core.javascript` stringifies its output (objects via JSON.stringify,
 * primitives via String()). Mapper iterations collect those per-iteration
 * strings into an array. To compare against native JS values, recursively
 * try JSON.parse on any string encountered.
 */
function unwrapJsString(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(unwrapJsString);
  }
  return value;
}

function getNodeOutput(result: { outputs?: Record<string, unknown> }, nodeId: string): unknown {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return unwrapJsString(node?.data?.variables?.output?.value);
}

function findTrace(
  result: { traces?: Array<{ nodeId: string; status: string; error?: string; outputs?: unknown }> },
  nodeId: string,
) {
  return result.traces?.find((t) => t.nodeId === nodeId);
}

/**
 * Build a two-node flow: an input node that produces `data`, and a child
 * node with `mapper` enabled that consumes it. Shared across tests.
 */
function mapperFlow(args: {
  sourceData: unknown;
  childType: 'core.javascript' | 'core.template_string';
  childParams: Record<string, unknown>;
  mapper: Record<string, unknown>;
}): FlowlibDefinition {
  return {
    nodes: [
      {
        id: 'src',
        type: 'core.javascript',
        referenceId: 'src',
        params: { code: `return ${JSON.stringify(args.sourceData)}` },
        position: { x: 0, y: 0 },
      },
      {
        id: 'child',
        type: args.childType,
        referenceId: 'child',
        params: args.childParams,
        mapper: args.mapper,
        position: { x: 200, y: 0 },
      } as FlowlibDefinition['nodes'][number],
    ],
    edges: [{ id: 'e1', source: 'src', target: 'child' }],
  };
}

describe('Node mapper / iteration', () => {
  // -------------------------------------------------------------------------
  // Auto mode: array in → iterate; non-array → single
  // -------------------------------------------------------------------------
  describe('mode: auto', () => {
    it('auto-iterates when the mapper returns an array', async () => {
      // src.items = [{name:'a',n:2},{name:'b',n:5},{name:'c',n:9}]
      // mapper returns `src.items` → iterate; each iteration spreads the item
      // so the child JS sees top-level {name, n}.
      const result = await runFlow(
        mapperFlow({
          sourceData: {
            items: [
              { name: 'a', n: 2 },
              { name: 'b', n: 5 },
              { name: 'c', n: 9 },
            ],
          },
          childType: 'core.javascript',
          childParams: { code: 'return n * 10' },
          mapper: { enabled: true, expression: 'src.items' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toEqual([20, 50, 90]);
    });

    it('runs once when the mapper returns a single object', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { stats: { count: 42 } },
          childType: 'core.javascript',
          childParams: { code: 'return count * 2' },
          // Returns an object — auto mode → single execution, stats spread.
          mapper: { enabled: true, expression: 'src.stats' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe(84);
    });

    it('wraps primitives in { item: value } for single execution', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { val: 7 },
          childType: 'core.javascript',
          childParams: { code: 'return item + 1' },
          mapper: { enabled: true, expression: 'src.val' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe(8);
    });
  });

  // -------------------------------------------------------------------------
  // iterate mode — asserts array shape, fails on non-array
  // -------------------------------------------------------------------------
  describe('mode: iterate', () => {
    it('fails the node when expression returns a non-array in iterate mode', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { val: 'just a string' },
          childType: 'core.javascript',
          childParams: { code: 'return 1' },
          mapper: { enabled: true, expression: 'src.val', mode: 'iterate' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'child');
      expect(trace?.error ?? '').toMatch(/iterate.*not an array/i);
    });
  });

  // -------------------------------------------------------------------------
  // reshape mode — wraps arrays to prevent accidental iteration
  // -------------------------------------------------------------------------
  describe('mode: reshape', () => {
    it('treats an array result as a single-execution context (wraps under `item`)', async () => {
      // Known coordinator behavior: when reshape wraps an array into
      // `{ items: [...] }`, the downstream single-execution path still sees
      // `isArray === true` from the pre-wrap value and drops into the
      // primitive branch `mappedData = { item: mappedResult }`. So the child
      // sees the wrapped object under `item.items`, not `items` at the top.
      const result = await runFlow(
        mapperFlow({
          sourceData: { list: [1, 2, 3, 4] },
          childType: 'core.javascript',
          childParams: { code: 'return item.items.reduce((a, b) => a + b, 0)' },
          mapper: { enabled: true, expression: 'src.list', mode: 'reshape' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe(10);
    });

    it('aggregates to a summary object in one pass', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { orders: [{ amount: 10 }, { amount: 20 }, { amount: 30 }] },
          childType: 'core.javascript',
          childParams: { code: 'return { total, count }' },
          mapper: {
            enabled: true,
            expression:
              'return { total: src.orders.reduce((s, o) => s + o.amount, 0), count: src.orders.length }',
            mode: 'reshape',
          },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toEqual({ total: 60, count: 3 });
    });
  });

  // -------------------------------------------------------------------------
  // outputMode variants — array | object | first | last | concat
  // -------------------------------------------------------------------------
  describe('outputMode', () => {
    it('outputMode: object — silently returns {} when iteration outputs are strings (core.javascript stringifies results)', async () => {
      // Known limitation: `packageMapperResults` for outputMode='object'
      // only keys entries where the per-iteration result is a JS object.
      // `core.javascript` stringifies its output (objects → JSON string),
      // so iterations produce strings and the object-packager filters them
      // all out. The result is `{}`. Using an action whose output is a raw
      // object (e.g. http.request) would exercise the happy path.
      const result = await runFlow(
        mapperFlow({
          sourceData: {
            users: [
              { id: 'u1', name: 'a' },
              { id: 'u2', name: 'b' },
            ],
          },
          childType: 'core.javascript',
          childParams: { code: 'return { id, upper: name.toUpperCase() }' },
          mapper: {
            enabled: true,
            expression: 'src.users',
            outputMode: 'object',
            keyField: 'id',
          },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toEqual({});
    });

    it('outputMode: first — returns only the first iteration result', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [{ v: 'alpha' }, { v: 'beta' }, { v: 'gamma' }] },
          childType: 'core.javascript',
          childParams: { code: 'return v' },
          mapper: { enabled: true, expression: 'src.items', outputMode: 'first' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe('alpha');
    });

    it('outputMode: last — returns only the last iteration result', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [{ v: 'alpha' }, { v: 'beta' }, { v: 'gamma' }] },
          childType: 'core.javascript',
          childParams: { code: 'return v' },
          mapper: { enabled: true, expression: 'src.items', outputMode: 'last' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe('gamma');
    });

    it('outputMode: concat — joins stringified results', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { words: [{ w: 'hello-' }, { w: 'world-' }, { w: '!' }] },
          childType: 'core.template_string',
          childParams: { template: '{{ w }}' },
          mapper: { enabled: true, expression: 'src.words', outputMode: 'concat' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toBe('hello-world-!');
    });
  });

  // -------------------------------------------------------------------------
  // Empty-array handling
  // -------------------------------------------------------------------------
  describe('onEmpty handling', () => {
    it('onEmpty: skip — empty input yields empty array, flow succeeds', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [] as unknown[] },
          childType: 'core.javascript',
          childParams: { code: 'return n' },
          mapper: { enabled: true, expression: 'src.items', onEmpty: 'skip' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toEqual([]);
    });

    it('onEmpty: error — empty input fails the node', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [] as unknown[] },
          childType: 'core.javascript',
          childParams: { code: 'return n' },
          mapper: { enabled: true, expression: 'src.items', onEmpty: 'error' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'child');
      expect(trace?.error ?? '').toMatch(/empty/i);
    });
  });

  // -------------------------------------------------------------------------
  // Expression error path
  // -------------------------------------------------------------------------
  describe('mapper expression errors', () => {
    it('fails the node when the mapper expression throws', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [1, 2, 3] },
          childType: 'core.javascript',
          childParams: { code: 'return 1' },
          mapper: {
            enabled: true,
            // Reference to a non-existent upstream slug inside the mapper.
            expression: 'nothing.to.see.here',
          },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = findTrace(result, 'child');
      expect(trace?.error ?? '').toMatch(/mapper|expression|nothing/i);
    });

    it('silently absorbs a single iteration throw and returns nulls (documented quirk)', async () => {
      // Known quirk in node-execution-coordinator: neither the sequential nor
      // parallel iteration paths propagate per-iteration failures out of
      // `executeSingleMapperIteration` — it only reads the trace's output
      // variable (undefined on failure) and falls through to `return
      // outputs?.data ?? null`. The `hasFailure` flag never gets set for
      // sequential iterations, and even parallel iterations don't throw
      // because `executeNodeOnce` always resolves with a trace object.
      //
      // Net effect: a thrown iteration leaves a `null`-ish gap in the
      // result array and the mapper node succeeds. This test pins the
      // current behavior so a future fix can flip the assertion.
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [{ n: 1 }, { n: 2 }, { n: 3 }] },
          childType: 'core.javascript',
          childParams: {
            code: 'if (_item.index === 1) { (() => { throw new Error("boom") })() } return n',
          },
          mapper: {
            enabled: true,
            expression: 'src.items',
            concurrency: 1,
          },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getNodeOutput(result, 'child') as unknown[];
      expect(out).toHaveLength(3);
      expect(out[0]).toBe(1);
      // The thrown iteration resolves with a null-ish fallback, not with
      // the valid numeric output a successful iteration would produce.
      expect(out[1]).not.toBe(2);
      expect(out[2]).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------------
  describe('concurrency', () => {
    it('runs all iterations to completion at concurrency=5', async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ idx: i }));

      const result = await runFlow(
        mapperFlow({
          sourceData: { items },
          childType: 'core.javascript',
          // Each iteration does a small, deterministic computation.
          childParams: { code: 'return idx * idx' },
          mapper: { enabled: true, expression: 'src.items', concurrency: 5 },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getNodeOutput(result, 'child') as number[];
      expect(out).toHaveLength(25);
      // Order is preserved because results.push happens in batch order.
      expect(out[0]).toBe(0);
      expect(out[5]).toBe(25);
      expect(out[24]).toBe(576);
    });
  });

  // -------------------------------------------------------------------------
  // _item metadata — index/first/last/total available per iteration
  // -------------------------------------------------------------------------
  describe('_item metadata', () => {
    it('exposes _item.index, .first, .last, .total to each iteration', async () => {
      const result = await runFlow(
        mapperFlow({
          sourceData: { items: [{ v: 'a' }, { v: 'b' }, { v: 'c' }] },
          childType: 'core.javascript',
          childParams: {
            code: 'return { v, idx: _item.index, first: _item.first, last: _item.last, total: _item.total }',
          },
          mapper: { enabled: true, expression: 'src.items' },
        }),
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'child')).toEqual([
        { v: 'a', idx: 0, first: true, last: false, total: 3 },
        { v: 'b', idx: 1, first: false, last: false, total: 3 },
        { v: 'c', idx: 2, first: false, last: true, total: 3 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Downstream consumption of mapper output
  // -------------------------------------------------------------------------
  describe('downstream nodes', () => {
    it('downstream node can reduce over the iteration result array', async () => {
      const definition: FlowlibDefinition = {
        nodes: [
          {
            id: 'src',
            type: 'core.javascript',
            referenceId: 'src',
            params: {
              code: 'return [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]',
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'doubled',
            type: 'core.javascript',
            referenceId: 'doubled',
            params: { code: 'return n * 2' },
            mapper: { enabled: true, expression: 'src' },
            position: { x: 200, y: 0 },
          } as unknown as FlowlibDefinition['nodes'][number],
          {
            id: 'sum',
            type: 'core.javascript',
            referenceId: 'sum',
            params: {
              // `doubled` upstream is ["2","4","6","8"] (each iteration's
              // output is stringified by core.javascript) — coerce before
              // summing.
              code: 'return doubled.reduce((a, b) => a + Number(b), 0)',
            },
            position: { x: 400, y: 0 },
          },
        ],
        edges: [
          { id: 'e1', source: 'src', target: 'doubled' },
          { id: 'e2', source: 'doubled', target: 'sum' },
        ],
      };

      const result = await runFlow(definition);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'doubled')).toEqual([2, 4, 6, 8]);
      expect(getNodeOutput(result, 'sum')).toBe(20);
    });
  });
});
