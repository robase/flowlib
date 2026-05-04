/**
 * Phase 3 — Cross-environment promotion.
 *
 * Three contracts:
 *   1. `EnvironmentResolver` maps env names to {branch, repo} via plugin
 *      options, with sensible fallbacks. Refuses unknown envs (typos
 *      can't silently target an arbitrary branch).
 *   2. `PromotionService.promote` opens a PR `source → target`, refuses
 *      empty diffs cleanly, and refuses cross-repo promotion (v1 OOS).
 *   3. Per-flow history rows are recorded for the audit trail when the
 *      changed file paths map to known flow configs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvironmentResolver, PromotionService } from '../src/backend/promotion';
import type { GitProvider, BranchComparison } from '../src/backend/git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import { patchMockDb } from './test-helpers/mock-db';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
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
    createPullRequest: vi.fn().mockResolvedValue({ number: 0, url: '' }),
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

/**
 * In-memory DB stub. Backs vc_sync_config lookups (path → flow_id) and
 * captures vc_sync_history inserts so we can assert audit rows landed.
 */
function makeDb(configRows: Array<{ flow_id: string; file_path: string }> = []) {
  const history: Array<{ flow_id: string; action: string; pr_number: number | null }> = [];
  const db = patchMockDb({
    type: 'sqlite' as const,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/"/g, '');
      if (norm.includes('flowlib_vc_sync_config') && norm.includes('file_path in')) {
        const paths = params as string[];
        return configRows.filter((r) => paths.includes(r.file_path));
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.toLowerCase().replace(/"/g, '').startsWith('insert into flowlib_vc_sync_history')) {
        const [, flow_id, action, , pr_number] = params as [
          string,
          string,
          string,
          string | null,
          number | null,
        ];
        history.push({ flow_id, action, pr_number });
      }
    }),
  }) as unknown as PluginDatabaseApi;
  return { db, history };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. EnvironmentResolver ───────────────────────────────────────────────

describe('EnvironmentResolver', () => {
  it('uses fallbacks (env name = branch, default repo) when no overrides', () => {
    const r = new EnvironmentResolver('acme/flows', ['dev', 'staging', 'prod'], undefined);
    expect(r.resolve('dev')).toEqual({
      name: 'dev',
      branch: 'dev',
      repo: 'acme/flows',
    });
  });

  it('honors per-env branch override', () => {
    const r = new EnvironmentResolver('acme/flows', ['dev', 'staging', 'prod'], {
      dev: { branch: 'main' },
    });
    expect(r.resolve('dev')?.branch).toBe('main');
  });

  it('honors per-env repo override (cross-repo declaration)', () => {
    const r = new EnvironmentResolver('acme/flows', ['dev', 'prod'], {
      prod: { branch: 'release', repo: 'acme/flows-prod' },
    });
    const prod = r.resolve('prod');
    expect(prod?.repo).toBe('acme/flows-prod');
    expect(prod?.branch).toBe('release');
  });

  it('returns null for envs not in promotionChain (typo guard)', () => {
    const r = new EnvironmentResolver('acme/flows', ['dev', 'staging', 'prod'], undefined);
    expect(r.resolve('stage')).toBeNull(); // typo, not in chain
    expect(r.resolve('production')).toBeNull();
  });

  it('returns null for everything when no chain is configured', () => {
    const r = new EnvironmentResolver('acme/flows', undefined, undefined);
    expect(r.resolve('dev')).toBeNull();
    expect(r.isConfigured()).toBe(false);
  });

  it("isConfigured requires at least two envs (single env can't promote)", () => {
    expect(new EnvironmentResolver('acme/flows', ['dev'], undefined).isConfigured()).toBe(false);
    expect(new EnvironmentResolver('acme/flows', ['dev', 'prod'], undefined).isConfigured()).toBe(
      true,
    );
  });
});

// ── 2. PromotionService.promote — happy path ─────────────────────────────

