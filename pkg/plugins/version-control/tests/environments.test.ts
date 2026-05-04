/**
 * Phase 1 — Environments + read-only gate.
 *
 * Three contracts:
 *   1. The instance role drives plugin behavior. `dev`/`staging` instances
 *      are unchanged from Phase 0; `prod` enables the read-only gate.
 *   2. The HTTP gate refuses flow-content mutations on prod with a 403,
 *      while pull writes (server-side via the reconciler) and the plugin's
 *      own `/vc/*` surface stay open.
 *   3. Break-glass opens a time-boxed override window, audited and
 *      auto-expiring, that lets the gate pass through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { versionControl } from '../src/backend/plugin';
import { InstanceStateService } from '../src/backend/instance-state';
import { isFlowMutation, isPluginOwnedPath, readOnlyResponse } from '../src/backend/read-only-gate';
import type { GitProvider } from '../src/backend/git-provider';
import type { PluginDatabaseApi, FlowlibPlugin } from '@flowlib/core';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { patchMockDb } from './test-helpers/mock-db';

// ── Shared helpers ───────────────────────────────────────────────────────

function makeProvider(): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-x' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue({ sha: 'sha-x' }),
    listTree: vi.fn().mockResolvedValue([]),
    compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
    createTreeCommit: vi.fn().mockResolvedValue({ commitSha: 'sha-tree', files: [] }),
    createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'https://test/pr/1' }),
    updatePullRequest: vi.fn().mockResolvedValue(undefined),
    getPullRequest: vi.fn().mockResolvedValue({ state: 'open' }),
    closePullRequest: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  };
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * Stateful single-row in-memory DB for instance state.
 *
 * Exposes BOTH a `PluginDatabaseApi` view (for direct `InstanceStateService`
 * tests) AND a `DatabaseConnection` view (for the plugin, which wraps via
 * `createPluginDatabaseApi`). The same row state backs both views.
 */
