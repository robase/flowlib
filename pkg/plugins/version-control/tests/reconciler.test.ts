/**
 * Phase 0b — Polling reconciler.
 *
 * The reconciler is the primary correctness path: even with all webhooks
 * dropped, the instance must converge to the branch head within the tick
 * interval. These tests exercise the contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';
import { ReconcilerService } from '../src/backend/reconciler';
import { VcSyncService } from '../src/backend/sync-service';
import type { GitProvider, GitTreeEntry } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';

// ── Test fixtures ────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-x' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue({ sha: 'head-default' }),
    listTree: vi.fn().mockResolvedValue([]),
    compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
    createTreeCommit: vi.fn().mockResolvedValue({ commitSha: 'sha-tree', files: [] }),
    createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'https://test/pr/1' }),
    updatePullRequest: vi.fn().mockResolvedValue(undefined),
    getPullRequest: vi.fn().mockResolvedValue({ state: 'open' }),
    closePullRequest: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const baseOptions: VersionControlPluginOptions = {
  provider: makeProvider(),
  repo: 'acme/flows',
  defaultBranch: 'main',
  path: 'flows/',
  mode: 'direct-commit',
};

const minimalDef = {
  nodes: [
    {
      id: 'node_a',
      type: 'trigger.manual',
      referenceId: 'q',
      position: { x: 0, y: 0 },
      params: {},
    },
  ],
  edges: [],
};

/**
 * Build a stateful in-memory DB stub good enough for the reconciler:
 *   - `flowlib_vc_instance_state` row (singleton per repo+branch).
 *   - `flowlib_vc_sync_config` rows by flow_id.
 *   - `flowlib_flow_versions` MAX(version) per flow_id.
 *   - INSERT/UPDATE on the above tables.
 */
function makeStatefulDb(initial?: {
  syncConfigs?: Array<{
    id: string;
    flow_id: string;
    file_path: string;
    last_commit_sha?: string | null;
    sync_direction?: string;
  }>;
  flowVersions?: Record<string, number>;
}): { db: PluginDatabaseApi; state: ReconcilerDbState } {
  const state: ReconcilerDbState = {
    instanceState: null,
    configs: new Map(),
    versions: new Map(Object.entries(initial?.flowVersions ?? {})),
    history: [],
  };

  for (const cfg of initial?.syncConfigs ?? []) {
    state.configs.set(cfg.flow_id, {
      id: cfg.id,
      flow_id: cfg.flow_id,
      provider: 'mock',
      repo: 'acme/flows',
      branch: 'main',
      file_path: cfg.file_path,
      mode: 'direct-commit',
      sync_direction: cfg.sync_direction ?? 'read',
      last_synced_at: null,
      last_commit_sha: cfg.last_commit_sha ?? null,
      last_synced_version: null,
      draft_branch: null,
      active_pr_number: null,
      active_pr_url: null,
      enabled: 1,
      created_at: '',
      updated_at: '',
    });
  }

  const db = {
    type: 'sqlite',
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM flowlib_vc_instance_state')) {
        return state.instanceState ? [state.instanceState] : [];
      }
      if (sql.includes('FROM flowlib_vc_sync_config WHERE flow_id = ?')) {
        const id = params[0] as string;
        const cfg = state.configs.get(id);
        return cfg ? [cfg] : [];
      }
      if (sql.includes('SELECT MAX(version)')) {
        const id = params[0] as string;
        return [{ version: state.versions.get(id) ?? 0 }];
      }
      if (sql.includes('FROM flowlib_flows WHERE')) {
        return [];
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO flowlib_vc_instance_state')) {
        const [id, repo, branch, sha, tickAt, error] = params as [
          string,
          string,
          string,
          string | null,
          string,
          string | null,
        ];
        state.instanceState = {
          id,
          repo,
          branch,
          last_instance_commit_sha: sha,
          last_reconciler_tick_at: tickAt,
          last_reconciler_error: error,
        };
      } else if (sql.startsWith('UPDATE flowlib_vc_instance_state')) {
        if (state.instanceState) {
          const [sha, tickAt, error] = params as [string | null, string, string | null];
          state.instanceState = {
            ...state.instanceState,
            last_instance_commit_sha: sha,
            last_reconciler_tick_at: tickAt,
            last_reconciler_error: error,
          };
        }
      } else if (sql.startsWith('UPDATE flowlib_vc_sync_config')) {
        const [filePath, , flowId] = params as [string, string, string];
        const cfg = state.configs.get(flowId);
        if (cfg) {
          state.configs.set(flowId, { ...cfg, file_path: filePath });
        }
      } else if (sql.includes('INSERT INTO flowlib_flow_versions')) {
        const [flowId, version] = params as [string, number];
        state.versions.set(flowId, version);
      } else if (sql.includes('INSERT INTO flowlib_vc_sync_history')) {
        state.history.push(params);
      }
    }),
  } as unknown as PluginDatabaseApi;

  return { db, state };
}

