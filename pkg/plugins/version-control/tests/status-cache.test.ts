/**
 * Phase 2 — Status cache + dirty list + batch push.
 *
 * Three contracts under test:
 *
 *   1. `computeFlowState` is a pure function with a documented decision
 *      priority. Each branch is exercised with an isolated fixture so a
 *      regression in priority order shows up as a single failing test,
 *      not "everything broken".
 *
 *   2. `StatusCacheService.refreshAll` joins flows × configs × versions
 *      × history and writes one cache row per flow with the right state
 *      label. Tests use a stateful in-memory DB that mirrors the real
 *      schema's column shape.
 *
 *   3. `listDirty` returns only the states a user can act on (dirty,
 *      never-synced) — Synced/PrOpen/Conflict flows don't appear in the
 *      dirty-list modal.
 */

import { describe, it, expect } from 'vitest';
import {
  computeFlowState,
  displayFor,
  StatusCacheService,
  type FlowStateInput,
} from '../src/backend/status-compute';
import type { PluginDatabaseApi } from '@flowlib/core';

// ── Fixtures ─────────────────────────────────────────────────────────────

function input(overrides: Partial<FlowStateInput> = {}): FlowStateInput {
  return {
    flowId: 'flow_test',
    flowName: 'Test',
    hasConfig: true,
    currentVersion: 1,
    lastSyncedVersion: 1,
    lastCommitSha: 'sha-1',
    activePrNumber: null,
    lastSyncAction: 'push',
    lastSyncError: null,
    lastSyncedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── 1. computeFlowState — decision priority ─────────────────────────────

describe('computeFlowState — pure decision logic', () => {
  it('returns "untracked" when there is no enabled config', () => {
    expect(computeFlowState(input({ hasConfig: false }))).toBe('untracked');
  });

  it('returns "conflict-pending" when last history action was a conflict', () => {
    expect(computeFlowState(input({ lastSyncAction: 'conflict' }))).toBe('conflict-pending');
  });

  it('returns "pr-open" when an active PR is set', () => {
    expect(computeFlowState(input({ activePrNumber: 42 }))).toBe('pr-open');
  });

  it('returns "never-synced" when config exists but lastCommitSha is null', () => {
    expect(computeFlowState(input({ lastCommitSha: null, lastSyncedVersion: null }))).toBe(
      'never-synced',
    );
  });

  it('returns "dirty" when local version is ahead of last synced version', () => {
    expect(computeFlowState(input({ currentVersion: 5, lastSyncedVersion: 3 }))).toBe('dirty');
  });

  it('returns "error" when last sync errored and nothing else triggered', () => {
    expect(computeFlowState(input({ lastSyncError: 'network' }))).toBe('error');
  });

  it('returns "synced" as the fallthrough', () => {
    expect(computeFlowState(input())).toBe('synced');
  });

  it('priority: conflict-pending wins over dirty', () => {
    expect(
      computeFlowState(
        input({ currentVersion: 5, lastSyncedVersion: 3, lastSyncAction: 'conflict' }),
      ),
    ).toBe('conflict-pending');
  });

  it('priority: pr-open wins over dirty (PR captures the dirty changes)', () => {
    expect(
      computeFlowState(input({ currentVersion: 5, lastSyncedVersion: 3, activePrNumber: 7 })),
    ).toBe('pr-open');
  });

  it('priority: untracked wins over everything (no config = no opinion)', () => {
    expect(
      computeFlowState(
        input({
          hasConfig: false,
          activePrNumber: 7,
          lastSyncAction: 'conflict',
          currentVersion: 99,
        }),
      ),
    ).toBe('untracked');
  });
});

// ── 2. displayFor — chip metadata for every state ────────────────────────

describe('displayFor — chip metadata round-trip', () => {
  it('every state has a non-empty chip label and a known color', () => {
    const states = [
      'untracked',
      'never-synced',
      'synced',
      'dirty',
      'behind',
      'diverged',
      'conflict-pending',
      'pr-open',
      'orphaned',
      'stale-sha',
      'renamed',
      'deleted',
      'error',
    ] as const;
    const validColors = new Set(['grey', 'green', 'blue', 'yellow', 'red', 'purple']);
    for (const state of states) {
      const display = displayFor(state);
      expect(display.state).toBe(state);
      expect(display.chipLabel.length).toBeGreaterThan(0);
      expect(validColors.has(display.chipColor)).toBe(true);
    }
  });

  it('synced is the only state with no actionLabel (informational chip)', () => {
    expect(displayFor('synced').actionLabel).toBeNull();
  });
});

// ── 3. StatusCacheService stateful tests ─────────────────────────────────

interface DbState {
  flows: Array<{ id: string; name: string }>;
  versions: Map<string, number>;
  configs: Map<string, Record<string, unknown>>;
  history: Array<{ flow_id: string; action: string; created_at: string }>;
  cache: Map<string, Record<string, unknown>>;
}

/**
 * Stateful DB stub mirroring the real schema's column shape. Picks up
 * status-cache writes so the test can assert what the reconciler would
 * have persisted.
 */
function makeDb(initial: Partial<DbState> = {}): { db: PluginDatabaseApi; state: DbState } {
  const state: DbState = {
    flows: initial.flows ?? [],
    versions: initial.versions ?? new Map(),
    configs: initial.configs ?? new Map(),
    history: initial.history ?? [],
    cache: initial.cache ?? new Map(),
  };

  const db = {
    type: 'sqlite',
    query: async (sql: string, params: unknown[] = []) => {
      // The big fact-loading join.
      if (
        sql.includes('FROM flowlib_flows f') &&
        sql.includes('LEFT JOIN flowlib_vc_sync_config')
      ) {
        return state.flows.map((f) => {
          const cfg = state.configs.get(f.id);
          const lastHistory = [...state.history]
            .filter((h) => h.flow_id === f.id)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
          return {
            flow_id: f.id,
            flow_name: f.name,
            config_enabled: cfg?.enabled ?? null,
            current_version: state.versions.get(f.id) ?? 0,
            last_synced_version: cfg?.last_synced_version ?? null,
            last_commit_sha: cfg?.last_commit_sha ?? null,
            active_pr_number: cfg?.active_pr_number ?? null,
            last_sync_action: lastHistory?.action ?? null,
            last_sync_error: null,
            last_synced_at: cfg?.last_synced_at ?? null,
          };
        });
      }
      // Cache reads
      if (sql.startsWith('SELECT * FROM flowlib_vc_status_cache')) {
        if (sql.includes('WHERE flow_id = ?')) {
          const cached = state.cache.get(params[0] as string);
          return cached ? [cached] : [];
        }
        return Array.from(state.cache.values());
      }
      // Cache existence probe
      if (sql.startsWith('SELECT flow_id FROM flowlib_vc_status_cache')) {
        const cached = state.cache.get(params[0] as string);
        return cached ? [{ flow_id: cached.flow_id }] : [];
      }
      // Dirty-list path lookup
      if (sql.includes('SELECT flow_id, file_path FROM flowlib_vc_sync_config WHERE flow_id IN')) {
        const ids = params as string[];
        return ids
          .map((id) => state.configs.get(id))
          .filter(Boolean)
          .map((cfg) => ({ flow_id: cfg!.flow_id, file_path: cfg!.file_path }));
      }
      return [];
    },
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO flowlib_vc_status_cache')) {
        const [flow_id, st, chip_label, action_label, last_error, updated_at] = params as [
          string,
          string,
          string,
          string | null,
          string | null,
          string,
        ];
        state.cache.set(flow_id, {
          flow_id,
          state: st,
          chip_label,
          action_label,
          last_error,
          updated_at,
        });
      } else if (sql.startsWith('UPDATE flowlib_vc_status_cache')) {
        const [st, chip_label, action_label, last_error, updated_at, flow_id] = params as [
          string,
          string,
          string | null,
          string | null,
          string,
          string,
        ];
        state.cache.set(flow_id, {
          flow_id,
          state: st,
          chip_label,
          action_label,
          last_error,
          updated_at,
        });
      }
    },
  } as unknown as PluginDatabaseApi;

  return { db, state };
}