function makeStateDb() {
  let row: Record<string, unknown> | null = null;

  const handleQuery = async (sql: string): Promise<unknown[]> => {
    if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_vc_instance_state')) {
      return row ? [row] : [];
    }
    return [];
  };

  const handleExecute = async (sql: string, params: unknown[] = []) => {
    if (sql.toLowerCase().replace(/"/g, '').includes('insert into flowlib_vc_instance_state')) {
      const [
        id,
        repo,
        branch,
        last_instance_commit_sha,
        last_reconciler_tick_at,
        last_reconciler_error,
        break_glass_until,
        break_glass_actor,
        break_glass_reason,
      ] = params as string[];
      row = {
        id,
        repo,
        branch,
        last_instance_commit_sha,
        last_reconciler_tick_at,
        last_reconciler_error,
        break_glass_until,
        break_glass_actor,
        break_glass_reason,
      };
    } else if (sql.toLowerCase().replace(/"/g, '').startsWith('update flowlib_vc_instance_state')) {
      if (sql.includes('SET break_glass_until')) {
        if (row) {
          row.break_glass_until = params[0];
          row.break_glass_actor = params[1];
          row.break_glass_reason = params[2];
        }
      }
    }
  };

  // PluginDatabaseApi view — takes (sql, params), returns Promise.
  const db = patchMockDb({
    type: 'sqlite' as const,
    query: vi.fn(handleQuery),
    execute: vi.fn(handleExecute),
  }) as unknown as PluginDatabaseApi;

  // DatabaseConnection view — what the plugin's createPluginDatabaseApi wraps.
  // Exposes the same handlers under the `driver.queryAll` / `driver.execute`
  // names that createPluginDatabaseApi calls. After the executeRows() addition
  // the wrapper also reads `connection.db.dialect.sqlToQuery` to compile
  // Drizzle `sql\`\`` templates — supply the SQLite dialect directly so the
  // wrapper can compile templates without booting a full Drizzle instance.
  const connection = {
    type: 'sqlite' as const,
    db: { dialect: new SQLiteSyncDialect() },
    driver: {
      queryAll: vi.fn(async (sql: string, params: unknown[] = []) => handleQuery(sql)),
      execute: vi.fn(async (sql: string, params: unknown[] = []) => handleExecute(sql, params)),
    },
  };

  return { db, connection, peek: () => row };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. Pure path-matching utilities ──────────────────────────────────────

describe('read-only gate matchers', () => {
  it('isFlowMutation matches POST/PUT/PATCH/DELETE on /flows*', () => {
    expect(isFlowMutation('POST', '/flows')).toBe(true);
    expect(isFlowMutation('PUT', '/flows/abc-123')).toBe(true);
    expect(isFlowMutation('PATCH', 'flows/abc/metadata')).toBe(true);
    expect(isFlowMutation('DELETE', '/flows/abc')).toBe(true);
  });

  it('isFlowMutation matches /flow-versions* paths', () => {
    expect(isFlowMutation('POST', '/flow-versions')).toBe(true);
    expect(isFlowMutation('PUT', '/flow-versions/v1')).toBe(true);
  });

  it('isFlowMutation does NOT match safe verbs', () => {
    expect(isFlowMutation('GET', '/flows')).toBe(false);
    expect(isFlowMutation('HEAD', '/flows/abc')).toBe(false);
    expect(isFlowMutation('OPTIONS', '/flows')).toBe(false);
  });

  it('isFlowMutation does NOT match flow-execution paths', () => {
    // Flow runs MUST keep working on prod — running != mutating content.
    expect(isFlowMutation('POST', '/flow-runs')).toBe(false);
    expect(isFlowMutation('POST', '/flow-runs/abc/cancel')).toBe(false);
  });

  it('isFlowMutation does NOT match unrelated paths even with mutating verbs', () => {
    expect(isFlowMutation('POST', '/credentials')).toBe(false);
    expect(isFlowMutation('DELETE', '/agent-tools/my-tool')).toBe(false);
  });

  it('isPluginOwnedPath matches /vc/* with or without leading slash', () => {
    expect(isPluginOwnedPath('/vc/push')).toBe(true);
    expect(isPluginOwnedPath('vc/break-glass')).toBe(true);
    expect(isPluginOwnedPath('/vc/flows/abc/pull')).toBe(true);
    expect(isPluginOwnedPath('/flows')).toBe(false);
  });

  it('readOnlyResponse returns a 403 with a structured body', async () => {
    const r = readOnlyResponse('reason text', 'retry hint');
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toMatch(/read-only/);
    expect(body.reason).toBe('reason text');
    expect(body.retry).toBe('retry hint');
  });
});

// ── 2. InstanceStateService open/close/expiry ────────────────────────────

describe('InstanceStateService — break-glass lifecycle', () => {
  it('ensureRow is idempotent — second call is a no-op', async () => {
    const { db } = makeStateDb();
    const svc = new InstanceStateService('acme/flows', 'main');
    await svc.ensureRow(db);
    await svc.ensureRow(db);
    // Only one INSERT regardless of how many ensureRow calls.
    const inserts = (db.execute as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      (c[0] as string).includes('INSERT INTO flowlib_vc_instance_state'),
    );
    expect(inserts).toHaveLength(1);
  });

  it('openBreakGlass writes the window and getActiveBreakGlass returns it', async () => {
    const { db } = makeStateDb();
    const svc = new InstanceStateService('acme/flows', 'main');
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    await svc.openBreakGlass(db, { until, actor: 'user-1', reason: 'incident #42' });

    const window = await svc.getActiveBreakGlass(db);
    expect(window).not.toBeNull();
    expect(window?.until).toBe(until);
    expect(window?.actor).toBe('user-1');
    expect(window?.reason).toBe('incident #42');
  });

  it('getActiveBreakGlass returns null when the window has expired', async () => {
    const { db } = makeStateDb();
    const svc = new InstanceStateService('acme/flows', 'main');
    const past = new Date(Date.now() - 1000).toISOString();
    await svc.openBreakGlass(db, { until: past, actor: 'a', reason: 'old' });

    const window = await svc.getActiveBreakGlass(db);
    expect(window).toBeNull();
  });

  it('closeBreakGlass clears the window', async () => {
    const { db } = makeStateDb();
    const svc = new InstanceStateService('acme/flows', 'main');
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    await svc.openBreakGlass(db, { until, actor: 'a', reason: 'r' });
    await svc.closeBreakGlass(db);

    const window = await svc.getActiveBreakGlass(db);
    expect(window).toBeNull();
  });
});

// ── 3. Plugin-shape: env determines onRequest registration ───────────────

describe('versionControl() plugin shape', () => {
  it('does NOT register onRequest hook on dev/staging instances', () => {
    const dev = versionControl({
      provider: makeProvider(),
      repo: 'acme/flows',
      environment: 'dev',
    });
    const staging = versionControl({
      provider: makeProvider(),
      repo: 'acme/flows',
      environment: 'staging',
    });
    const noEnv = versionControl({ provider: makeProvider(), repo: 'acme/flows' });

    expect((dev.backend as FlowlibPlugin).hooks?.onRequest).toBeUndefined();
    expect((staging.backend as FlowlibPlugin).hooks?.onRequest).toBeUndefined();
    expect((noEnv.backend as FlowlibPlugin).hooks?.onRequest).toBeUndefined();
  });

  it('DOES register onRequest hook on prod', () => {
    const prod = versionControl({
      provider: makeProvider(),
      repo: 'acme/flows',
      environment: 'prod',
    });
    expect((prod.backend as FlowlibPlugin).hooks?.onRequest).toBeDefined();
  });
});

// ── 4. End-to-end through the prod plugin's onRequest hook ───────────────

describe('prod read-only enforcement (onRequest hook)', () => {
  /**
   * Build a prod plugin, call init() with a stubbed FlowlibInstance, and
   * return the plugin handle + the in-memory state DB so tests can:
   *   - call hooks.onRequest() with various (method, path) shapes,
   *   - flip break-glass on/off,
   *   - assert the response.
   */
  async function bootProd() {
    const { db, connection, peek } = makeStateDb();
    const provider = makeProvider();
    // Disable the reconciler interval so it doesn't keep the test alive.
    const def = versionControl({
      provider,
      repo: 'acme/flows',
      defaultBranch: 'main',
      environment: 'prod',
      reconcilerIntervalMs: 0,
    });
    const backend = def.backend as FlowlibPlugin;

    // Minimal FlowlibPluginContext — just what init() touches. The plugin
    // wraps `getDatabaseConnection()`'s return through createPluginDatabaseApi,
    // so we hand back a DatabaseConnection-shaped stub backed by the same
    // in-memory row as `db`.
    await backend.init?.({
      config: {},
      logger: silentLogger,
      hasPlugin: () => false,
      getPlugin: () => null,
      registerAction: () => {},
      store: new Map(),
      getFlowlib: () =>
        ({
          plugins: {
            getDatabaseConnection: () => connection as unknown,
          },
        }) as never,
    });

    const onRequest = backend.hooks?.onRequest;
    if (!onRequest) {
      throw new Error('onRequest hook missing');
    }

    return { onRequest, backend, db, peek, provider };
  }

  it('blocks POST /flows with a 403', async () => {
    const { onRequest } = await bootProd();
    const result = await onRequest(new Request('http://localhost/flows', { method: 'POST' }), {
      path: '/flows',
      method: 'POST',
      identity: null,
    });
    expect(result).toBeDefined();
    if (!result || !('response' in result)) {
      throw new Error('expected response short-circuit');
    }
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error).toMatch(/read-only/);
    expect(body.retry).toMatch(/break-glass/i);
  });

  it('blocks PUT /flows/:id and PATCH /flow-versions/:id', async () => {
    const { onRequest } = await bootProd();
    for (const [method, path] of [
      ['PUT', '/flows/abc'],
      ['PATCH', '/flow-versions/v1'],
      ['DELETE', '/flows/abc'],
    ] as const) {
      const result = await onRequest(new Request(`http://localhost${path}`, { method }), {
        path,
        method,
        identity: null,
      });
      if (!result || !('response' in result)) {
        throw new Error(`expected 403 for ${method} ${path}`);
      }
      expect(result.response.status).toBe(403);
    }
  });

  it('allows GET /flows/:id (read verbs always pass)', async () => {
    const { onRequest } = await bootProd();
    const result = await onRequest(new Request('http://localhost/flows/abc', { method: 'GET' }), {
      path: '/flows/abc',
      method: 'GET',
      identity: null,
    });
    expect(result).toBeUndefined(); // no short-circuit
  });

  it('allows POST /flow-runs (running flows is not editing them)', async () => {
    const { onRequest } = await bootProd();
    const result = await onRequest(new Request('http://localhost/flow-runs', { method: 'POST' }), {
      path: '/flow-runs',
      method: 'POST',
      identity: null,
    });
    expect(result).toBeUndefined();
  });

  it('allows /vc/* paths even with mutating verbs', async () => {
    const { onRequest } = await bootProd();
    for (const [method, path] of [
      ['POST', '/vc/push'],
      ['DELETE', '/vc/break-glass'],
      ['POST', '/vc/flows/abc/pull'],
    ] as const) {
      const result = await onRequest(new Request(`http://localhost${path}`, { method }), {
        path,
        method,
        identity: null,
      });
      expect(result).toBeUndefined();
    }
  });

  it('passes through during an active break-glass window', async () => {
    const { onRequest, db } = await bootProd();
    const svc = new InstanceStateService('acme/flows', 'main');
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    await svc.openBreakGlass(db, { until, actor: 'ops-1', reason: 'hotfix' });

    const result = await onRequest(new Request('http://localhost/flows', { method: 'POST' }), {
      path: '/flows',
      method: 'POST',
      identity: { id: 'ops-1' } as never,
    });
    expect(result).toBeUndefined();
  });

  it('re-blocks once the break-glass window expires', async () => {
    const { onRequest, db } = await bootProd();
    const svc = new InstanceStateService('acme/flows', 'main');
    // Open with a window that's already expired.
    const past = new Date(Date.now() - 1000).toISOString();
    await svc.openBreakGlass(db, { until: past, actor: 'ops-1', reason: 'forgot to close' });

    const result = await onRequest(new Request('http://localhost/flows', { method: 'POST' }), {
      path: '/flows',
      method: 'POST',
      identity: null,
    });
    if (!result || !('response' in result)) {
      throw new Error('expected 403');
    }
    expect(result.response.status).toBe(403);
  });

  it('fails closed when the break-glass DB lookup throws', async () => {
    // DatabaseConnection-shaped stub whose `queryAll` always rejects.
    // The hook should fall back to blocking writes rather than silently
    // allowing them through.
    const failingConnection = {
      type: 'sqlite' as const,
      driver: {
        queryAll: vi.fn().mockRejectedValue(new Error('db is down')),
        execute: vi.fn(),
      },
    };

    const def = versionControl({
      provider: makeProvider(),
      repo: 'acme/flows',
      environment: 'prod',
      reconcilerIntervalMs: 0,
    });
    const backend = def.backend as FlowlibPlugin;
    await backend.init?.({
      config: {},
      logger: silentLogger,
      hasPlugin: () => false,
      getPlugin: () => null,
      registerAction: () => {},
      store: new Map(),
      getFlowlib: () =>
        ({
          plugins: { getDatabaseConnection: () => failingConnection as unknown },
        }) as never,
    });
    const onRequest = backend.hooks?.onRequest;
    if (!onRequest) {
      throw new Error('onRequest missing');
    }

    const result = await onRequest(new Request('http://localhost/flows', { method: 'POST' }), {
      path: '/flows',
      method: 'POST',
      identity: null,
    });
    if (!result || !('response' in result)) {
      throw new Error('expected 403 on DB failure');
    }
    expect(result.response.status).toBe(403);
  });
});
