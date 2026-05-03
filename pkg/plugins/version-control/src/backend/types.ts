// =============================================================================
// Version Control Plugin — Backend Types
// =============================================================================

import type { GitProvider } from './git-provider';
import type { VcSyncMode, VcSyncDirection } from '../shared/types';

/**
 * The role this Flowlib instance plays in the dev → staging → prod chain.
 *
 * Drives every default the user would otherwise have to set per flow:
 *   - `dev`: writes freely, pushes to git, pulls when reconciler ticks.
 *   - `staging`: read-write — promoted PRs land here for QA before prod.
 *   - `prod`: read-only by default. Pull writes succeed (that's how prod
 *     gets updated); human writes via the API return 403 unless ops opens
 *     a time-boxed break-glass window.
 *
 * Default: `'dev'`. Existing setups without the option preserve current
 * behavior (no read-only enforcement, no env badge).
 */
export type VcEnvironment = 'dev' | 'staging' | 'prod';

/** Options for the versionControl() plugin factory */
export interface VersionControlPluginOptions {
  /** Git hosting provider (e.g. githubProvider({ auth: ... })) */
  provider: GitProvider;

  /** Default repository (owner/name) */
  repo: string;

  /** Default target branch */
  defaultBranch?: string;

  /** Directory in the repo for flow files (trailing slash) */
  path?: string;

  /** Default sync mode */
  mode?: VcSyncMode;

  /** Default sync direction */
  syncDirection?: VcSyncDirection;

  /**
   * The role this instance plays. Drives sync direction defaults and the
   * read-only gate on prod. Defaults to `'dev'` — existing instances that
   * don't set it keep the pre-Phase-1 behavior (no read-only).
   */
  environment?: VcEnvironment;

  /**
   * Phase 3 — Promotion chain. Ordered list of environment names from
   * leftmost (dev) to rightmost (prod). Used by `POST /vc/promote` to
   * resolve `currentEnv → targetEnv` branch pairs.
   *
   * If omitted, only the configured `environment` is recognized — the
   * promote endpoint refuses with "no chain configured".
   *
   * Example: `['dev', 'staging', 'prod']` lets the dev instance promote
   * to staging, staging to prod, but not dev to prod (skipping is
   * intentional — each env reviews its own PR).
   */
  promotionChain?: string[];

  /**
   * Phase 3 — Per-environment branch / repo overrides. When the env name
   * doesn't match the branch name (e.g. `'dev'` lives on `'main'`), or
   * when envs span multiple repos, declare the mapping here.
   *
   * Falls back to: branch = env name; repo = top-level `repo` option.
   *
   * @example
   * ```ts
   * environments: {
   *   dev:     { branch: 'main' },
   *   staging: { branch: 'staging' },
   *   prod:    { branch: 'release', repo: 'org/flows-prod' },
   * }
   * ```
   */
  environments?: Record<string, { branch: string; repo?: string }>;

  /** Webhook secret for verifying incoming webhooks */
  webhookSecret?: string;

  /**
   * How often the polling reconciler ticks, in ms. The reconciler is the
   * primary correctness path — even if every webhook is dropped, the
   * instance converges to the branch head within this interval.
   *
   * Default: 30_000 (30 seconds). Set to 0 to disable auto-ticking
   * entirely (callers must invoke `triggerOutOfCycle` manually).
   */
  reconcilerIntervalMs?: number;

  /**
   * Frontend plugin for the version control UI.
   * Omit for backend-only setups.
   */
  frontend?: unknown;
}