interface ReconcilerDbState {
  instanceState: {
    id: string;
    repo: string;
    branch: string;
    last_instance_commit_sha: string | null;
    last_reconciler_tick_at: string | null;
    last_reconciler_error: string | null;
  } | null;
  configs: Map<string, Record<string, unknown>>;
  versions: Map<string, number>;
  history: unknown[];
}

function emitFlowFile(flowId: string, name: string): string {
  const { code } = emitSdkSource(minimalDef, {
    flowName: 'f',
    includeJsonFooter: true,
    metadata: { flowId, name },
  });
  return code;
}

function makeReconciler(args: {
  provider: GitProvider;
  syncService: VcSyncService;
  db: PluginDatabaseApi;
  intervalMs?: number;
}) {
  return new ReconcilerService({
    repo: 'acme/flows',
    branch: 'main',
    path: 'flows/',
    intervalMs: args.intervalMs ?? 0, // disabled by default in tests
    logger: silentLogger,
    provider: args.provider,
    syncService: args.syncService,
    getDb: () => args.db,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. tick is a no-op when SHA matches ──────────────────────────────────

describe('tick: no-op path', () => {
  it('returns no-op when branch head equals lastInstanceCommitSha', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-stable' }),
    });
    const { db, state } = makeStatefulDb();
    state.instanceState = {
      id: 'is-1',
      repo: 'acme/flows',
      branch: 'main',
      last_instance_commit_sha: 'sha-stable',
      last_reconciler_tick_at: null,
      last_reconciler_error: null,
    };

    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('manual');
    expect(result.status).toBe('no-op');
    expect(result.branchSha).toBe('sha-stable');
    expect(provider.listTree).not.toHaveBeenCalled();
    expect(provider.getFileContent).not.toHaveBeenCalled();
  });

  it('still bumps lastReconcilerTickAt on no-op so health reflects liveness', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-stable' }),
    });
    const { db, state } = makeStatefulDb();
    state.instanceState = {
      id: 'is-1',
      repo: 'acme/flows',
      branch: 'main',
      last_instance_commit_sha: 'sha-stable',
      last_reconciler_tick_at: null,
      last_reconciler_error: null,
    };

    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    await reconciler.tick('interval');
    expect(state.instanceState.last_reconciler_tick_at).not.toBeNull();
  });
});

// ── 2. tick advances when SHA differs ────────────────────────────────────

describe('tick: advance path', () => {
  it('advances and pulls each tracked .flow.ts whose SHA changed', async () => {
    const code = emitFlowFile('flow_alpha', 'Alpha');
    const tree: GitTreeEntry[] = [{ path: 'flows/alpha.flow.ts', type: 'blob', sha: 'blob-1' }];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-new' }),
      listTree: vi.fn().mockResolvedValue(tree),
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-1' }),
    });

    const { db, state } = makeStatefulDb({
      syncConfigs: [{ id: 'cfg-1', flow_id: 'flow_alpha', file_path: 'flows/alpha.flow.ts' }],
    });

    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('webhook');
    expect(result.status).toBe('advanced');
    expect(result.flowsAffected).toBe(1);
    expect(state.instanceState?.last_instance_commit_sha).toBe('sha-new');
    // A new flow_versions row was inserted (version bumped from 0 to 1).
    expect(state.versions.get('flow_alpha')).toBe(1);
  });

  it('skips files that already match their last_commit_sha', async () => {
    const code = emitFlowFile('flow_clean', 'Clean');
    const tree: GitTreeEntry[] = [{ path: 'flows/clean.flow.ts', type: 'blob', sha: 'blob-clean' }];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-new' }),
      listTree: vi.fn().mockResolvedValue(tree),
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-clean' }),
    });

    const { db } = makeStatefulDb({
      syncConfigs: [
        {
          id: 'cfg-1',
          flow_id: 'flow_clean',
          file_path: 'flows/clean.flow.ts',
          last_commit_sha: 'blob-clean',
        },
      ],
    });

    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('manual');
    expect(result.status).toBe('advanced');
    expect(result.flowsAffected).toBe(0);
    expect(result.filesSkipped).toBe(1);
  });

  it('skips files whose embedded flowId is unknown locally (foreign repo)', async () => {
    const code = emitFlowFile('flow_FOREIGN', 'Foreign');
    const tree: GitTreeEntry[] = [{ path: 'flows/foreign.flow.ts', type: 'blob', sha: 'blob-x' }];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-new' }),
      listTree: vi.fn().mockResolvedValue(tree),
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-x' }),
    });

    // No local config row for flow_FOREIGN.
    const { db } = makeStatefulDb();

    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('manual');
    expect(result.status).toBe('advanced');
    expect(result.flowsAffected).toBe(0);
    expect(result.filesSkipped).toBe(1);
  });

  it('skips files without a JSON footer (legacy / hand-written)', async () => {
    const tree: GitTreeEntry[] = [
      { path: 'flows/legacy.flow.ts', type: 'blob', sha: 'blob-legacy' },
    ];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-new' }),
      listTree: vi.fn().mockResolvedValue(tree),
      getFileContent: vi.fn().mockResolvedValue({
        content: '// hand-written, no footer',
        sha: 'blob-legacy',
      }),
    });

    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('manual');
    expect(result.filesSkipped).toBe(1);
    expect(result.flowsAffected).toBe(0);
  });

  it('counts errors per file and continues (partial success)', async () => {
    const goodCode = emitFlowFile('flow_good', 'Good');
    const tree: GitTreeEntry[] = [
      { path: 'flows/bad.flow.ts', type: 'blob', sha: 'blob-bad' },
      { path: 'flows/good.flow.ts', type: 'blob', sha: 'blob-good' },
    ];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-new' }),
      listTree: vi.fn().mockResolvedValue(tree),
      // Error on the first file, succeed on the second.
      getFileContent: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        if (path === 'flows/bad.flow.ts') {
          throw new Error('boom');
        }
        return { content: goodCode, sha: 'blob-good' };
      }),
    });

    const { db } = makeStatefulDb({
      syncConfigs: [{ id: 'cfg-good', flow_id: 'flow_good', file_path: 'flows/good.flow.ts' }],
    });
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('interval');
    expect(result.status).toBe('advanced');
    expect(result.filesErrored).toBe(1);
    expect(result.flowsAffected).toBe(1);
  });
});

