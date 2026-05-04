/**
 * Phase 7 — Diff viewer backend payload.
 *
 * Covers the pure side-by-side line diff plus the service / endpoint payload
 * used by the future DiffModal. Frontend can render `lines` directly without
 * having to re-run diff logic in-browser.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSideBySideDiff } from '../src/backend/diff';
import { VcSyncService } from '../src/backend/sync-service';
import { versionControl } from '../src/backend/plugin';
import type { GitProvider } from '../src/backend/git-provider';
import type { FlowlibPlugin, PluginDatabaseApi, PluginEndpointContext } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';
import { patchMockDb } from './test-helpers/mock-db';

function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-x' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue({ sha: 'head' }),
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

const definition = {
  nodes: [
    {
      id: 'node_a',
      type: 'trigger.manual',
      referenceId: 'q',
      position: { x: 0, y: 0 },
      params: {},
    },
    {
      id: 'node_b',
      type: 'core.output',
      referenceId: 'out',
      position: { x: 200, y: 0 },
      params: { outputValue: '{{ q }}' },
    },
  ],
  edges: [{ id: 'edge_ab', source: 'node_a', target: 'node_b' }],
};

function makeDb(): PluginDatabaseApi {
  return patchMockDb({
    type: 'sqlite',
    query: vi.fn(async (sql: string) => {
      if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_vc_sync_config')) {
        return [
          {
            id: 'cfg-1',
            flow_id: 'flow_diff',
            provider: 'mock',
            repo: 'acme/flows',
            branch: 'main',
            file_path: 'flows/diff.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'read-write',
            last_synced_at: '2026-01-01T00:00:00Z',
            last_commit_sha: 'remote-sha',
            last_synced_version: 1,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ];
      }
      if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_flows')) {
        return [{ id: 'flow_diff', name: 'Diff Flow', description: null, tags: null }];
      }
      if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_flow_versions')) {
        return [
          {
            flow_id: 'flow_diff',
            version: 2,
            flowlib_definition: JSON.stringify(definition),
          },
        ];
      }
      return [];
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PluginDatabaseApi;
}

function makeService(provider: GitProvider): VcSyncService {
  const options: VersionControlPluginOptions = {
    provider,
    repo: 'acme/flows',
    defaultBranch: 'main',
    path: 'flows/',
    mode: 'direct-commit',
  };
  return new VcSyncService(provider, options, silentLogger);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildSideBySideDiff', () => {
  it('pairs one-line replacements as changed rows', () => {
    const rows = buildSideBySideDiff('a\nb\nc\n', 'a\nB\nc\nd\n');

    expect(rows.map((row) => row.kind)).toEqual(['context', 'changed', 'context', 'added']);
    expect(rows[1]).toEqual({
      kind: 'changed',
      remoteLineNumber: 2,
      localLineNumber: 2,
      remoteContent: 'b',
      localContent: 'B',
    });
    expect(rows[3].localContent).toBe('d');
  });

  it('emits removed rows when content exists only remotely', () => {
    const rows = buildSideBySideDiff('a\nb', 'a');

    expect(rows.map((row) => row.kind)).toEqual(['context', 'removed']);
    expect(rows[1].remoteLineNumber).toBe(2);
    expect(rows[1].localLineNumber).toBeNull();
  });
});

describe('VcSyncService.getFlowDiff', () => {
  it('returns a remote-missing diff as local-only rows', async () => {
    const provider = makeProvider({ getFileContent: vi.fn().mockResolvedValue(null) });
    const service = makeService(provider);

    const result = await service.getFlowDiff(makeDb(), 'flow_diff');

    expect(result.flowId).toBe('flow_diff');
    expect(result.filePath).toBe('flows/diff.flow.ts');
    expect(result.hasRemote).toBe(false);
    expect(result.hasChanges).toBe(true);
    expect(result.remote.sha).toBeNull();
    expect(result.local.version).toBe(2);
    expect(result.local.content).toContain('@flowlib-definition');
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines.every((line) => line.kind === 'added')).toBe(true);
  });

  it('returns remote metadata and changed rows when branch content differs', async () => {
    const provider = makeProvider({
      getFileContent: vi.fn().mockResolvedValue({
        sha: 'remote-blob-sha',
        content: 'import { defineFlow } from "@flowlib/sdk";\nexport default defineFlow({});\n',
      }),
    });
    const service = makeService(provider);

    const result = await service.getFlowDiff(makeDb(), 'flow_diff');

    expect(result.hasRemote).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.remote.sha).toBe('remote-blob-sha');
    expect(result.remote.content).toContain('defineFlow');
    expect(result.lines.some((line) => line.kind !== 'context')).toBe(true);
  });

  it('throws a clear error for untracked flows', async () => {
    const provider = makeProvider();
    const service = makeService(provider);
    const db = patchMockDb({
      ...makeDb(),
      query: vi.fn(async (sql: string) => {
        if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_vc_sync_config')) {
          return [];
        }
        return [];
      }),
    }) as unknown as PluginDatabaseApi;

    await expect(service.getFlowDiff(db, 'flow_missing')).rejects.toThrow(/not connected/);
  });
});

describe('GET /vc/flows/:flowId/diff endpoint', () => {
  it('returns the diff payload through the plugin endpoint', async () => {
    const provider = makeProvider({ getFileContent: vi.fn().mockResolvedValue(null) });
    const def = versionControl({
      provider,
      repo: 'acme/flows',
      defaultBranch: 'main',
      path: 'flows/',
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
          plugins: {
            getDatabaseConnection: () => ({ type: 'sqlite', driver: {} }),
          },
        }) as never,
    });

    const endpoint = backend.endpoints?.find(
      (entry) => entry.method === 'GET' && entry.path === '/vc/flows/:flowId/diff',
    );
    if (!endpoint) {
      throw new Error('diff endpoint missing');
    }

    const result = await endpoint.handler({
      database: makeDb(),
      params: { flowId: 'flow_diff' },
      query: {},
      body: null,
    } as unknown as PluginEndpointContext);

    expect(result.status).toBe(200);
    expect(result.body.flowId).toBe('flow_diff');
    expect(result.body.lines.length).toBeGreaterThan(0);
  });

  it('maps untracked flow errors to 404', async () => {
    const provider = makeProvider();
    const def = versionControl({
      provider,
      repo: 'acme/flows',
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
          plugins: {
            getDatabaseConnection: () => ({ type: 'sqlite', driver: {} }),
          },
        }) as never,
    });
    const endpoint = backend.endpoints?.find(
      (entry) => entry.method === 'GET' && entry.path === '/vc/flows/:flowId/diff',
    );
    if (!endpoint) {
      throw new Error('diff endpoint missing');
    }

    const emptyDb = patchMockDb({
      type: 'sqlite',
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
    }) as unknown as PluginDatabaseApi;

    const result = await endpoint.handler({
      database: emptyDb,
      params: { flowId: 'flow_missing' },
      query: {},
      body: null,
    } as unknown as PluginEndpointContext);

    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not connected/);
  });
});
