/**
 * Integration tests: per-run node-execution persistence (PR 11).
 *
 * Validates `config.execution.persistence: 'per-run'`:
 *   1. A successful flow run flushes node executions into
 *      `flow_runs.node_outputs` and writes ZERO rows to `action_traces`.
 *   2. The read path (`listNodeExecutionsByFlowRunId`) returns the same
 *      `NodeExecution[]` shape consumers expect, parsed back from the JSON
 *      blob.
 *   3. A failing flow run still buffers and flushes its partial outputs
 *      (the FAILED node + everything that ran before it).
 *
 * Also: a default-config (per-node) sanity check ensures the historical
 * behavior is preserved for existing consumers.
 *
 * No AI/LLM calls — uses deterministic node types only.
 */
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlowRunStatus, NodeExecutionStatus } from '../../../src';
import { createInvect } from '../../../src/api/create-flowlib';
import type { InvectInstance } from '../../../src/api/types';
import type { InvectDefinition } from '../../../src/services/flow-versions/schemas-fresh';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../drizzle/sqlite');

/**
 * Bootstrap an Invect instance with a configurable `execution.persistence`.
 * Mirrors `createTestInvect` but lets us pass execution config through.
 */
async function createInvectWithPersistence(
  persistence: 'per-node' | 'per-run',
): Promise<{ flowlib: InvectInstance; dbPath: string; tmpDir: string }> {
  process.env.INVECT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const tmpDir = mkdtempSync(join(tmpdir(), 'flowlib-per-run-test-'));
  const dbPath = join(tmpDir, 'test.db');

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.close();

  const flowlib = await createInvect({
    encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: { type: 'sqlite', connectionString: `file:${dbPath}` },
    logging: { level: 'warn' },
    execution: {
      defaultTimeout: 60000,
      maxConcurrentExecutions: 10,
      enableTracing: true,
      flowTimeoutMs: 600_000,
      modelNodeTimeoutMs: 300_000,
      agentNodeTimeoutMs: 900_000,
      heartbeatIntervalMs: 60_000, // long heartbeat to keep test logs clean
      staleRunCheckIntervalMs: 60_000,
      persistence,
    },
    plugins: [],
  });

  return { flowlib, dbPath, tmpDir };
}

/**
 * Drizzle-free SQL helper — counts node-trace rows directly so we can
 * assert that per-run mode bypassed `invect_action_traces` entirely.
 */
function countActionTraceRows(dbPath: string, flowRunId: string): number {
  const sqlite = new Database(dbPath);
  try {
    const row = sqlite
      .prepare(
        // node-level rows have `parent_node_execution_id IS NULL`. tool
        // traces (which we don't buffer) carry a parent and shouldn't be
        // affected by per-run mode.
        `SELECT COUNT(*) as n FROM invect_action_traces
          WHERE flow_run_id = ? AND parent_node_execution_id IS NULL`,
      )
      .get(flowRunId) as { n: number } | undefined;
    return row?.n ?? 0;
  } finally {
    sqlite.close();
  }
}

/** Read the raw `node_outputs` JSON blob from the flow_runs row. */
function readNodeOutputsBlob(dbPath: string, flowRunId: string): unknown {
  const sqlite = new Database(dbPath);
  try {
    const row = sqlite
      .prepare(`SELECT node_outputs FROM invect_flow_executions WHERE id = ?`)
      .get(flowRunId) as { node_outputs: string | null } | undefined;
    if (!row || row.node_outputs === null) {
      return null;
    }
    return typeof row.node_outputs === 'string' ? JSON.parse(row.node_outputs) : row.node_outputs;
  } finally {
    sqlite.close();
  }
}

/** Two-node flow: input → javascript. Used for success-path tests. */
const TWO_NODE_FLOW: InvectDefinition = {
  nodes: [
    {
      id: 'input-1',
      type: 'core.input',
      label: 'Data',
      referenceId: 'data',
      params: { variableName: 'data', defaultValue: JSON.stringify({ count: 5 }) },
      position: { x: 0, y: 0 },
    },
    {
      id: 'js-1',
      type: 'core.javascript',
      label: 'Double',
      referenceId: 'doubled',
      params: { code: '$input.data.count * 2' },
      position: { x: 200, y: 0 },
    },
  ],
  edges: [{ id: 'e1', source: 'input-1', target: 'js-1' }],
};

/** Flow with a JS node guaranteed to throw. Used for failure-path tests. */
const FAILING_FLOW: InvectDefinition = {
  nodes: [
    {
      id: 'input-1',
      type: 'core.input',
      label: 'Data',
      referenceId: 'data',
      params: { variableName: 'data', defaultValue: JSON.stringify({ count: 7 }) },
      position: { x: 0, y: 0 },
    },
    {
      id: 'js-bomb',
      type: 'core.javascript',
      label: 'Bomb',
      referenceId: 'bomb',
      params: { code: 'throw new Error("intentional bomb")' },
      position: { x: 200, y: 0 },
    },
  ],
  edges: [{ id: 'e1', source: 'input-1', target: 'js-bomb' }],
};