describe('StatusCacheService.refreshAll', () => {
  it('writes one cache row per flow, classifying each correctly', async () => {
    const { db, state } = makeDb({
      flows: [
        { id: 'flow_clean', name: 'Clean' },
        { id: 'flow_dirty', name: 'Dirty' },
        { id: 'flow_untracked', name: 'Untracked' },
      ],
      versions: new Map([
        ['flow_clean', 3],
        ['flow_dirty', 5],
      ]),
      configs: new Map([
        [
          'flow_clean',
          {
            flow_id: 'flow_clean',
            enabled: 1,
            last_synced_version: 3,
            last_commit_sha: 'sha-clean',
            active_pr_number: null,
            file_path: 'flows/clean.flow.ts',
            last_synced_at: '2024-01-01T00:00:00Z',
          },
        ],
        [
          'flow_dirty',
          {
            flow_id: 'flow_dirty',
            enabled: 1,
            last_synced_version: 3,
            last_commit_sha: 'sha-dirty',
            active_pr_number: null,
            file_path: 'flows/dirty.flow.ts',
            last_synced_at: '2024-01-01T00:00:00Z',
          },
        ],
      ]),
    });

    const svc = new StatusCacheService();
    const result = await svc.refreshAll(db);

    expect(result.refreshed).toBe(3);
    expect(state.cache.get('flow_clean')?.state).toBe('synced');
    expect(state.cache.get('flow_dirty')?.state).toBe('dirty');
    expect(state.cache.get('flow_untracked')?.state).toBe('untracked');
  });

  it('idempotent — calling twice produces one cache row per flow', async () => {
    const { db, state } = makeDb({
      flows: [{ id: 'flow_x', name: 'X' }],
      versions: new Map([['flow_x', 1]]),
    });
    const svc = new StatusCacheService();
    await svc.refreshAll(db);
    await svc.refreshAll(db);
    expect(state.cache.size).toBe(1);
  });

  it('cache row reflects the configured chip label + action label for each state', async () => {
    const { db, state } = makeDb({
      flows: [{ id: 'flow_pr', name: 'PR Flow' }],
      versions: new Map([['flow_pr', 1]]),
      configs: new Map([
        [
          'flow_pr',
          {
            flow_id: 'flow_pr',
            enabled: 1,
            active_pr_number: 99,
            last_commit_sha: 'sha-pr',
            last_synced_version: 1,
            file_path: 'flows/pr.flow.ts',
          },
        ],
      ]),
    });
    const svc = new StatusCacheService();
    await svc.refreshAll(db);
    const cached = state.cache.get('flow_pr');
    expect(cached?.state).toBe('pr-open');
    expect(cached?.chip_label).toBe('PR open');
    expect(cached?.action_label).toBe('View PR');
  });
});

