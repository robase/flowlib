/**
 * Phase 0a — flowId identity in the pull path.
 *
 * The plugin must identify flows by their stable `flowId`, not by their file
 * path. File paths change on rename; flowId does not. Without this, a rename
 * on dev silently destroys a flow's history (RBAC permissions, run history,
 * version chain) when the rename is pulled on prod.
 *
 * These tests exercise the contract:
 *   - Emitter embeds flowId in the JSON footer.
 *   - Parser surfaces the embedded flowId via `metadata.flowId`.
 *   - `extractFlowIdFromContent()` is the canonical extraction helper.
 *   - Legacy files (no footer, or footer without flowId) fall back gracefully.
 *   - `importFlowContent` refuses to import a file whose embedded flowId
 *     doesn't match the caller-provided id (corruption guard).
 *   - `findFlowConfigByEmbeddedId` resolves the local config row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';
import {
  VcSyncService,
  parseFlowTsContent,
  extractFlowIdFromContent,
} from '../src/backend/sync-service';
import type { GitProvider } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';

// ── Test fixtures ───────────────────────────────────────────────────────

function makeProvider(): GitProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    getFileContent: vi.fn().mockResolvedValue(null),
    createOrUpdateFile: vi.fn().mockResolvedValue({ commitSha: 'sha-x' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue(null),
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

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const options: VersionControlPluginOptions = {
  provider: makeProvider(),
  repo: 'acme/flows',
  defaultBranch: 'main',
  path: 'flows/',
  mode: 'direct-commit',
};

const minimalDefinition = {
  nodes: [
    {
      id: 'node_a',
      type: 'trigger.manual',
      referenceId: 'q',
      position: { x: 0, y: 0 },
      params: { variableName: 'q' },
    },
    {
      id: 'node_b',
      type: 'core.output',
      referenceId: 'r',
      position: { x: 200, y: 0 },
      params: { outputValue: '{{ q }}' },
    },
  ],
  edges: [{ id: 'e1', source: 'node_a', target: 'node_b' }],
};

// ── 1. Emitter embeds flowId in the footer ─────────────────────────────────

describe('flowId in emitted footer', () => {
  it('emitter places flowId into metadata when caller passes it', () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'embeddedIdFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_abc123', name: 'Embedded ID' },
    });

    const match = code.match(/\/\*\s*@flowlib-definition\s+([\s\S]*?)\s*\*\//);
    expect(match).not.toBeNull();
    const footer = JSON.parse(match![1]);
    expect(footer.metadata.flowId).toBe('flow_abc123');
  });

  it('parser surfaces metadata.flowId from the footer', () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'embeddedIdFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_xyz', name: 'Parsed ID' },
    });

    const parsed = parseFlowTsContent(code);
    expect(parsed?.metadata?.flowId).toBe('flow_xyz');
  });

  it('extractFlowIdFromContent is the canonical helper', () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'helperFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_helper_test', name: 'Helper' },
    });

    expect(extractFlowIdFromContent(code)).toBe('flow_helper_test');
  });
});

// ── 2. Graceful degradation for legacy / hand-written files ────────────────

describe('legacy file handling', () => {
  it('returns null flowId when footer has no flowId field (older emitter)', () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'noIdFlow',
      includeJsonFooter: true,
      metadata: { name: 'Pre-flowId emitter' },
    });

    expect(extractFlowIdFromContent(code)).toBeNull();
    const parsed = parseFlowTsContent(code);
    // metadata is still surfaced — just without flowId.
    expect(parsed?.metadata?.name).toBe('Pre-flowId emitter');
  });

  it('returns null flowId for hand-written files with no footer at all', () => {
    // No `@flowlib-definition` block → no metadata available, regardless of
    // whether the fallback array-form parser can extract nodes/edges.
    const handWritten = `
import { defineFlow, input, output } from "@flowlib/sdk";

export const myFlow = defineFlow({
  nodes: {
    q: input(),
    r: output({ value: "{{ q }}" }),
  },
  edges: [{ from: "q", to: "r" }],
});
`;
    expect(extractFlowIdFromContent(handWritten)).toBeNull();
  });

  it('returns null when the file has no parsable content', () => {
    expect(extractFlowIdFromContent('// empty file')).toBeNull();
    expect(extractFlowIdFromContent('')).toBeNull();
  });

  it('rejects non-string flowId values', () => {
    // Edge case — someone hand-edits the footer with a non-string id.
    const malformed = `
export const x = defineFlow({ nodes: {}, edges: [] });
/* @flowlib-definition
{"nodes":[],"edges":[],"metadata":{"flowId":42,"name":"Bad"}}
*/
`;
    expect(extractFlowIdFromContent(malformed)).toBeNull();
  });
});

// ── 3. importFlowContent refuses on flowId mismatch ────────────────────────

describe('importFlowContent corruption guard', () => {
  let service: VcSyncService;
  let db: PluginDatabaseApi;

  beforeEach(() => {
    vi.clearAllMocks();
    const provider = makeProvider();
    service = new VcSyncService(provider, { ...options, provider }, mockLogger);
  });

  it('throws when embedded flowId does not match the caller-provided flowId', async () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'mismatchFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_FROM_FILE', name: 'Mismatch' },
    });

    db = {
      type: 'sqlite',
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as PluginDatabaseApi;

    // Use a private-method bypass: call through `pullFlow` indirectly is too
    // heavy for this assertion. Instead, exercise importFlowContent via the
    // public service through a minimal config + provider stub.
    // For directness, we go through the parsed-then-import path manually.
    // The import method is private, so we hit it through pullFlow with a
    // real config row whose flowId differs from the embedded one.
    const provider = makeProvider();
    (provider.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: code,
      sha: 'sha-remote',
    });
    service = new VcSyncService(provider, { ...options, provider }, mockLogger);

    (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM flowlib_vc_sync_config')) {
        return [
          {
            id: 'cfg-1',
            flow_id: 'flow_LOCAL_TARGET',
            provider: 'mock',
            repo: 'acme/flows',
            branch: 'main',
            file_path: 'flows/mismatch.flow.ts',
            mode: 'direct-commit',
            sync_direction: 'read',
            last_synced_at: null,
            last_commit_sha: null,
            last_synced_version: null,
            draft_branch: null,
            active_pr_number: null,
            active_pr_url: null,
            enabled: 1,
            created_at: '',
            updated_at: '',
          },
        ];
      }
      return [];
    });

    await expect(service.pullFlow(db, 'flow_LOCAL_TARGET')).rejects.toThrow(
      /Embedded flowId mismatch/,
    );
  });

  it('imports normally when embedded flowId matches', async () => {
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'matchFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_MATCHED', name: 'Match' },
    });

    const provider = makeProvider();
    (provider.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: code,
      sha: 'sha-match',
    });
    service = new VcSyncService(provider, { ...options, provider }, mockLogger);

    const executeSpy = vi.fn().mockResolvedValue(undefined);
    db = {
      type: 'sqlite',
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM flowlib_vc_sync_config')) {
          return [
            {
              id: 'cfg-1',
              flow_id: 'flow_MATCHED',
              provider: 'mock',
              repo: 'acme/flows',
              branch: 'main',
              file_path: 'flows/match.flow.ts',
              mode: 'direct-commit',
              sync_direction: 'read',
              last_synced_at: null,
              last_commit_sha: null,
              last_synced_version: null,
              draft_branch: null,
              active_pr_number: null,
              active_pr_url: null,
              enabled: 1,
              created_at: '',
              updated_at: '',
            },
          ];
        }
        if (sql.includes('SELECT MAX(version)')) {
          return [{ version: 0 }];
        }
        return [];
      }),
      execute: executeSpy,
    } as unknown as PluginDatabaseApi;

    const result = await service.pullFlow(db, 'flow_MATCHED');
    expect(result.success).toBe(true);
    // The new flow_versions row was inserted.
    expect(
      executeSpy.mock.calls.some((c) => c[0].includes('INSERT INTO flowlib_flow_versions')),
    ).toBe(true);
  });

  it('imports legacy files (no embedded flowId) without complaining', async () => {
    // No flowId in metadata — the guard should be silent on legacy footers.
    const { code } = emitSdkSource(minimalDefinition, {
      flowName: 'legacyFlow',
      includeJsonFooter: true,
      metadata: { name: 'Legacy' },
    });

    const provider = makeProvider();
    (provider.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: code,
      sha: 'sha-legacy',
    });
    service = new VcSyncService(provider, { ...options, provider }, mockLogger);

    db = {
      type: 'sqlite',
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM flowlib_vc_sync_config')) {
          return [
            {
              id: 'cfg-1',
              flow_id: 'flow_legacy_target',
              provider: 'mock',
              repo: 'acme/flows',
              branch: 'main',
              file_path: 'flows/legacy.flow.ts',
              mode: 'direct-commit',
              sync_direction: 'read',
              last_synced_at: null,
              last_commit_sha: null,
              last_synced_version: null,
              draft_branch: null,
              active_pr_number: null,
              active_pr_url: null,
              enabled: 1,
              created_at: '',
              updated_at: '',
            },
          ];
        }
        if (sql.includes('SELECT MAX(version)')) {
          return [{ version: 0 }];
        }
        return [];
      }),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as PluginDatabaseApi;

    const result = await service.pullFlow(db, 'flow_legacy_target');
    expect(result.success).toBe(true);
  });
});

// ── 4. findFlowConfigByEmbeddedId resolves the local row ───────────────────

describe('findFlowConfigByEmbeddedId', () => {
  let service: VcSyncService;

  beforeEach(() => {
    const provider = makeProvider();
    service = new VcSyncService(provider, { ...options, provider }, mockLogger);
  });

  it('returns the config row when a flowId matches', async () => {
    const db = {
      type: 'sqlite' as const,
      query: vi.fn().mockResolvedValue([
        {
          id: 'cfg-99',
          flow_id: 'flow_xyz',
          provider: 'mock',
          repo: 'acme/flows',
          branch: 'main',
          file_path: 'flows/some.flow.ts',
          mode: 'direct-commit',
          sync_direction: 'write',
          last_synced_at: null,
          last_commit_sha: null,
          last_synced_version: null,
          draft_branch: null,
          active_pr_number: null,
          active_pr_url: null,
          enabled: 1,
          created_at: '',
          updated_at: '',
        },
      ]),
      execute: vi.fn(),
    } as unknown as PluginDatabaseApi;

    const config = await service.findFlowConfigByEmbeddedId(db, 'flow_xyz');
    expect(config).not.toBeNull();
    expect(config?.flowId).toBe('flow_xyz');
    expect(config?.filePath).toBe('flows/some.flow.ts');
  });

  it('returns null when no row matches that flowId', async () => {
    const db = {
      type: 'sqlite' as const,
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
    } as unknown as PluginDatabaseApi;

    const config = await service.findFlowConfigByEmbeddedId(db, 'flow_does_not_exist');
    expect(config).toBeNull();
  });
});

// ── 5. The rename scenario, end to end (the bug 0a actually fixes) ─────────

describe('rename preserves identity through file content', () => {
  it('a renamed flow keeps the same flowId in its emitted footer', () => {
    // Initial emit, file path "flows/triage.flow.ts" implied by name.
    const original = emitSdkSource(minimalDefinition, {
      flowName: 'triageFlow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_stable_id', name: 'Triage' },
    });

    // Renamed emit, same flowId, new name.
    const renamed = emitSdkSource(minimalDefinition, {
      flowName: 'triageV2Flow',
      includeJsonFooter: true,
      metadata: { flowId: 'flow_stable_id', name: 'Triage v2' },
    });

    expect(extractFlowIdFromContent(original.code)).toBe('flow_stable_id');
    expect(extractFlowIdFromContent(renamed.code)).toBe('flow_stable_id');
    // Body changed (name), id did not.
    expect(original.code).toContain('triageFlow');
    expect(renamed.code).toContain('triageV2Flow');
  });
});