// ===========================================================================
// per-run mode
// ===========================================================================
describe('execution.persistence: per-run', () => {
  let flowlib: InvectInstance;
  let dbPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    const ctx = await createInvectWithPersistence('per-run');
    flowlib = ctx.flowlib;
    dbPath = ctx.dbPath;
    tmpDir = ctx.tmpDir;
  });

  afterAll(async () => {
    await flowlib.shutdown();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('successful run: zero action_traces rows; node_outputs blob populated', async () => {
    const flow = await flowlib.flows.create({ name: `per-run-success-${Date.now()}` });
    await flowlib.versions.create(flow.id, { invectDefinition: TWO_NODE_FLOW });
    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // 1. Zero node-level rows landed in action_traces.
    expect(countActionTraceRows(dbPath, result.flowRunId)).toBe(0);

    // 2. The flow_runs.node_outputs blob holds the buffered traces.
    const blob = readNodeOutputsBlob(dbPath, result.flowRunId) as unknown[];
    expect(Array.isArray(blob)).toBe(true);
    expect(blob.length).toBe(2);
    const nodeIds = (blob as { nodeId: string }[]).map((r) => r.nodeId).sort();
    expect(nodeIds).toEqual(['input-1', 'js-1']);
    for (const row of blob as { status: string }[]) {
      expect(row.status).toBe(NodeExecutionStatus.SUCCESS);
    }
  });

  it('read path: listNodeExecutionsByFlowRunId returns the same shape as per-node mode', async () => {
    const flow = await flowlib.flows.create({ name: `per-run-read-${Date.now()}` });
    await flowlib.versions.create(flow.id, { invectDefinition: TWO_NODE_FLOW });
    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // The public API used by ReactFlowRendererService and frontend
    // consumers must transparently parse the JSON blob.
    const page = await flowlib.runs.getNodeExecutions(result.flowRunId);
    const traces = page.data;
    expect(traces).toHaveLength(2);
    // Each row has the canonical NodeExecution shape.
    for (const trace of traces) {
      expect(trace.flowRunId).toBe(result.flowRunId);
      expect(trace.status).toBe(NodeExecutionStatus.SUCCESS);
      expect(trace.id).toBeTypeOf('string');
      expect(trace.nodeId).toBeTypeOf('string');
      expect(trace.nodeType).toBeTypeOf('string');
      expect(trace.inputs).toBeTypeOf('object');
      // outputs is a NodeOutput envelope, not a plain object — verifies
      // we round-tripped the structured shape, not just the value.
      expect(trace.outputs?.nodeType).toBeTypeOf('string');
      expect(trace.outputs?.data?.variables).toBeTypeOf('object');
    }
    // Ordering is preserved: input-1 ran before js-1.
    const sortedByStart = [...traces].sort((a, b) => {
      const av = typeof a.startedAt === 'string' ? a.startedAt : a.startedAt.toISOString();
      const bv = typeof b.startedAt === 'string' ? b.startedAt : b.startedAt.toISOString();
      return av.localeCompare(bv);
    });
    expect(sortedByStart[0].nodeId).toBe('input-1');
    expect(sortedByStart[1].nodeId).toBe('js-1');
  });

  it('failed run: still flushes the partial buffer (FAILED node + upstream)', async () => {
    const flow = await flowlib.flows.create({ name: `per-run-failed-${Date.now()}` });
    await flowlib.versions.create(flow.id, { invectDefinition: FAILING_FLOW });
    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

    expect(result.status).toBe(FlowRunStatus.FAILED);

    // Zero rows in action_traces — failure path also bypasses the table.
    expect(countActionTraceRows(dbPath, result.flowRunId)).toBe(0);

    // Blob captures both the successful upstream node and the failed bomb.
    const blob = readNodeOutputsBlob(dbPath, result.flowRunId) as {
      nodeId: string;
      status: string;
    }[];
    expect(Array.isArray(blob)).toBe(true);
    expect(blob.length).toBe(2);
    const byNode = new Map(blob.map((r) => [r.nodeId, r]));
    expect(byNode.get('input-1')?.status).toBe(NodeExecutionStatus.SUCCESS);
    expect(byNode.get('js-bomb')?.status).toBe(NodeExecutionStatus.FAILED);

    // And the read path surfaces both.
    const page = await flowlib.runs.getNodeExecutions(result.flowRunId);
    expect(page.data).toHaveLength(2);
  });
});

// ===========================================================================
// per-node (default) mode — sanity check
// ===========================================================================
describe('execution.persistence: per-node (default)', () => {
  let flowlib: InvectInstance;
  let dbPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    const ctx = await createInvectWithPersistence('per-node');
    flowlib = ctx.flowlib;
    dbPath = ctx.dbPath;
    tmpDir = ctx.tmpDir;
  });

  afterAll(async () => {
    await flowlib.shutdown();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('writes one row per node to action_traces and leaves node_outputs null', async () => {
    const flow = await flowlib.flows.create({ name: `per-node-baseline-${Date.now()}` });
    await flowlib.versions.create(flow.id, { invectDefinition: TWO_NODE_FLOW });
    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // Historical behavior: rows persisted per node.
    expect(countActionTraceRows(dbPath, result.flowRunId)).toBe(2);

    // And the new column is null on per-node runs.
    expect(readNodeOutputsBlob(dbPath, result.flowRunId)).toBeNull();
  });
});