describe('PromotionService.promote', () => {
  function makeService(
    chain: string[] = ['dev', 'staging', 'prod'],
    overrides?: Record<string, { branch: string; repo?: string }>,
    provider?: GitProvider,
  ) {
    const resolver = new EnvironmentResolver('acme/flows', chain, overrides);
    return new PromotionService(provider ?? makeProvider(), resolver, silentLogger);
  }

  it('opens a PR with sane title + body when there are commits to promote', async () => {
    const compare: BranchComparison = {
      aheadBy: 3,
      behindBy: 0,
      files: [
        { path: 'flows/triage.flow.ts', status: 'modified' },
        { path: 'flows/notify.flow.ts', status: 'added' },
      ],
    };
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue(compare),
      createPullRequest: vi.fn().mockResolvedValue({
        number: 42,
        url: 'https://github.com/acme/flows/pull/42',
      }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb([
      { flow_id: 'flow_triage', file_path: 'flows/triage.flow.ts' },
      { flow_id: 'flow_notify', file_path: 'flows/notify.flow.ts' },
    ]);

    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });

    expect(result.status).toBe('pr-opened');
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toContain('/pull/42');
    expect(result.aheadBy).toBe(3);

    const prCall = (provider.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prCall[0]).toBe('acme/flows');
    expect(prCall[1].head).toBe('dev');
    expect(prCall[1].base).toBe('staging');
    expect(prCall[1].title).toContain('dev → staging');
    // Body lists each file with a status icon.
    expect(prCall[1].body).toContain('flows/triage.flow.ts');
    expect(prCall[1].body).toContain('flows/notify.flow.ts');
    expect(prCall[1].body).toContain('➕'); // added marker
  });

  it('returns nothing-to-promote when the source has no commits ahead', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();

    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });

    expect(result.status).toBe('nothing-to-promote');
    expect(result.aheadBy).toBe(0);
    expect(result.files).toEqual([]);
    // No PR opened.
    expect(provider.createPullRequest).not.toHaveBeenCalled();
  });

  it('records per-flow pr-created history rows for audit', async () => {
    const compare: BranchComparison = {
      aheadBy: 1,
      behindBy: 0,
      files: [
        { path: 'flows/triage.flow.ts', status: 'modified' },
        { path: 'flows/legacy.flow.ts', status: 'modified' }, // no matching config
      ],
    };
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue(compare),
      createPullRequest: vi.fn().mockResolvedValue({ number: 7, url: 'https://test/pr/7' }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db, history } = makeDb([{ flow_id: 'flow_triage', file_path: 'flows/triage.flow.ts' }]);

    await svc.promote(db, { sourceEnv: 'dev', targetEnv: 'staging' });

    // Only the file matching a tracked flow gets a history row.
    expect(history).toHaveLength(1);
    expect(history[0].flow_id).toBe('flow_triage');
    expect(history[0].action).toBe('pr-created');
    expect(history[0].pr_number).toBe(7);
  });

  it('uses titleOverride / bodyOverride when provided', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({
        aheadBy: 1,
        behindBy: 0,
        files: [{ path: 'flows/x.flow.ts', status: 'modified' }],
      }),
      createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: '' }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();

    await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
      titleOverride: 'Custom title',
      bodyOverride: 'Custom body',
    });

    const prCall = (provider.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prCall[1].title).toBe('Custom title');
    expect(prCall[1].body).toBe('Custom body');
  });

  it('warns about behind commits in the PR body', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({
        aheadBy: 1,
        behindBy: 5,
        files: [{ path: 'flows/x.flow.ts', status: 'modified' }],
      }),
      createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: '' }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();

    await svc.promote(db, { sourceEnv: 'dev', targetEnv: 'staging' });
    const prCall = (provider.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prCall[1].body).toMatch(/BEHIND/);
    expect(prCall[1].body).toContain('5');
  });

  it('uses defaultSourceEnv when caller omits sourceEnv', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({ aheadBy: 0, behindBy: 0, files: [] }),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();

    const result = await svc.promote(db, {
      targetEnv: 'staging',
      defaultSourceEnv: 'dev',
    });

    expect(result.sourceEnv).toBe('dev');
    expect(result.targetEnv).toBe('staging');
  });
});

