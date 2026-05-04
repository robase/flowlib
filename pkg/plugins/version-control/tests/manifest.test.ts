/**
 * Phase 4 — Manifest contract.
 *
 * Three contracts:
 *   1. `extractRequiredEnvs` parses `{{env.NAME}}` placeholders out of the
 *      human-readable section only — never out of the JSON footer (which
 *      keeps raw credential ids that must NOT be treated as env names).
 *   2. `decorateWithRequires` writes the `@flowlib-requires` header
 *      idempotently — calling twice replaces, doesn't stack.
 *   3. `buildAggregateManifest` produces deterministic output and
 *      `checkManifestAgainstInstance` resolves env names against the
 *      target's credentials with normalized name matching.
 *
 * Plus an integration test verifying the manifest rides in a Trees commit
 * alongside flow files (Phase 0c batch push wired with Phase 4 manifest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAggregateManifest,
  buildFlowManifestEntry,
  checkManifestAgainstInstance,
  decorateWithRequires,
  extractRequiredEnvs,
  manifestFilePath,
  serializeManifest,
  type AggregateManifest,
} from '../src/backend/manifest';
import { VcSyncService } from '../src/backend/sync-service';
import type { GitProvider } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VersionControlPluginOptions } from '../src/backend/types';
import { patchMockDb } from './test-helpers/mock-db';

// ── 1. extractRequiredEnvs ───────────────────────────────────────────────

describe('extractRequiredEnvs', () => {
  it('returns sorted unique env names referenced in the human-readable section', () => {
    const src = `
import { defineFlow, model } from "@flowlib/sdk";
export const f = defineFlow({
  nodes: {
    a: model({ credentialId: "{{env.GMAIL_CREDENTIAL}}" }),
    b: model({ credentialId: "{{env.OPENAI_CREDENTIAL}}" }),
    c: model({ credentialId: "{{env.GMAIL_CREDENTIAL}}" }), // duplicate
  },
  edges: [],
});
`;
    expect(extractRequiredEnvs(src)).toEqual(['GMAIL_CREDENTIAL', 'OPENAI_CREDENTIAL']);
  });

  it('ignores placeholders that appear in the JSON footer', () => {
    // The footer carries raw credential ids — any `{{env.X}}` text inside
    // it would be a false positive. Prove the parser isolates the human
    // section.
    const src = `
const f = defineFlow({ nodes: { a: model({ credentialId: "{{env.REAL_CREDENTIAL}}" }) }, edges: [] });
/* @flowlib-definition
{"nodes":[{"params":{"credentialId":"{{env.IGNORE_ME_CREDENTIAL}}"}}],"edges":[]}
*/
`;
    expect(extractRequiredEnvs(src)).toEqual(['REAL_CREDENTIAL']);
  });

  it('returns empty array when no env placeholders are present', () => {
    expect(extractRequiredEnvs('export const f = "hello world";')).toEqual([]);
  });

  it('skips lowercase / mixed-case placeholders (env names are upper-snake)', () => {
    const src = `nodes: { a: model({ credentialId: "{{env.gmail_credential}}" }) }`;
    expect(extractRequiredEnvs(src)).toEqual([]);
  });
});

// ── 2. decorateWithRequires ──────────────────────────────────────────────

describe('decorateWithRequires', () => {
  it('prepends a header listing the required envs', () => {
    const src = 'export const f = 1;';
    const decorated = decorateWithRequires(src, ['GMAIL_CREDENTIAL', 'OPENAI_CREDENTIAL']);
    expect(decorated).toMatch(/^\/\* @flowlib-requires/);
    expect(decorated).toContain('GMAIL_CREDENTIAL, OPENAI_CREDENTIAL');
    expect(decorated).toContain('export const f = 1;');
  });

  it('writes a "(none)" header when there are no requires (still meaningful signal)', () => {
    const src = 'export const f = 1;';
    const decorated = decorateWithRequires(src, []);
    expect(decorated).toMatch(/credentials: \(none\)/);
  });

  it('is idempotent — calling twice replaces, does not stack', () => {
    const src = 'export const f = 1;';
    const once = decorateWithRequires(src, ['A']);
    const twice = decorateWithRequires(once, ['B']);
    // Only ONE @flowlib-requires header in the output.
    const matches = twice.match(/@flowlib-requires/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(twice).toContain('credentials: B');
    expect(twice).not.toContain('credentials: A');
  });

  it('preserves the original source body unchanged', () => {
    const body = `\nimport { defineFlow } from "@flowlib/sdk";\n\nexport const f = defineFlow({ nodes: {}, edges: [] });\n`;
    const decorated = decorateWithRequires(body, ['X_CREDENTIAL']);
    expect(decorated.endsWith(body)).toBe(true);
  });
});

// ── 3. buildAggregateManifest — deterministic output ─────────────────────

describe('buildAggregateManifest', () => {
  it('emits flows keyed by flowId, alphabetically sorted', () => {
    const m = buildAggregateManifest(
      [
        {
          flowId: 'flow_zebra',
          name: 'Zebra',
          filePath: 'flows/zebra.flow.ts',
          requires: { credentials: ['Z'] },
        },
        {
          flowId: 'flow_alpha',
          name: 'Alpha',
          filePath: 'flows/alpha.flow.ts',
          requires: { credentials: ['A'] },
        },
      ],
      { now: () => new Date('2026-05-03T00:00:00Z') },
    );

    expect(Object.keys(m.flows)).toEqual(['flow_alpha', 'flow_zebra']);
    expect(m.version).toBe(1);
    expect(m.generatedAt).toBe('2026-05-03T00:00:00.000Z');
  });

  it("sorts each flow's requires.credentials alphabetically (clean diffs)", () => {
    const m = buildAggregateManifest(
      [
        {
          flowId: 'flow_x',
          name: 'X',
          filePath: 'flows/x.flow.ts',
          requires: { credentials: ['Z', 'A', 'M'] },
        },
      ],
      { now: () => new Date('2026-05-03T00:00:00Z') },
    );
    expect(m.flows.flow_x.requires.credentials).toEqual(['A', 'M', 'Z']);
  });

  it('produces byte-identical output across two calls with the same input + now', () => {
    const fixed = () => new Date('2026-05-03T00:00:00Z');
    const entry = {
      flowId: 'flow_x',
      name: 'X',
      filePath: 'flows/x.flow.ts',
      requires: { credentials: ['A'] },
    };
    const a = serializeManifest(buildAggregateManifest([entry], { now: fixed }));
    const b = serializeManifest(buildAggregateManifest([entry], { now: fixed }));
    expect(a).toBe(b);
  });

  it('serialized output ends with a newline (POSIX-friendly)', () => {
    const m = buildAggregateManifest([], { now: () => new Date() });
    expect(serializeManifest(m).endsWith('\n')).toBe(true);
  });
});

// ── 4. manifestFilePath ──────────────────────────────────────────────────

describe('manifestFilePath', () => {
  it('appends _manifest.json to the configured base path', () => {
    expect(manifestFilePath('flows/')).toBe('flows/_manifest.json');
    expect(manifestFilePath('workflows')).toBe('workflows/_manifest.json');
    expect(manifestFilePath('a/b/c/')).toBe('a/b/c/_manifest.json');
  });
});

// ── 5. buildFlowManifestEntry — content extraction ───────────────────────

describe('buildFlowManifestEntry', () => {
  it('extracts requires from substituted source and packages with metadata', () => {
    const content = `nodes: { x: model({ credentialId: "{{env.GMAIL_CREDENTIAL}}" }) }`;
    const entry = buildFlowManifestEntry({
      content,
      flowId: 'flow_abc',
      name: 'My Flow',
      filePath: 'flows/my.flow.ts',
    });
    expect(entry).toEqual({
      flowId: 'flow_abc',
      name: 'My Flow',
      filePath: 'flows/my.flow.ts',
      requires: { credentials: ['GMAIL_CREDENTIAL'] },
    });
  });
});

// ── 6. checkManifestAgainstInstance ──────────────────────────────────────

describe('checkManifestAgainstInstance', () => {
  function makeDb(credentialNames: string[]): PluginDatabaseApi {
    return patchMockDb({
      type: 'sqlite' as const,
      query: vi.fn(async (sql: string) => {
        if (sql.toLowerCase().replace(/"/g, '').includes('flowlib_credentials')) {
          return credentialNames.map((name) => ({ name }));
        }
        return [];
      }),
      execute: vi.fn(),
    }) as unknown as PluginDatabaseApi;
  }

  function manifest(flows: Array<{ flowId: string; creds: string[] }>): AggregateManifest {
    return buildAggregateManifest(
      flows.map((f) => ({
        flowId: f.flowId,
        name: f.flowId,
        filePath: `flows/${f.flowId}.flow.ts`,
        requires: { credentials: f.creds },
      })),
      { now: () => new Date('2026-01-01') },
    );
  }

  it('reports ok=true when every required env has a matching credential', async () => {
    const db = makeDb(['GMAIL_CREDENTIAL', 'OPENAI_CREDENTIAL']);
    const m = manifest([{ flowId: 'flow_a', creds: ['GMAIL_CREDENTIAL'] }]);
    const result = await checkManifestAgainstInstance(db, m);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].satisfied).toBe(true);
  });

  it('reports ok=false with missing list when target lacks a credential', async () => {
    const db = makeDb(['GMAIL_CREDENTIAL']); // OpenAI missing
    const m = manifest([{ flowId: 'flow_a', creds: ['GMAIL_CREDENTIAL', 'OPENAI_CREDENTIAL'] }]);
    const result = await checkManifestAgainstInstance(db, m);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].envName).toBe('OPENAI_CREDENTIAL');
    expect(result.missing[0].referencedBy).toEqual(['flow_a']);
  });

  it('matches credential names case-insensitively + ignoring punctuation', async () => {
    // Manifest declares GMAIL_CREDENTIAL; instance has it stored as
    // "Gmail Credential" — these must match.
    const db = makeDb(['Gmail Credential']);
    const m = manifest([{ flowId: 'flow_a', creds: ['GMAIL_CREDENTIAL'] }]);
    const result = await checkManifestAgainstInstance(db, m);
    expect(result.ok).toBe(true);
  });

  it('groups referencedBy when multiple flows need the same env', async () => {
    const db = makeDb([]); // nothing matches
    const m = manifest([
      { flowId: 'flow_a', creds: ['GMAIL_CREDENTIAL'] },
      { flowId: 'flow_b', creds: ['GMAIL_CREDENTIAL'] },
      { flowId: 'flow_c', creds: ['OPENAI_CREDENTIAL'] },
    ]);
    const result = await checkManifestAgainstInstance(db, m);
    const gmail = result.credentials.find((c) => c.envName === 'GMAIL_CREDENTIAL');
    expect(gmail?.referencedBy).toEqual(['flow_a', 'flow_b']);
  });

  it('returns ok=true and empty arrays for an empty manifest', async () => {
    const db = makeDb([]);
    const m = manifest([]);
    const result = await checkManifestAgainstInstance(db, m);
    expect(result.ok).toBe(true);
    expect(result.credentials).toEqual([]);
  });
});

// ── 7. Integration: manifest rides in pushFlowsAtomic Trees commit ───────

describe('integration: pushFlowsAtomic includes _manifest.json in the commit', () => {
  function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
    return {
      id: 'mock',
      name: 'Mock',
      getFileContent: vi.fn().mockResolvedValue(null),
      createOrUpdateFile: vi.fn(),
      deleteFile: vi.fn(),
      createBranch: vi.fn(),
      deleteBranch: vi.fn(),
      getBranch: vi.fn().mockResolvedValue({ sha: 'parent' }),
      listTree: vi.fn().mockResolvedValue([]),
      compareBranches: vi.fn(),
      createTreeCommit: vi.fn(),
      createPullRequest: vi.fn(),
      updatePullRequest: vi.fn(),
      getPullRequest: vi.fn(),
      closePullRequest: vi.fn(),
      verifyWebhookSignature: vi.fn().mockReturnValue(true),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the Trees commit includes a `_manifest.json` entry alongside flow files', async () => {
    let capturedFiles: Array<{ path: string; content: string }> = [];
    const provider = makeProvider({
      getBranch: vi.fn().mockResolvedValue({ sha: 'parent-sha' }),
      createTreeCommit: vi.fn().mockImplementation(async (_repo, opts) => {
        capturedFiles = opts.files;
        return {
          commitSha: 'new-commit',
          files: opts.files.map((f: { path: string }) => ({
            path: f.path,
            blobSha: 'b',
          })),
        };
      }),
    });

    const options: VersionControlPluginOptions = {
      provider,
      repo: 'acme/flows',
      defaultBranch: 'main',
      path: 'flows/',
      mode: 'direct-commit',
    };
    const service = new VcSyncService(provider, options, {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    // Stub DB: one flow, one config, one version with a credential ref.
    const db = patchMockDb({
      type: 'sqlite' as const,
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const norm = sql.toLowerCase().replace(/"/g, '');
        if (norm.includes('flowlib_flow_versions') && norm.includes('order by')) {
          return [
            {
              flow_id: 'flow_one',
              version: 1,
              flowlib_definition: JSON.stringify({
                nodes: [
                  {
                    id: 'n1',
                    type: 'core.model',
                    referenceId: 'm',
                    position: { x: 0, y: 0 },
                    params: {
                      // `cred_openai_1` derives to OPENAI_CREDENTIAL via the
                      // existing prefix/trailing-digit substitution rules.
                      credentialId: 'cred_openai_1',
                      model: 'gpt-4o',
                      prompt: 'hi',
                    },
                  },
                ],
                edges: [],
              }),
            },
          ];
        }
        if (norm.includes('flowlib_vc_sync_config') && norm.includes('flow_id = ?')) {
          return [
            {
              id: 'cfg-1',
              flow_id: 'flow_one',
              provider: 'mock',
              repo: 'acme/flows',
              branch: 'main',
              file_path: 'flows/one.flow.ts',
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
          ];
        }
        if (norm.includes('flowlib_flows')) {
          if (norm.includes('id in')) {
            return [{ id: 'flow_one', name: 'One' }];
          }
          if (norm.includes('id = ?')) {
            return [
              {
                id: 'flow_one',
                name: 'One',
                description: null,
                tags: null,
              },
            ];
          }
        }
        return [];
      }),
      execute: vi.fn(),
    }) as unknown as PluginDatabaseApi;

    const result = await service.pushFlowsAtomic(db, ['flow_one'], {
      commitMessage: 'm',
    });

    expect(result.success).toBe(true);
    const manifestFile = capturedFiles.find((f) => f.path === 'flows/_manifest.json');
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as AggregateManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.flows.flow_one).toBeDefined();
    expect(manifest.flows.flow_one.name).toBe('One');
    // The credentialId got substituted to {{env.OPENAI_CREDENTIAL}} and
    // extracted into requires. Only the human-section reference counts.
    expect(manifest.flows.flow_one.requires.credentials).toContain('OPENAI_CREDENTIAL');
    // The decorated source was committed too — header should be present.
    const flowFile = capturedFiles.find((f) => f.path === 'flows/one.flow.ts');
    expect(flowFile?.content).toMatch(/^\/\* @flowlib-requires/);
  });
});
