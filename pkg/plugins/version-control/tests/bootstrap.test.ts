/**
 * Phase 5 — Bootstrap + observability.
 *
 * Covers the backend data path for first-time setup:
 *   - scenario detection (empty repo, fresh deploy, reconcile, foreign repo)
 *   - hydrate imports remote .flow.ts files with stable flowIds
 *   - operator endpoints expose health + recent activity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';
import { BootstrapService } from '../src/backend/bootstrap';
import { versionControl } from '../src/backend/plugin';
import type { GitProvider, GitTreeEntry } from '../src/backend/git-provider';
import type { PluginDatabaseApi, FlowlibPlugin, PluginEndpointContext } from '@flowlib/core';

function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-x' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue({ sha: 'head-1' }),
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

function flowFile(flowId: string, name: string): string {
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
      flowName: name.replace(/[^a-zA-Z0-9]/g, '') || 'flow',
      includeJsonFooter: true,
      metadata: { flowId, name },
    },
  );
  return code;
}

interface TestState {
  instanceState: { id: string; last_instance_commit_sha: string | null } | null;
  flows: Map<string, { id: string; name: string; description: string | null; tags: string | null }>;
  versions: Array<{ flow_id: string; version: number; flowlib_definition: string }>;
  configs: Map<string, Record<string, unknown>>;
  pullCommits: Array<{ flow_id: string; commit_sha: string; version_inserted: number }>;
  history: Array<Record<string, unknown>>;
  cache: Map<string, Record<string, unknown>>;
}

function makeDb(initial: Partial<TestState> = {}): { db: PluginDatabaseApi; state: TestState } {
  const state: TestState = {
    instanceState: initial.instanceState ?? null,
    flows: initial.flows ?? new Map(),
    versions: initial.versions ?? [],
    configs: initial.configs ?? new Map(),
    pullCommits: initial.pullCommits ?? [],
    history: initial.history ?? [],
    cache: initial.cache ?? new Map(),
  };

  const db = {
    type: 'sqlite' as const,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM flowlib_vc_instance_state')) {
        return state.instanceState ? [state.instanceState] : [];
      }
      if (sql.includes('SELECT COUNT(*) as c FROM flowlib_flows')) {
        return [{ c: state.flows.size }];
      }
      if (sql.includes('SELECT id FROM flowlib_flows WHERE id = ?')) {
        const id = params[0] as string;
        return state.flows.has(id) ? [{ id }] : [];
      }
      if (sql.includes('SELECT name FROM flowlib_flows WHERE id = ?')) {
        const row = state.flows.get(params[0] as string);
        return row ? [{ name: row.name }] : [];
      }
      if (sql.trim() === 'SELECT id FROM flowlib_flows') {
        return Array.from(state.flows.values()).map((row) => ({ id: row.id }));
      }
      if (sql.startsWith('SELECT * FROM flowlib_vc_status_cache')) {
        return Array.from(state.cache.values());
      }
      if (
        sql.includes('FROM flowlib_flows f') &&
        sql.includes('LEFT JOIN flowlib_vc_sync_config')
      ) {
        return Array.from(state.flows.values()).map((flow) => {
          const cfg = state.configs.get(flow.id);
          return {
            flow_id: flow.id,
            flow_name: flow.name,
            config_enabled: cfg?.enabled ?? null,
            current_version:
              state.versions.filter((v) => v.flow_id === flow.id).at(-1)?.version ?? 0,
            last_synced_version: cfg?.last_synced_version ?? null,
            last_commit_sha: cfg?.last_commit_sha ?? null,
            active_pr_number: cfg?.active_pr_number ?? null,
            last_sync_action: null,
            last_sync_error: null,
            last_synced_at: cfg?.last_synced_at ?? null,
          };
        });
      }
      if (sql.includes('FROM flowlib_vc_sync_history h')) {
        return state.history.slice(0, Number(params[0] ?? 20));
      }
      if (sql.startsWith('SELECT flow_id FROM flowlib_vc_status_cache')) {
        const row = state.cache.get(params[0] as string);
        return row ? [{ flow_id: row.flow_id }] : [];
      }
      if (sql.includes('SELECT flow_id, file_path FROM flowlib_vc_sync_config')) {
        return [];
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO flowlib_flows')) {
        const [id, name, description, tags] = params as [
          string,
          string,
          string | null,
          string | null,
        ];
        state.flows.set(id, { id, name, description, tags });
      } else if (sql.includes('INSERT INTO flowlib_flow_versions')) {
        const [flow_id, version, flowlib_definition] = params as [string, number, string];
        state.versions.push({ flow_id, version, flowlib_definition });
      } else if (sql.includes('INSERT INTO flowlib_vc_sync_config')) {
        const [
          id,
          flow_id,
          provider,
          repo,
          branch,
          file_path,
          mode,
          sync_direction,
          last_synced_at,
          last_commit_sha,
          last_synced_version,
          enabled,
        ] = params;
        state.configs.set(flow_id as string, {
          id,
          flow_id,
          provider,
          repo,
          branch,
          file_path,
          mode,
          sync_direction,
          last_synced_at,
          last_commit_sha,
          last_synced_version,
          enabled,
        });
      } else if (sql.includes('INSERT INTO flowlib_vc_pull_commits')) {
        const [flow_id, commit_sha, version_inserted] = params as [string, string, number];
        state.pullCommits.push({ flow_id, commit_sha, version_inserted });
      } else if (sql.includes('INSERT INTO flowlib_vc_sync_history')) {
        const [, flow_id, action, commit_sha, version, message, created_at, created_by] = params;
        state.history.unshift({
          flow_id,
          flow_name: state.flows.get(flow_id as string)?.name ?? null,
          file_path: state.configs.get(flow_id as string)?.file_path ?? null,
          action,
          commit_sha,
          pr_number: null,
          version,
          message,
          created_at,
          created_by,
        });
      } else if (sql.includes('INSERT INTO flowlib_vc_instance_state')) {
        const [id, , , last_instance_commit_sha] = params as [
          string,
          string,
          string,
          string | null,
        ];
        state.instanceState = { id, last_instance_commit_sha };
      } else if (sql.startsWith('UPDATE flowlib_vc_instance_state')) {
        const [last_instance_commit_sha] = params as [string | null];
        state.instanceState = {
          id: state.instanceState?.id ?? 'instance-1',
          last_instance_commit_sha,
        };
      }
    }),
  } as unknown as PluginDatabaseApi;

  return { db, state };
}

function makeBootstrap(provider: GitProvider): BootstrapService {
  return new BootstrapService({
    repo: 'acme/flows',
    branch: 'main',
    path: 'flows/',
    provider,
    logger: silentLogger,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BootstrapService.detect', () => {
  it('classifies empty repo with local flows as empty-repo / push-all', async () => {
    const provider = makeProvider({ listTree: vi.fn().mockResolvedValue([]) });
    const { db } = makeDb({
      flows: new Map([
        ['flow_local', { id: 'flow_local', name: 'Local', description: null, tags: null }],
      ]),
    });

    const result = await makeBootstrap(provider).detect(db);

    expect(result.scenario).toBe('empty-repo');
    expect(result.recommendedAction).toBe('push-all');
    expect(result.localFlowCount).toBe(1);
    expect(result.remoteFlowCount).toBe(0);
  });

  it('classifies remote flows + empty DB as fresh-deploy / hydrate', async () => {
    const provider = makeProvider({
      listTree: vi
        .fn()
        .mockResolvedValue([
          { path: 'flows/alpha.flow.ts', type: 'blob', sha: 'blob-a' } satisfies GitTreeEntry,
        ]),
      getFileContent: vi
        .fn()
        .mockResolvedValue({ content: flowFile('flow_alpha', 'Alpha'), sha: 'blob-a' }),
    });
    const { db } = makeDb();

    const result = await makeBootstrap(provider).detect(db);

    expect(result.scenario).toBe('fresh-deploy');
    expect(result.recommendedAction).toBe('hydrate');
    expect(result.files[0].embeddedFlowId).toBe('flow_alpha');
  });

  it('classifies mostly matching ids as reconcile / merge', async () => {
    const provider = makeProvider({
      listTree: vi
        .fn()
        .mockResolvedValue([
          { path: 'flows/alpha.flow.ts', type: 'blob', sha: 'blob-a' } satisfies GitTreeEntry,
        ]),
      getFileContent: vi
        .fn()
        .mockResolvedValue({ content: flowFile('flow_alpha', 'Alpha'), sha: 'blob-a' }),
    });
    const { db } = makeDb({
      flows: new Map([
        ['flow_alpha', { id: 'flow_alpha', name: 'Alpha', description: null, tags: null }],
      ]),
    });

    const result = await makeBootstrap(provider).detect(db);

    expect(result.scenario).toBe('reconcile');
    expect(result.recommendedAction).toBe('merge');
    expect(result.matchingIds).toBe(1);
  });

  it('classifies name collision with low match ratio as foreign-repo', async () => {
    const provider = makeProvider({
      listTree: vi
        .fn()
        .mockResolvedValue([
          { path: 'flows/collision.flow.ts', type: 'blob', sha: 'blob-c' } satisfies GitTreeEntry,
          { path: 'flows/remote-only.flow.ts', type: 'blob', sha: 'blob-r' } satisfies GitTreeEntry,
          { path: 'flows/remote-two.flow.ts', type: 'blob', sha: 'blob-r2' } satisfies GitTreeEntry,
        ]),
      getFileContent: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        if (path.includes('collision')) {
          return { content: flowFile('flow_collision', 'Remote Name'), sha: 'blob-c' };
        }
        if (path.includes('remote-two')) {
          return { content: flowFile('flow_remote_two', 'Two'), sha: 'blob-r2' };
        }
        return { content: flowFile('flow_remote', 'Remote'), sha: 'blob-r' };
      }),
    });
    const { db } = makeDb({
      flows: new Map([
        [
          'flow_collision',
          { id: 'flow_collision', name: 'Local Name', description: null, tags: null },
        ],
      ]),
    });

    const result = await makeBootstrap(provider).detect(db);

    expect(result.scenario).toBe('foreign-repo');
    expect(result.recommendedAction).toBe('refuse');
    expect(result.conflictingIds).toBe(1);
  });
});

describe('BootstrapService.hydrate', () => {
  it('imports remote flow files and advances instance state to branch head', async () => {
    const provider = makeProvider({
      listTree: vi
        .fn()
        .mockResolvedValue([
          { path: 'flows/alpha.flow.ts', type: 'blob', sha: 'blob-a' } satisfies GitTreeEntry,
        ]),
      getFileContent: vi
        .fn()
        .mockResolvedValue({ content: flowFile('flow_alpha', 'Alpha'), sha: 'blob-a' }),
    });
    const { db, state } = makeDb();
    const service = makeBootstrap(provider);
    const detection = await service.detect(db);

    const result = await service.hydrate(db, detection, 'user-1');

    expect(result.status).toBe('success');
    expect(result.flowsAffected).toBe(1);
    expect(state.flows.get('flow_alpha')?.name).toBe('Alpha');
    expect(state.versions).toHaveLength(1);
    expect(state.configs.get('flow_alpha')?.last_commit_sha).toBe('blob-a');
    expect(state.pullCommits).toEqual([
      { flow_id: 'flow_alpha', commit_sha: 'blob-a', version_inserted: 1 },
    ]);
    expect(state.instanceState?.last_instance_commit_sha).toBe('head-1');
  });

  it('reports partial when one remote file cannot be imported', async () => {
    const provider = makeProvider({
      listTree: vi
        .fn()
        .mockResolvedValue([
          { path: 'flows/alpha.flow.ts', type: 'blob', sha: 'blob-a' } satisfies GitTreeEntry,
          { path: 'flows/legacy.flow.ts', type: 'blob', sha: 'blob-l' } satisfies GitTreeEntry,
        ]),
      getFileContent: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        if (path.includes('legacy')) {
          return { content: '// no footer', sha: 'blob-l' };
        }
        return { content: flowFile('flow_alpha', 'Alpha'), sha: 'blob-a' };
      }),
    });
    const { db } = makeDb();
    const service = makeBootstrap(provider);
    const detection = await service.detect(db);

    const result = await service.hydrate(db, detection, null);

    expect(result.status).toBe('partial');
    expect(result.flowsAffected).toBe(1);
    expect(result.errors?.[0].error).toMatch(/No embedded flowId/);
  });
});

describe('Phase 5 plugin endpoints', () => {
  function endpoint(path: string, method: string = 'GET') {
    const plugin = versionControl({
      provider: makeProvider(),
      repo: 'acme/flows',
      reconcilerIntervalMs: 0,
    }).backend as FlowlibPlugin;
    const found = plugin.endpoints?.find((e) => e.path === path && e.method === method);
    if (!found) {
      throw new Error(`missing endpoint ${method} ${path}`);
    }
    return found.handler;
  }

  it('/vc/health includes dirty/conflict counts and lag fields', async () => {
    const { db } = makeDb({
      flows: new Map([
        ['flow_dirty', { id: 'flow_dirty', name: 'Dirty', description: null, tags: null }],
      ]),
      versions: [{ flow_id: 'flow_dirty', version: 2, flowlib_definition: '{}' }],
      configs: new Map([
        [
          'flow_dirty',
          {
            flow_id: 'flow_dirty',
            enabled: 1,
            last_synced_version: 1,
            last_commit_sha: 'blob-1',
            active_pr_number: null,
            last_synced_at: '2026-01-01T00:00:00Z',
          },
        ],
      ]),
      cache: new Map([
        [
          'flow_conflict',
          {
            flow_id: 'flow_conflict',
            state: 'conflict-pending',
            chip_label: 'Conflict',
            action_label: 'Resolve',
            last_error: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      ]),
    });

    const result = await endpoint('/vc/health')({
      database: db,
      query: {},
      params: {},
      body: null,
    } as PluginEndpointContext);

    expect(result.status).toBe(200);
    expect(result.body.dirtyCount).toBe(1);
    expect(result.body.conflictCount).toBe(1);
    expect(result.body.syncLagSeconds).toBeNull();
    expect(result.body.webhooks.primary).toBe(false);
    expect(result.body.webhooks.secretRequired).toBe(false);
    expect(result.body.hardening.auth.provider).toBe('mock');
  });

  it('/vc/activity returns recent history in endpoint-friendly camelCase', async () => {
    const { db, state } = makeDb();
    state.history.push({
      flow_id: 'flow_a',
      flow_name: 'A',
      file_path: 'flows/a.flow.ts',
      action: 'push',
      commit_sha: 'sha-a',
      pr_number: null,
      version: 2,
      message: 'Pushed',
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'user-1',
    });

    const result = await endpoint('/vc/activity')({
      database: db,
      query: { limit: '10' },
      params: {},
      body: null,
    } as unknown as PluginEndpointContext);

    expect(result.status).toBe(200);
    expect(result.body.activity).toEqual([
      {
        flowId: 'flow_a',
        flowName: 'A',
        filePath: 'flows/a.flow.ts',
        action: 'push',
        commitSha: 'sha-a',
        prNumber: null,
        version: 2,
        message: 'Pushed',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'user-1',
      },
    ]);
  });
});