// ── 3. PromotionService.promote — refusal paths ──────────────────────────

describe('PromotionService.promote — refusal paths', () => {
  function makeService(
    chain: string[] | undefined = ['dev', 'staging', 'prod'],
    overrides?: Record<string, { branch: string; repo?: string }>,
    provider?: GitProvider,
  ) {
    const resolver = new EnvironmentResolver('acme/flows', chain, overrides);
    return new PromotionService(provider ?? makeProvider(), resolver, silentLogger);
  }

  it('refuses when promotionChain has < 2 envs', async () => {
    const svc = makeService(['dev']);
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });
    expect(result.status).toBe('invalid-env');
    expect(result.message).toMatch(/promotionChain/);
  });

  it('refuses when targetEnv is not in chain', async () => {
    const svc = makeService(['dev', 'prod']);
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging', // not in chain
    });
    expect(result.status).toBe('invalid-env');
    expect(result.message).toContain("'staging'");
  });

  it('refuses self-promote (sourceEnv === targetEnv)', async () => {
    const svc = makeService();
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'dev',
    });
    expect(result.status).toBe('invalid-env');
    expect(result.message).toMatch(/must differ/);
  });

  it('refuses cross-repo promotion (v1 OOS)', async () => {
    const svc = makeService(['dev', 'prod'], {
      dev: { branch: 'main' },
      prod: { branch: 'release', repo: 'acme/flows-prod' },
    });
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'prod',
    });
    expect(result.status).toBe('cross-repo-not-supported');
    expect(result.message).toContain('flows-prod');
  });

  it('refuses when sourceEnv is missing and no defaultSourceEnv', async () => {
    const svc = makeService();
    const { db } = makeDb();
    const result = await svc.promote(db, { targetEnv: 'staging' });
    expect(result.status).toBe('invalid-env');
    expect(result.message).toMatch(/sourceEnv is required/);
  });

  it('returns error result when compareBranches throws', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockRejectedValue(new Error('GitHub timeout')),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('GitHub timeout');
  });

  it('returns error result when createPullRequest throws', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({
        aheadBy: 1,
        behindBy: 0,
        files: [{ path: 'flows/x.flow.ts', status: 'modified' }],
      }),
      createPullRequest: vi.fn().mockRejectedValue(new Error('PR already exists')),
    });
    const svc = makeService(undefined, undefined, provider);
    const { db } = makeDb();
    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('PR already exists');
  });
});

// ── 4. Branch resolution through plugin options ──────────────────────────

describe('PromotionService — branch resolution', () => {
  it('resolves branch overrides correctly when opening the PR', async () => {
    const provider = makeProvider({
      compareBranches: vi.fn().mockResolvedValue({
        aheadBy: 1,
        behindBy: 0,
        files: [{ path: 'flows/x.flow.ts', status: 'modified' }],
      }),
      createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: '' }),
    });
    const resolver = new EnvironmentResolver('acme/flows', ['dev', 'staging', 'prod'], {
      dev: { branch: 'main' },
      staging: { branch: 'release-candidate' },
    });
    const svc = new PromotionService(provider, resolver, silentLogger);
    const { db } = makeDb();

    const result = await svc.promote(db, {
      sourceEnv: 'dev',
      targetEnv: 'staging',
    });
    expect(result.status).toBe('pr-opened');

    const compareCall = (provider.compareBranches as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(compareCall[1]).toBe('release-candidate'); // base = target
    expect(compareCall[2]).toBe('main'); // head = source

    const prCall = (provider.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prCall[1].head).toBe('main');
    expect(prCall[1].base).toBe('release-candidate');
  });
});
