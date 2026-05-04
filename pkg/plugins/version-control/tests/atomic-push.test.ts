/**
 * Phase 0c — Atomic batch push, per-flow locks, replica idempotency.
 *
 * Three contracts under test here:
 *   1. `pushFlowsAtomic` either commits ALL files or NONE — never partial.
 *      Failures during blob/tree/commit construction leave the branch
 *      untouched; only the final ref-advance is the "commit" point.
 *   2. Per-flow lock prevents concurrent push/pull on the same flowId.
 *      Second caller gets a clean error, not a race.
 *   3. `vc_pull_commits` (flowId, commitSha) PK makes pulls idempotent —
 *      two replicas pulling the same SHA only insert one flow_versions row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VcSyncService } from '../src/backend/sync-service';
import { LockManager, LockBusyError } from '../src/backend/lock-manager';
import { StaleHeadError } from '../src/backend/git-provider';
import type { GitProvider } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';
import { patchMockDb } from './test-helpers/mock-db';

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
    getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
    listTree: vi.fn().mockResolvedValue([]),
    compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
    createTreeCommit: vi.fn(),
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

/**
 * Stateful in-memory DB. Tracks flows, versions, configs, pull-commits.
 * Returns a fresh service + db per test so locks don't leak across cases.
 */
function makeFixture(args: {
  flows: Array<{ id: string; name: string }>;
  configs?: Array<{
    flow_id: string;
    file_path: string;
    sync_direction?: 'read' | 'write' | 'read-write';
    repo?: string;
    branch?: string;
  }>;
  provider?: GitProvider;
}) {
  const flows = new Map(args.flows.map((f) => [f.id, f]));
  const versionsByFlow = new Map<string, number>();
  const definitionsByFlow = new Map<string, string>();
  for (const f of args.flows) {
    versionsByFlow.set(f.id, 1);
    definitionsByFlow.set(
      f.id,
      JSON.stringify({
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'q',
            position: { x: 0, y: 0 },
            params: {},
          },
        ],
        edges: [],
      }),
    );
  }
  const configs = new Map<string, Record<string, unknown>>();
  for (const c of args.configs ?? []) {
    configs.set(c.flow_id, {
      id: `cfg-${c.flow_id}`,
      flow_id: c.flow_id,
      provider: 'mock',
      repo: c.repo ?? 'acme/flows',
      branch: c.branch ?? 'main',
      file_path: c.file_path,
      mode: 'direct-commit',
      sync_direction: c.sync_direction ?? 'write',
      last_synced_at: null,
      last_commit_sha: null,
      last_synced_version: null,
      draft_branch: null,
      active_pr_number: null,
      active_pr_url: null,
      enabled: 1,
      created_at: '',
      updated_at: '',
    });
  }
  const pullCommits = new Map<string, number>(); // (flow_id|commit_sha) -> version
  const versionInserts: Array<{ flow_id: string; version: number }> = [];

  // SQL pattern-matches normalize case + strip identifier quotes because
  // Kysely-emitted SQL uses lower-case keywords and `"flowlib_flows"` etc.,
  // where the original Drizzle/raw paths produced upper-case unquoted SQL.
  const db = patchMockDb({
    type: 'sqlite',
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/"/g, '');
      if (norm.includes('flowlib_vc_pull_commits')) {
        const [flowId, sha] = params as [string, string];
        const v = pullCommits.get(`${flowId}|${sha}`);
        return v !== undefined ? [{ version_inserted: v }] : [];
      }
      if (norm.includes('flowlib_vc_sync_config') && norm.includes('flow_id = ?')) {
        const id = params[0] as string;
        const cfg = configs.get(id);
        return cfg ? [cfg] : [];
      }
      if (norm.includes('max(version)')) {
        const id = params[0] as string;
        return [{ version: versionsByFlow.get(id) ?? 0 }];
      }
      if (norm.includes('flowlib_flow_versions') && norm.includes('order by')) {
        const id = params[0] as string;
        const v = versionsByFlow.get(id);
        if (!v) {
          return [];
        }
        return [{ flow_id: id, version: v, flowlib_definition: definitionsByFlow.get(id)! }];
      }
      if (norm.includes('flowlib_flows')) {
        const id = params[0] as string;
        const f = flows.get(id);
        return f ? [{ ...f, description: null, tags: null }] : [];
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/"/g, '');
      if (norm.includes('insert into flowlib_flow_versions')) {
        const [flowId, version] = params as [string, number];
        versionsByFlow.set(flowId, version);
        versionInserts.push({ flow_id: flowId, version });
      } else if (norm.includes('insert into flowlib_vc_pull_commits')) {
        const [flowId, sha, version] = params as [string, string, number];
        pullCommits.set(`${flowId}|${sha}`, version);
      } else if (norm.includes('update flowlib_vc_sync_config')) {
        if (norm.includes('set last_synced_at')) {
          const flowId = params[params.length - 1] as string;
          const cfg = configs.get(flowId);
          if (cfg) {
            cfg.last_commit_sha = params[1];
          }
        }
      }
    }),
  }) as unknown as PluginDatabaseApi;

  const provider = args.provider ?? makeProvider();
  const service = new VcSyncService(provider, { ...baseOptions, provider }, silentLogger);

  return { db, service, provider, state: { configs, versionInserts, pullCommits } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. Atomic batch commit succeeds with all-or-nothing semantics ────────

describe('pushFlowsAtomic — atomicity', () => {
  it('all 5 flows land in a single commit on success', async () => {
    const treeCall = vi.fn().mockImplementation(async (_repo: string, opts) => {
      // Verify the caller batched all 5 flow files. Phase 4 also tucks
      // `_manifest.json` into every commit, so total = 5 flows + 1 manifest.
      const flowFiles = opts.files.filter(
        (f: { path: string }) => !f.path.endsWith('_manifest.json'),
      );
      expect(flowFiles).toHaveLength(5);
      return {
        commitSha: 'sha-new-commit',
        files: opts.files.map((f: { path: string }, i: number) => ({
          path: f.path,
          blobSha: `blob-${i}`,
        })),
      };
    });
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: treeCall,
    });

    const fx = makeFixture({
      flows: Array.from({ length: 5 }, (_, i) => ({ id: `flow_${i}`, name: `Flow ${i}` })),
      configs: Array.from({ length: 5 }, (_, i) => ({
        flow_id: `flow_${i}`,
        file_path: `flows/flow-${i}.flow.ts`,
      })),
      provider,
    });

    const result = await fx.service.pushFlowsAtomic(
      fx.db,
      Array.from({ length: 5 }, (_, i) => `flow_${i}`),
      { commitMessage: 'Batch update' },
    );

    expect(result.success).toBe(true);
    expect(result.commitSha).toBe('sha-new-commit');
    expect(result.results).toHaveLength(5);
    expect(result.results.every((r) => r.status === 'pushed')).toBe(true);
    // Trees-API was called exactly once — not per-file.
    expect(treeCall).toHaveBeenCalledTimes(1);
    // The batch was sent with the captured parent SHA.
    expect(treeCall.mock.calls[0][1].expectedParentSha).toBe('sha-parent');
  });

  it('zero commits land if createTreeCommit fails mid-construction', async () => {
    // Simulate a failure during blob/tree construction (not a stale head).
    // Per §B in IMPROVEMENTS: until the ref-advance happens, no commit lands.
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: vi.fn().mockRejectedValue(new Error('Network died during blob upload')),
    });

    const fx = makeFixture({
      flows: Array.from({ length: 5 }, (_, i) => ({ id: `flow_${i}`, name: `Flow ${i}` })),
      configs: Array.from({ length: 5 }, (_, i) => ({
        flow_id: `flow_${i}`,
        file_path: `flows/flow-${i}.flow.ts`,
      })),
      provider,
    });

    await expect(
      fx.service.pushFlowsAtomic(
        fx.db,
        Array.from({ length: 5 }, (_, i) => `flow_${i}`),
        { commitMessage: 'will fail' },
      ),
    ).rejects.toThrow('Network died');

    // Critical: NO config rows had lastCommitSha updated, NO history rows
    // recorded a successful push. The atomicity guarantee held.
    for (const cfg of fx.state.configs.values()) {
      expect(cfg.last_commit_sha).toBeNull();
    }
  });

  it('returns conflict result on StaleHeadError without partial commits', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: vi.fn().mockRejectedValue(new StaleHeadError('sha-parent', 'sha-other')),
    });

    const fx = makeFixture({
      flows: [{ id: 'flow_1', name: 'F' }],
      configs: [{ flow_id: 'flow_1', file_path: 'flows/f.flow.ts' }],
      provider,
    });

    const result = await fx.service.pushFlowsAtomic(fx.db, ['flow_1'], {
      commitMessage: 'racing push',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('sha-parent');
    expect(result.error).toContain('sha-other');
    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toMatch(/branch advanced|refresh and retry/i);
    // No flow_versions rows inserted, no lastCommitSha updates.
    expect(fx.state.configs.get('flow_1')?.last_commit_sha).toBeNull();
  });

  it('refuses mixed repo/branch in batch (single-branch v1 constraint)', async () => {
    const fx = makeFixture({
      flows: [
        { id: 'flow_a', name: 'A' },
        { id: 'flow_b', name: 'B' },
      ],
      configs: [
        { flow_id: 'flow_a', file_path: 'flows/a.flow.ts', branch: 'main' },
        { flow_id: 'flow_b', file_path: 'flows/b.flow.ts', branch: 'feat/something' },
      ],
    });

    const result = await fx.service.pushFlowsAtomic(fx.db, ['flow_a', 'flow_b'], {
      commitMessage: 'mixed',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Mixed repo\/branch/);
  });

  it('excludes read-only flows from the batch but proceeds with the rest', async () => {
    const treeCall = vi.fn().mockImplementation(async (_repo, opts) => ({
      commitSha: 'sha-mixed',
      files: opts.files.map((f: { path: string }) => ({ path: f.path, blobSha: 'blob-x' })),
    }));
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: treeCall,
    });

    const fx = makeFixture({
      flows: [
        { id: 'flow_push', name: 'Push' },
        { id: 'flow_readonly', name: 'ReadOnly' },
      ],
      configs: [
        { flow_id: 'flow_push', file_path: 'flows/push.flow.ts', sync_direction: 'write' },
        {
          flow_id: 'flow_readonly',
          file_path: 'flows/readonly.flow.ts',
          sync_direction: 'read',
        },
      ],
      provider,
    });

    const result = await fx.service.pushFlowsAtomic(fx.db, ['flow_push', 'flow_readonly'], {
      commitMessage: 'mixed direction',
    });

    expect(result.success).toBe(true);
    const pushResult = result.results.find((r) => r.flowId === 'flow_push');
    const readonlyResult = result.results.find((r) => r.flowId === 'flow_readonly');
    expect(pushResult?.status).toBe('pushed');
    expect(readonlyResult?.status).toBe('error');
    expect(readonlyResult?.error).toMatch(/Read-only/);
    // The Trees-API call included only the writable flow plus the
    // manifest (Phase 4 — manifest rides along on every batch).
    const calledFiles = treeCall.mock.calls[0][1].files as Array<{ path: string }>;
    const flowFiles = calledFiles.filter((f) => !f.path.endsWith('_manifest.json'));
    expect(flowFiles).toHaveLength(1);
  });

  it('returns failure when every flow fails pre-flight', async () => {
    const fx = makeFixture({
      flows: [], // no flows exist locally
    });
    const result = await fx.service.pushFlowsAtomic(fx.db, ['unknown_flow'], {
      commitMessage: 'nothing to push',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to commit/);
    expect(result.results[0].status).toBe('error');
  });
});