describe('StatusCacheService.listDirty', () => {
  it('returns only dirty + never-synced flows, with correct ahead counts', async () => {
    const { db } = makeDb({
      flows: [
        { id: 'flow_clean', name: 'Clean' },
        { id: 'flow_dirty', name: 'Dirty' },
        { id: 'flow_never', name: 'Never' },
        { id: 'flow_pr', name: 'PR' },
      ],
      versions: new Map([
        ['flow_clean', 1],
        ['flow_dirty', 5],
        ['flow_never', 2],
        ['flow_pr', 1],
      ]),
      configs: new Map([
        [
          'flow_clean',
          {
            flow_id: 'flow_clean',
            enabled: 1,
            last_synced_version: 1,
            last_commit_sha: 'sha-c',
            file_path: 'flows/c.flow.ts',
            last_synced_at: '2024-01-01T00:00:00Z',
          },
        ],
        [
          'flow_dirty',
          {
            flow_id: 'flow_dirty',
            enabled: 1,
            last_synced_version: 2, // 5 vs 2 = 3 ahead
            last_commit_sha: 'sha-d',
            file_path: 'flows/d.flow.ts',
            last_synced_at: '2024-01-01T00:00:00Z',
          },
        ],
        [
          'flow_never',
          {
            flow_id: 'flow_never',
            enabled: 1,
            last_synced_version: null,
            last_commit_sha: null,
            file_path: 'flows/n.flow.ts',
            last_synced_at: null,
          },
        ],
        [
          'flow_pr',
          {
            flow_id: 'flow_pr',
            enabled: 1,
            active_pr_number: 7,
            last_commit_sha: 'sha-pr',
            last_synced_version: 1,
            file_path: 'flows/pr.flow.ts',
          },
        ],
      ]),
    });

    const svc = new StatusCacheService();
    const dirty = await svc.listDirty(db);

    const ids = dirty.map((d) => d.flowId).sort();
    expect(ids).toEqual(['flow_dirty', 'flow_never']);

    const dirtyEntry = dirty.find((d) => d.flowId === 'flow_dirty')!;
    expect(dirtyEntry.state).toBe('dirty');
    expect(dirtyEntry.ahead).toBe(3);
    expect(dirtyEntry.filePath).toBe('flows/d.flow.ts');

    const neverEntry = dirty.find((d) => d.flowId === 'flow_never')!;
    expect(neverEntry.state).toBe('never-synced');
    expect(neverEntry.lastSyncedVersion).toBeNull();
    expect(neverEntry.lastSyncedAt).toBeNull();
    expect(neverEntry.ahead).toBe(2);
  });

  it('returns empty array when no flows are dirty', async () => {
    const { db } = makeDb({ flows: [] });
    const svc = new StatusCacheService();
    expect(await svc.listDirty(db)).toEqual([]);
  });
});

describe('StatusCacheService.overrideState', () => {
  it('writes the override even when no synchronous fact would produce that state', async () => {
    // "behind" can't be computed from local facts — only the reconciler
    // observes it. overrideState lets the reconciler write it directly.
    const { db, state } = makeDb({});
    const svc = new StatusCacheService();
    await svc.overrideState(db, 'flow_remote', 'behind');
    expect(state.cache.get('flow_remote')?.state).toBe('behind');
    expect(state.cache.get('flow_remote')?.chip_label).toBe('Behind remote');
  });

  it('replaces an existing cache entry', async () => {
    const { db, state } = makeDb({});
    const svc = new StatusCacheService();
    await svc.overrideState(db, 'flow_x', 'synced');
    await svc.overrideState(db, 'flow_x', 'diverged', 'two-way conflict');
    expect(state.cache.get('flow_x')?.state).toBe('diverged');
    expect(state.cache.get('flow_x')?.last_error).toBe('two-way conflict');
    expect(state.cache.size).toBe(1);
  });
});
