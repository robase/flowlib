import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VcSyncService } from '../src/backend/sync-service';
import type { GitProvider } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';

// ── Mock GitProvider ────────────────────────────────────────────────────

function createMockProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-abc123' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue(null),
    createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'https://test/pr/1' }),
    updatePullRequest: vi.fn().mockResolvedValue(undefined),
    getPullRequest: vi.fn().mockResolvedValue({ state: 'open' }),
    closePullRequest: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

// ── Mock Database ───────────────────────────────────────────────────────

function createMockDb(tables: Record<string, unknown[]> = {}): PluginDatabaseApi {
  return {
    type: 'sqlite',
    query: vi.fn(async (sql: string) => {
      // Simple SQL pattern matching for tests
      if (sql.includes('FROM flowlib_flows WHERE')) {
        return tables.flows ?? [];
      }
      if (sql.includes('FROM flowlib_flow_versions WHERE')) {
        return tables.flow_versions ?? [];
      }
      if (sql.includes('FROM flowlib_vc_sync_config')) {
        return tables.vc_sync_config ?? [];
      }
      if (sql.includes('FROM flowlib_vc_sync_history')) {
        return tables.vc_sync_history ?? [];
      }
      return [];
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const defaultOptions: VersionControlPluginOptions = {
  provider: createMockProvider(),
  repo: 'acme/workflows',
  defaultBranch: 'main',
  path: 'workflows/',
  mode: 'direct-commit',
};

describe('VcSyncService', () => {
  let service: VcSyncService;
  let provider: GitProvider;
  let db: PluginDatabaseApi;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createMockProvider();
    service = new VcSyncService(provider, { ...defaultOptions, provider }, mockLogger);
  });

  describe('configureSyncForFlow', () => {
    it('creates a sync config for a flow', async () => {
      db = createMockDb({
        flows: [{ id: 'flow-1', name: 'Test Flow' }],
      });

      // After insert, the getSyncConfig query should return the new config
      (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM flowlib_flows WHERE')) {
          return [{ id: 'flow-1', name: 'Test Flow' }];
        }
        if (sql.includes('FROM flowlib_vc_sync_config')) {
          return [
            {
              id: 'cfg-1',
              flow_id: 'flow-1',
              provider: 'mock',
              repo: 'acme/workflows',
              branch: 'main',
              file_path: 'workflows/test-flow.flow.ts',
              mode: 'direct-commit',
              sync_direction: 'push',
              last_synced_at: null,
              last_commit_sha: null,
              last_synced_version: null,
              draft_branch: null,
              active_pr_number: null,
              active_pr_url: null,
              enabled: 1,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ];
        }
        return [];
      });

      const config = await service.configureSyncForFlow(db, 'flow-1', {});
      expect(config.flowId).toBe('flow-1');
      expect(config.repo).toBe('acme/workflows');
      expect(config.mode).toBe('direct-commit');
      expect(config.enabled).toBe(true);

      // Should have called execute with INSERT
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM flowlib_vc_sync_config'),
        expect.any(Array),
      );
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO flowlib_vc_sync_config'),
        expect.any(Array),
      );
    });

    it('throws if flow not found', async () => {
      db = createMockDb({ flows: [] });
      await expect(service.configureSyncForFlow(db, 'nonexistent', {})).rejects.toThrow(
        'Flow not found',
      );
    });
  });

  describe('getSyncConfig', () => {
    it('returns null when no config exists', async () => {
      db = createMockDb({ vc_sync_config: [] });
      const config = await service.getSyncConfig(db, 'flow-1');
      expect(config).toBeNull();
    });
  });

  describe('pushFlow', () => {
    it('direct-commits a flow to the remote', async () => {
      db = createMockDb({
        vc_sync_config: [
          {
            id: 'cfg-1',
            flow_id: 'flow-1',
            provider: 'mock',
            repo: 'acme/workflows',
            branch: 'main',
            file_path: 'workflows/test.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'push',
            last_synced_at: null,
            last_commit_sha: null,
            last_synced_version: null,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        flows: [{ id: 'flow-1', name: 'Test Flow', description: null, tags: null }],
        flow_versions: [
          {
            flowId: 'flow-1',
            version: 1,
            flowlib_definition: JSON.stringify({
              nodes: [
                {
                  id: 'node-x',
                  type: 'trigger.manual',
                  referenceId: 'x',
                  position: { x: 0, y: 0 },
                  params: {},
                },
              ],
              edges: [],
            }),
          },
        ],
      });

      const result = await service.pushFlow(db, 'flow-1');

      expect(result.success).toBe(true);
      expect(result.commitSha).toBe('sha-abc123');
      expect(result.action).toBe('push');
      expect(provider.createOrUpdateFile).toHaveBeenCalledWith(
        'acme/workflows',
        'workflows/test.flow.ts',
        expect.stringContaining('defineFlow'),
        expect.stringContaining('test.flow.ts'),
        expect.objectContaining({ branch: 'main' }),
      );
    });

    it('returns conflict on SHA mismatch error', async () => {
      const conflictProvider = createMockProvider({
        getFileContent: vi.fn().mockResolvedValue(null),
        createOrUpdateFile: vi
          .fn()
          .mockRejectedValue(new Error('GitHub API error 409: sha mismatch')),
      });
      const conflictService = new VcSyncService(
        conflictProvider,
        { ...defaultOptions, provider: conflictProvider },
        mockLogger,
      );

      db = createMockDb({
        vc_sync_config: [
          {
            id: 'cfg-1',
            flow_id: 'flow-1',
            provider: 'mock',
            repo: 'acme/workflows',
            branch: 'main',
            file_path: 'workflows/test.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'push',
            last_synced_at: null,
            last_commit_sha: 'old-sha',
            last_synced_version: null,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        flows: [{ id: 'flow-1', name: 'Test Flow', description: null, tags: null }],
        flow_versions: [
          {
            flowId: 'flow-1',
            version: 1,
            flowlib_definition: JSON.stringify({
              nodes: [
                {
                  id: 'node-x',
                  type: 'trigger.manual',
                  referenceId: 'x',
                  position: { x: 0, y: 0 },
                  params: {},
                },
              ],
              edges: [],
            }),
          },
        ],
      });

      const result = await conflictService.pushFlow(db, 'flow-1');
      expect(result.success).toBe(false);
      expect(result.action).toBe('conflict');
      expect(result.error).toContain('Conflict');
    });
  });

  describe('getFlowSyncStatus', () => {
    it('returns not-connected when no config exists', async () => {
      db = createMockDb({ vc_sync_config: [] });
      const status = await service.getFlowSyncStatus(db, 'flow-1');
      expect(status.status).toBe('not-connected');
      expect(status.config).toBeNull();
    });

    it('returns synced when config exists and has been synced', async () => {
      db = createMockDb({
        vc_sync_config: [
          {
            id: 'cfg-1',
            flow_id: 'flow-1',
            provider: 'mock',
            repo: 'acme/workflows',
            branch: 'main',
            file_path: 'workflows/test.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'push',
            last_synced_at: '2024-01-01T00:00:00Z',
            last_commit_sha: 'sha-1',
            last_synced_version: 1,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        vc_sync_history: [],
        flow_versions: [{ version: 1 }],
      });

      // Override query to respond to both queries within getFlowSyncStatus
      (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM flowlib_vc_sync_config')) {
          return [
            {
              id: 'cfg-1',
              flow_id: 'flow-1',
              provider: 'mock',
              repo: 'acme/workflows',
              branch: 'main',
              file_path: 'workflows/test.flow.ts',
              mode: 'direct-commit',
              sync_direction: 'push',
              last_synced_at: '2024-01-01T00:00:00Z',
              last_commit_sha: 'sha-1',
              last_synced_version: 1,
              draft_branch: null,
              active_pr_number: null,
              active_pr_url: null,
              enabled: 1,
              created_at: '2024-01-01',
              updated_at: '2024-01-01',
            },
          ];
        }
        if (sql.includes('FROM flowlib_vc_sync_history')) {
          return [];
        }
        if (sql.includes('FROM flow_versions')) {
          return [{ version: 1 }];
        }
        return [];
      });

      const status = await service.getFlowSyncStatus(db, 'flow-1');
      expect(status.status).toBe('synced');
      expect(status.config).not.toBeNull();
    });
  });

  describe('disconnectFlow', () => {
    it('deletes the sync config', async () => {
      db = createMockDb({
        vc_sync_config: [
          {
            id: 'cfg-1',
            flow_id: 'flow-1',
            provider: 'mock',
            repo: 'acme/workflows',
            branch: 'main',
            file_path: 'workflows/test.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'push',
            last_synced_at: null,
            last_commit_sha: null,
            last_synced_version: null,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      await service.disconnectFlow(db, 'flow-1');

      expect(db.execute).toHaveBeenCalledWith(
        'DELETE FROM flowlib_vc_sync_config WHERE flow_id = ?',
        ['flow-1'],
      );
    });

    it('handles no-op when not connected', async () => {
      db = createMockDb({ vc_sync_config: [] });
      // Should not throw
      await service.disconnectFlow(db, 'flow-1');
      expect(db.execute).not.toHaveBeenCalled();
    });
  });
});