// ── 2. Per-flow lock contention ──────────────────────────────────────────

describe('pushFlowsAtomic — concurrency / lock contention', () => {
  it('rejects with LockBusy when one of the requested flows is already locked', async () => {
    const fx = makeFixture({
      flows: [
        { id: 'flow_a', name: 'A' },
        { id: 'flow_b', name: 'B' },
      ],
      configs: [
        { flow_id: 'flow_a', file_path: 'flows/a.flow.ts' },
        { flow_id: 'flow_b', file_path: 'flows/b.flow.ts' },
      ],
    });

    // Pretend another writer is mid-push on flow_a.
    fx.service.locks.tryAcquire('flow_a');

    const result = await fx.service.pushFlowsAtomic(fx.db, ['flow_a', 'flow_b'], {
      commitMessage: 'should bail',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/contention|already being/);

    // flow_b's lock was rolled back after the partial acquisition (it
    // shouldn't be held now that the batch refused).
    expect(fx.service.locks.isHeld('flow_b')).toBe(false);
    fx.service.locks.release('flow_a');
  });

  it('pushFlow returns busy when the same flow is being pushed concurrently', async () => {
    const fx = makeFixture({
      flows: [{ id: 'flow_x', name: 'X' }],
      configs: [{ flow_id: 'flow_x', file_path: 'flows/x.flow.ts' }],
    });
    fx.service.locks.tryAcquire('flow_x');

    const result = await fx.service.pushFlow(fx.db, 'flow_x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/in progress/);
    fx.service.locks.release('flow_x');
  });

  it('pullFlow returns busy when the same flow is being pulled concurrently', async () => {
    const fx = makeFixture({
      flows: [{ id: 'flow_x', name: 'X' }],
      configs: [{ flow_id: 'flow_x', file_path: 'flows/x.flow.ts', sync_direction: 'read' }],
    });
    fx.service.locks.tryAcquire('flow_x');

    const result = await fx.service.pullFlow(fx.db, 'flow_x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/in progress/);
    fx.service.locks.release('flow_x');
  });

  it('locks release after pushFlowsAtomic completes (success and failure paths)', async () => {
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: vi.fn().mockResolvedValue({
        commitSha: 'sha-new',
        files: [{ path: 'flows/f.flow.ts', blobSha: 'blob-1' }],
      }),
    });
    const fx = makeFixture({
      flows: [{ id: 'flow_1', name: 'F' }],
      configs: [{ flow_id: 'flow_1', file_path: 'flows/f.flow.ts' }],
      provider,
    });

    await fx.service.pushFlowsAtomic(fx.db, ['flow_1'], { commitMessage: 'm' });
    expect(fx.service.locks.isHeld('flow_1')).toBe(false);

    // Force a failure path and verify lock still releases.
    const failProvider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'sha-parent' }),
      createTreeCommit: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const fx2 = makeFixture({
      flows: [{ id: 'flow_2', name: 'F2' }],
      configs: [{ flow_id: 'flow_2', file_path: 'flows/f2.flow.ts' }],
      provider: failProvider,
    });

    await expect(
      fx2.service.pushFlowsAtomic(fx2.db, ['flow_2'], { commitMessage: 'fail' }),
    ).rejects.toThrow();
    expect(fx2.service.locks.isHeld('flow_2')).toBe(false);
  });
});