// ── 3. Rename: file path changes, flowId stays ───────────────────────────

describe('rename detection', () => {
  it('detects path change and updates the local config row', async () => {
    const code = emitFlowFile('flow_renamed', 'Renamed');
    // Local config thinks the file is at the OLD path.
    // The reconciler's tree walk finds it at a NEW path.
    const tree: GitTreeEntry[] = [
      { path: 'flows/triage-v2.flow.ts', type: 'blob', sha: 'blob-rn' },
    ];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-rename' }),
      listTree: vi.fn().mockResolvedValue(tree),
      // The reconciler refetches at the NEW path.
      getFileContent: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        if (path === 'flows/triage-v2.flow.ts') {
          return { content: code, sha: 'blob-rn' };
        }
        return null;
      }),
    });

    const { db, state } = makeStatefulDb({
      syncConfigs: [
        {
          id: 'cfg-1',
          flow_id: 'flow_renamed',
          file_path: 'flows/triage.flow.ts', // old path
        },
      ],
    });
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('webhook');
    expect(result.status).toBe('advanced');
    expect(result.flowsAffected).toBe(1);

    // The local config's file_path was updated in place — flow's history
    // (versions, RBAC, run history) is preserved on the same flow_id.
    const cfg = state.configs.get('flow_renamed') as { file_path: string };
    expect(cfg.file_path).toBe('flows/triage-v2.flow.ts');
  });
});

// ── 4. In-flight mutex prevents overlapping ticks ────────────────────────

describe('concurrency: in-flight mutex', () => {
  it('a second concurrent tick returns skipped without touching the provider', async () => {
    let resolveBranch: ((v: { sha: string }) => void) | null = null;
    const blockingBranch = new Promise<{ sha: string }>((resolve) => {
      resolveBranch = resolve;
    });

    const provider = makeProvider({
      // First tick blocks here. Second tick should bail with `skipped`.
      getBranch: vi.fn().mockReturnValue(blockingBranch),
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const tick1 = reconciler.tick('manual');
    // Microtask flush so tick1 is past its inFlight check.
    await Promise.resolve();
    const tick2 = await reconciler.tick('webhook');
    expect(tick2.status).toBe('skipped');

    resolveBranch!({ sha: 'sha-x' });
    await tick1;
    // After tick1 finishes, in-flight is released and a fresh tick proceeds.
    expect(reconciler.getHealth().inFlight).toBe(false);
  });
});

// ── 5. Webhook trigger calls tick ────────────────────────────────────────

describe('webhook trigger', () => {
  it('triggerOutOfCycle delegates to tick(reason="webhook")', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-x' }),
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.triggerOutOfCycle();
    expect(result.reason).toBe('webhook');
  });
});

// ── 6. The webhook-outage acceptance test ────────────────────────────────

describe('webhook outage resilience', () => {
  it('ticks pull updates without any webhook delivery (the §B promise)', async () => {
    const code = emitFlowFile('flow_offline', 'Offline');
    const tree: GitTreeEntry[] = [{ path: 'flows/offline.flow.ts', type: 'blob', sha: 'blob-off' }];

    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-after-outage' }),
      listTree: vi.fn().mockResolvedValue(tree),
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-off' }),
    });

    const { db, state } = makeStatefulDb({
      syncConfigs: [{ id: 'cfg-off', flow_id: 'flow_offline', file_path: 'flows/offline.flow.ts' }],
    });

    // No webhook is ever fired. The reconciler is the only path.
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('interval');
    expect(result.status).toBe('advanced');
    expect(state.instanceState?.last_instance_commit_sha).toBe('sha-after-outage');
    expect(state.versions.get('flow_offline')).toBe(1);
  });
});

