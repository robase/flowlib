/**
 * Integration tests: Parallel flow execution (ready-set scheduler)
 *
 * The ready-set scheduler is the default execution path. These tests skip
 * only if it's been explicitly disabled (`FLOWLIB_PARALLEL_SCHEDULER=0`),
 * since the timing assertions assume concurrent execution.
 *
 * Implementation note: all tests share a single Flowlib instance. There is a
 * pre-existing test-isolation issue with `createTestFlowlib` where successive
 * instances within the same vitest worker can produce inconsistent template
 * resolution. Sharing one instance dodges that and isn't load-bearing for
 * what we're testing here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { NodeOutput } from '../../../src/types/node-io-types';
import type { FlowlibPlugin, NodeExecutionHookContext } from '../../../src/types/plugin.types';
import { createTestFlowlib } from '../helpers/test-flowlib';

const PARALLEL_ENABLED = process.env.FLOWLIB_PARALLEL_SCHEDULER !== '0';
const skipOrDescribe = PARALLEL_ENABLED ? describe : describe.skip;

/**
 * Per-test delay map. Mutated before each test that needs deterministic
 * timing; the shared plugin reads from it on every `beforeNodeExecute`.
 */
const delays: Record<string, number> = {};

const delayPlugin: FlowlibPlugin = {
  id: 'test-delay',
  name: 'Test Delay',
  hooks: {
    beforeNodeExecute: async (ctx: NodeExecutionHookContext) => {
      const ms = delays[ctx.nodeId];
      if (ms && ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    },
  },
};

function setDelays(map: Record<string, number>): void {
  for (const k of Object.keys(delays)) {
    delete delays[k];
  }
  Object.assign(delays, map);
}

function tmplNode(id: string, template: string, position = { x: 0, y: 0 }) {
  return {
    id,
    type: 'core.template_string',
    referenceId: id,
    label: id,
    params: { template },
    position,
  };
}

function inputNode(id: string, value: unknown) {
  return {
    id,
    type: 'core.input',
    referenceId: id,
    label: id,
    params: { variableName: id, defaultValue: JSON.stringify(value) },
    position: { x: 0, y: 0 },
  };
}

function getOutputString(result: { outputs?: Record<string, unknown> }, nodeId: string): string {
  const node = result.outputs?.[nodeId] as NodeOutput | undefined;
  if (!node) {
    return '';
  }
  const vars = node.data.variables as Record<string, { value?: unknown }>;
  const raw = vars.output?.value;
  return typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
}

skipOrDescribe('Parallel flow execution (ready-set scheduler)', () => {
  let flowlib: FlowlibInstance;

  beforeAll(async () => {
    flowlib = await createTestFlowlib({ plugins: [delayPlugin] });
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  async function runDef(name: string, definition: FlowlibDefinition) {
    const flow = await flowlib.flows.create({ name: `${name}-${Date.now()}` });
    await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
    return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
  }

  it('runs two siblings concurrently (wall time ≪ sum of delays)', async () => {
    setDelays({ left: 200, right: 200 });
    const t0 = Date.now();
    const result = await runDef('parallel-siblings', {
      nodes: [inputNode('a', 'start'), tmplNode('left', 'L'), tmplNode('right', 'R')],
      edges: [
        { id: 'a-l', source: 'a', target: 'left' },
        { id: 'a-r', source: 'a', target: 'right' },
      ],
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getOutputString(result, 'left')).toBe('L');
    expect(getOutputString(result, 'right')).toBe('R');
    // Sequential: ~400ms. Parallel: ~220ms (with overhead). Generous
    // headroom for CI noise while still catching serialization.
    expect(elapsed).toBeLessThan(450);
  });

  it('diamond convergence: node waits for both parents', async () => {
    setDelays({ left: 150, right: 150 });
    const result = await runDef('parallel-diamond', {
      nodes: [
        inputNode('a', 'start'),
        tmplNode('left', 'L'),
        tmplNode('right', 'R'),
        tmplNode('merge', 'L={{ left }}|R={{ right }}'),
      ],
      edges: [
        { id: 'a-l', source: 'a', target: 'left' },
        { id: 'a-r', source: 'a', target: 'right' },
        { id: 'l-m', source: 'left', target: 'merge' },
        { id: 'r-m', source: 'right', target: 'merge' },
      ],
    });
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    const merged = getOutputString(result, 'merge');
    expect(merged).toContain('L=L');
    expect(merged).toContain('R=R');
  });

  it('long chain does not block short chain (chains pipeline independently)', async () => {
    // Long chain: long1 → long2 → long3 (3 × 100ms = 300ms)
    // Short chain: short1 → short2          (2 × 100ms = 200ms)
    // In a barrier-style level scheduler, short2 would wait at the level-3
    // barrier for long3 to complete. In a ready-set scheduler, short2
    // proceeds independently and end converges only when both terminal.
    setDelays({ long1: 100, long2: 100, long3: 100, short1: 100, short2: 100 });
    const t0 = Date.now();
    const result = await runDef('parallel-chains', {
      nodes: [
        inputNode('a', 'start'),
        tmplNode('long1', 'X1'),
        tmplNode('long2', '{{ long1 }}-X2'),
        tmplNode('long3', '{{ long2 }}-X3'),
        tmplNode('short1', 'Y1'),
        tmplNode('short2', '{{ short1 }}-Y2'),
        tmplNode('end', 'long={{ long3 }}|short={{ short2 }}'),
      ],
      edges: [
        { id: 'a-l1', source: 'a', target: 'long1' },
        { id: 'a-s1', source: 'a', target: 'short1' },
        { id: 'l1-l2', source: 'long1', target: 'long2' },
        { id: 'l2-l3', source: 'long2', target: 'long3' },
        { id: 's1-s2', source: 'short1', target: 'short2' },
        { id: 'l3-end', source: 'long3', target: 'end' },
        { id: 's2-end', source: 'short2', target: 'end' },
      ],
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    const end = getOutputString(result, 'end');
    expect(end).toContain('long=X1-X2-X3');
    expect(end).toContain('short=Y1-Y2');

    // Sequential topological: 5 × 100 + overhead ≈ 500+ms.
    // Fully pipelined: max(long-chain=300, short-chain=200) + end ≈ 300-350ms.
    expect(elapsed).toBeLessThan(480);
  });

  it('one sibling failing does not prevent an in-flight sibling from completing', async () => {
    setDelays({});
    const result = await runDef('parallel-failure', {
      nodes: [
        inputNode('a', 'start'),
        {
          id: 'boom',
          type: 'core.javascript',
          referenceId: 'boom',
          label: 'boom',
          params: { code: 'throw new Error("intentional failure")' },
          position: { x: 0, y: 0 },
        },
        tmplNode('survivor', 'S'),
      ],
      edges: [
        { id: 'a-boom', source: 'a', target: 'boom' },
        { id: 'a-surv', source: 'a', target: 'survivor' },
      ],
    });
    expect(result.status).toBe(FlowRunStatus.FAILED);
    // The non-failing sibling should have finished — it was launched
    // alongside `boom` before either reported.
    expect(getOutputString(result, 'survivor')).toBe('S');
  });

  it('branch + parallel downstream: multiple targets on the active handle run in parallel', async () => {
    setDelays({ branchT1: 100, branchT2: 100 });
    const t0 = Date.now();
    const result = await runDef('parallel-branch', {
      nodes: [
        inputNode('a', { value: 100 }),
        {
          id: 'gate',
          type: 'core.if_else',
          referenceId: 'gate',
          label: 'gate',
          params: { expression: 'a.value > 50' },
          position: { x: 0, y: 0 },
        },
        tmplNode('branchT1', 'T1'),
        tmplNode('branchT2', 'T2'),
        tmplNode('branchF', 'F'),
      ],
      edges: [
        { id: 'a-g', source: 'a', target: 'gate' },
        { id: 'g-t1', source: 'gate', target: 'branchT1', sourceHandle: 'true_output' },
        { id: 'g-t2', source: 'gate', target: 'branchT2', sourceHandle: 'true_output' },
        { id: 'g-f', source: 'gate', target: 'branchF', sourceHandle: 'false_output' },
      ],
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getOutputString(result, 'branchT1')).toBe('T1');
    expect(getOutputString(result, 'branchT2')).toBe('T2');
    // Sequential would be 200ms+; parallel should be ~120ms.
    expect(elapsed).toBeLessThan(220);

    // The false branch must be skipped — no output recorded.
    const fOutput = result.outputs?.['branchF'] as NodeOutput | undefined;
    if (fOutput) {
      const vars = fOutput.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  it('convergence after partial skip: downstream runs when one parent succeeded and one was skipped', async () => {
    setDelays({});
    const result = await runDef('parallel-converge', {
      nodes: [
        inputNode('a', { value: 100 }),
        {
          id: 'gate2',
          type: 'core.if_else',
          referenceId: 'gate2',
          label: 'gate2',
          params: { expression: 'a.value > 50' },
          position: { x: 0, y: 0 },
        },
        tmplNode('truePath', 'T'),
        tmplNode('falsePath', 'F'),
        tmplNode('after', 'true={{ truePath }}'),
      ],
      edges: [
        { id: 'a-g2', source: 'a', target: 'gate2' },
        { id: 'g2-t', source: 'gate2', target: 'truePath', sourceHandle: 'true_output' },
        { id: 'g2-f', source: 'gate2', target: 'falsePath', sourceHandle: 'false_output' },
        { id: 't-after', source: 'truePath', target: 'after' },
        { id: 'f-after', source: 'falsePath', target: 'after' },
      ],
    });
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getOutputString(result, 'after')).toBe('true=T');
  });

  it('concurrency=1 still produces correct output (sequential equivalence)', async () => {
    // Toggle the scheduler to single-slot mode for this run only. The
    // scheduler reads the env var on every getConcurrency() call, so a
    // single-test override is safe.
    setDelays({});
    const original = process.env.FLOWLIB_SCHEDULER_CONCURRENCY;
    process.env.FLOWLIB_SCHEDULER_CONCURRENCY = '1';
    try {
      const result = await runDef('concurrency-1', {
        nodes: [
          inputNode('a', 'start'),
          tmplNode('lhs', 'L'),
          tmplNode('rhs', 'R'),
          tmplNode('out', 'L={{ lhs }}|R={{ rhs }}'),
        ],
        edges: [
          { id: 'a-l', source: 'a', target: 'lhs' },
          { id: 'a-r', source: 'a', target: 'rhs' },
          { id: 'l-o', source: 'lhs', target: 'out' },
          { id: 'r-o', source: 'rhs', target: 'out' },
        ],
      });
      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getOutputString(result, 'out');
      expect(out).toContain('L=L');
      expect(out).toContain('R=R');
    } finally {
      if (original === undefined) {
        delete process.env.FLOWLIB_SCHEDULER_CONCURRENCY;
      } else {
        process.env.FLOWLIB_SCHEDULER_CONCURRENCY = original;
      }
    }
  });
});