// ── 3. Replica idempotency on pull ───────────────────────────────────────

describe('pull idempotency via vc_pull_commits', () => {
  it('a second pull of the same (flowId, sha) pair is a no-op', async () => {
    // Build a file that imports cleanly (footer present, flowId matches).
    const { emitSdkSource } = await import('@flowlib/sdk');
    const { code } = emitSdkSource(
      {
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
      },
      {
        flowName: 'idempotentFlow',
        includeJsonFooter: true,
        metadata: { flowId: 'flow_idem', name: 'Idempotent' },
      },
    );

    const provider = makeProvider({
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-stable' }),
    });

    const fx = makeFixture({
      flows: [{ id: 'flow_idem', name: 'Idempotent' }],
      configs: [
        {
          flow_id: 'flow_idem',
          file_path: 'flows/idem.flow.ts',
          sync_direction: 'read',
        },
      ],
      provider,
    });

    // First pull: inserts a flow_versions row + records the (flowId, sha).
    const r1 = await fx.service.pullFlow(fx.db, 'flow_idem');
    expect(r1.success).toBe(true);
    expect(fx.state.versionInserts).toHaveLength(1);

    // Reset config.lastCommitSha so the early "already up to date" branch
    // doesn't short-circuit the second call. We're testing the idempotency
    // table specifically, not the lastCommitSha optimization.
    const cfg = fx.state.configs.get('flow_idem');
    if (cfg) {
      cfg.last_commit_sha = null;
    }

    // Second pull at the same SHA: idempotency kicks in, NO new version row.
    const r2 = await fx.service.pullFlow(fx.db, 'flow_idem');
    expect(r2.success).toBe(true);
    expect(fx.state.versionInserts).toHaveLength(1); // still 1, not 2
  });

  it('replica HA simulation: two parallel pulls only insert once', async () => {
    const { emitSdkSource } = await import('@flowlib/sdk');
    const { code } = emitSdkSource(
      {
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
      },
      {
        flowName: 'replicaFlow',
        includeJsonFooter: true,
        metadata: { flowId: 'flow_replica', name: 'Replica' },
      },
    );
    const provider = makeProvider({
      getFileContent: vi.fn().mockResolvedValue({ content: code, sha: 'blob-replica' }),
    });
    const fx = makeFixture({
      flows: [{ id: 'flow_replica', name: 'Replica' }],
      configs: [
        {
          flow_id: 'flow_replica',
          file_path: 'flows/r.flow.ts',
          sync_direction: 'read',
        },
      ],
      provider,
    });

    // Two parallel pulls. Per-flow lock serializes them; one wins, the
    // other gets the busy error. Together they insert exactly one version.
    const [r1, r2] = await Promise.all([
      fx.service.pullFlow(fx.db, 'flow_replica'),
      fx.service.pullFlow(fx.db, 'flow_replica'),
    ]);

    const successCount = [r1, r2].filter((r) => r.success).length;
    const busyCount = [r1, r2].filter(
      (r) => !r.success && /in progress/.test(r.error ?? ''),
    ).length;
    expect(successCount + busyCount).toBe(2);
    expect(successCount).toBe(1);
    expect(fx.state.versionInserts).toHaveLength(1);
  });
});