// ── 7. Health surface ────────────────────────────────────────────────────

describe('getHealth()', () => {
  it('reflects last tick status + branch SHA after a successful advance', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-h1' }),
      listTree: vi.fn().mockResolvedValue([]),
      compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
      createTreeCommit: vi.fn().mockResolvedValue({ commitSha: 'sha-tree', files: [] }),
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    await reconciler.tick('manual');
    const health = reconciler.getHealth();
    expect(health.lastTickStatus).toBe('advanced');
    expect(health.lastInstanceCommitSha).toBe('sha-h1');
    expect(health.lastTickError).toBeNull();
    expect(health.lastTickAt).not.toBeNull();
    expect(health.inFlight).toBe(false);
  });

  it('records lastTickError on failure', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue(null), // branch not found
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    const result = await reconciler.tick('manual');
    expect(result.status).toBe('error');
    const health = reconciler.getHealth();
    expect(health.lastTickStatus).toBe('error');
    expect(health.lastTickError).toContain('Branch main not found');
  });
});

// ── 8. start() + stop() lifecycle ────────────────────────────────────────

describe('lifecycle: start / stop', () => {
  it('start() schedules ticks on the configured interval', async () => {
    vi.useFakeTimers();
    const tickSpy = vi.fn();
    const provider = makeProvider({
      getBranch: vi.fn().mockImplementation(() => {
        tickSpy();
        return Promise.resolve({ sha: 'sha-i' });
      }),
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({
      provider,
      syncService: sync,
      db,
      intervalMs: 1000,
    });

    reconciler.start();
    expect(tickSpy).not.toHaveBeenCalled(); // start does NOT fire immediately
    // Advance one interval; advanceTimersByTimeAsync flushes microtasks
    // without recursing into subsequent setInterval callbacks.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tickSpy).toHaveBeenCalledTimes(1);
    reconciler.stop();
  });

  it('stop() prevents further ticks', async () => {
    vi.useFakeTimers();
    const tickSpy = vi.fn();
    const provider = makeProvider({
      getBranch: vi.fn().mockImplementation(() => {
        tickSpy();
        return Promise.resolve({ sha: 'sha-i' });
      }),
    });
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({
      provider,
      syncService: sync,
      db,
      intervalMs: 1000,
    });

    reconciler.start();
    reconciler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tickSpy).not.toHaveBeenCalled();
  });

  it('intervalMs=0 disables auto-ticking entirely', () => {
    const provider = makeProvider();
    const { db } = makeStatefulDb();
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({
      provider,
      syncService: sync,
      db,
      intervalMs: 0,
    });

    reconciler.start();
    expect(reconciler.getHealth().enabled).toBe(false);
  });
});

// ── 9. Squash-merge simulation: payload SHA isn't trusted ────────────────

describe('squash-merge resilience', () => {
  it('reconciler always re-fetches branch.commit.sha — payload SHA is irrelevant', async () => {
    // The webhook (in real life) would carry sha-pre-squash, but that commit
    // never lands on `main` because squash creates sha-after-squash. The
    // reconciler doesn't see the payload — it asks the provider for the
    // current head, gets sha-after-squash, and pulls accordingly.
    const code = emitFlowFile('flow_squash', 'Squashed');
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-after-squash' }),
      listTree: vi
        .fn()
        .mockResolvedValue([{ path: 'flows/squash.flow.ts', type: 'blob', sha: 'blob-sq' }]),
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-sq' }),
    });

    const { db, state } = makeStatefulDb({
      syncConfigs: [{ id: 'cfg-sq', flow_id: 'flow_squash', file_path: 'flows/squash.flow.ts' }],
    });
    const sync = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);
    const reconciler = makeReconciler({ provider, syncService: sync, db });

    // No SHA passed in — reconciler discovers it on its own.
    const result = await reconciler.triggerOutOfCycle();
    expect(result.status).toBe('advanced');
    expect(state.instanceState?.last_instance_commit_sha).toBe('sha-after-squash');
  });
});