// ── 4. LockManager primitive ──────────────────────────────────────────────

describe('LockManager', () => {
  it('tryAcquire returns false when key is held; release frees it', () => {
    const lm = new LockManager();
    expect(lm.tryAcquire('a')).toBe(true);
    expect(lm.tryAcquire('a')).toBe(false);
    lm.release('a');
    expect(lm.tryAcquire('a')).toBe(true);
  });

  it('withMultipleTryLocks rolls back partial acquisition on conflict', async () => {
    const lm = new LockManager();
    lm.tryAcquire('b');

    await expect(lm.withMultipleTryLocks(['a', 'b', 'c'], async () => 'ok')).rejects.toBeInstanceOf(
      LockBusyError,
    );

    // 'a' was acquired then rolled back, NOT still held.
    expect(lm.isHeld('a')).toBe(false);
    expect(lm.isHeld('b')).toBe(true); // pre-existing hold
    expect(lm.isHeld('c')).toBe(false);
    lm.release('b');
  });

  it('withTryLock releases on both success and exception', async () => {
    const lm = new LockManager();
    await lm.withTryLock('x', async () => 'ok');
    expect(lm.isHeld('x')).toBe(false);

    await expect(
      lm.withTryLock('x', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(lm.isHeld('x')).toBe(false);
  });

  it('LockBusyError carries the conflicting key', async () => {
    const lm = new LockManager();
    lm.tryAcquire('hot-key');
    try {
      await lm.withTryLock('hot-key', async () => 'never');
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(LockBusyError);
      expect((err as LockBusyError).lockKey).toBe('hot-key');
    }
  });
});

// ── 5. forcePushFlow stays unchanged (single-flow Contents API path) ─────

describe('regression: forcePushFlow uses Contents API as documented', () => {
  it('createOrUpdateFile is still called (not Trees API) for force push', async () => {
    const updateCall = vi.fn().mockResolvedValue({ commitSha: 'sha-fp' });
    const provider = makeProvider({
      getFileContent: vi.fn().mockResolvedValue({ content: 'old', sha: 'old-sha' }),
      createOrUpdateFile: updateCall,
    });
    const fx = makeFixture({
      flows: [{ id: 'flow_fp', name: 'FP' }],
      configs: [{ flow_id: 'flow_fp', file_path: 'flows/fp.flow.ts' }],
      provider,
    });

    const result = await fx.service.forcePushFlow(fx.db, 'flow_fp');
    expect(result.success).toBe(true);
    expect(updateCall).toHaveBeenCalledTimes(1);
    expect(provider.createTreeCommit as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
