// =============================================================================
// Phase 3 — Cross-environment promotion
//
// Promotion is "open a PR from one environment's branch to the next". The
// plugin doesn't push commits during promotion — those landed earlier when
// the user pushed to dev. Promotion is purely about review + merge:
//
//   dev branch         (pushFlowsAtomic landed commits here)
//      ↓
//   POST /vc/promote   ← this module opens a PR dev → staging
//      ↓
//   reviewer merges    (humans do this in GitHub UI)
//      ↓
//   webhook fires      (Phase 0b — triggers reconciler tick on staging)
//      ↓
//   staging pulls      (reconciler imports the merged content)
//
// Concerns this module owns:
//   - Resolving env names → { branch, repo } via plugin options.
//   - Computing the diff so we can refuse empty PRs cleanly (rather than
//     letting GitHub's 422 surface as a generic error).
//   - Auto-generating PR title + body with the file list.
//   - Recording per-flow `pr-created` history rows for the audit trail.
//
// Concerns explicitly NOT here:
//   - Cross-repo promotion (declared OOS for v1 in PLAN.md §10).
//   - Manifest gate (Phase 4) — the body's "manifest delta" section is
//     stubbed out; Phase 4 fills it in with `flowlib check` results.
// =============================================================================

import type { PluginDatabaseApi } from '@flowlib/core';
import type { BranchComparison, BranchComparisonFile, GitProvider } from './git-provider';
import type { AggregateManifest } from './manifest';
import { manifestFilePath } from './manifest';

/** Inputs / outputs surfaced through the endpoint. */
export interface PromoteOptions {
  /** Defaults to the instance's configured environment. */
  sourceEnv?: string;
  targetEnv: string;
  identity?: string;
  /** Optional override of the auto-generated title. */
  titleOverride?: string;
  /** Optional override of the auto-generated body. */
  bodyOverride?: string;
}

export type PromoteStatus =
  | 'pr-opened'
  | 'nothing-to-promote'
  | 'invalid-env'
  | 'cross-repo-not-supported'
  | 'branch-not-found'
  | 'error';

export interface PromoteResult {
  status: PromoteStatus;
  /** Human-readable explanation when status !== 'pr-opened'. */
  message?: string;
  /** Source / target labels echoed back so the caller can render confirmation UI. */
  sourceEnv?: string;
  targetEnv?: string;
  sourceBranch?: string;
  targetBranch?: string;
  /** Populated when status === 'pr-opened'. */
  prNumber?: number;
  prUrl?: string;
  /** Files that differ between source and target. Populated for both
   *  `pr-opened` and `nothing-to-promote` (empty in the latter). */
  files?: BranchComparisonFile[];
  /** Counts surfaced for telemetry / UI summary. */
  aheadBy?: number;
  behindBy?: number;
}

export interface ResolvedEnv {
  name: string;
  branch: string;
  repo: string;
}

/**
 * Resolve env name → { branch, repo } using the plugin's `environments`
 * map plus the fallbacks (branch = env name; repo = top-level `repo`).
 *
 * Returns null when the env is not registered in `promotionChain` —
 * limiting to the chain prevents typos like "stage" vs "staging" from
 * silently working against an arbitrary branch.
 */
export class EnvironmentResolver {
  constructor(
    private readonly defaultRepo: string,
    private readonly chain: readonly string[] | undefined,
    private readonly overrides: Record<string, { branch: string; repo?: string }> | undefined,
  ) {}

  resolve(envName: string): ResolvedEnv | null {
    if (!this.chain || !this.chain.includes(envName)) {
      return null;
    }
    const override = this.overrides?.[envName];
    return {
      name: envName,
      branch: override?.branch ?? envName,
      repo: override?.repo ?? this.defaultRepo,
    };
  }

  /** True iff a non-empty chain has been configured. */
  isConfigured(): boolean {
    return Array.isArray(this.chain) && this.chain.length >= 2;
  }
}

type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

export class PromotionService {
  constructor(
    private readonly provider: GitProvider,
    private readonly resolver: EnvironmentResolver,
    private readonly logger: Logger,
    /**
     * Repo-relative path of the aggregate manifest (default
     * `flows/_manifest.json`). Used to fetch the source-branch manifest
     * for the PR-body enrichment.
     */
    private readonly basePath: string = 'flows/',
  ) {}

  async promote(
    db: PluginDatabaseApi,
    opts: PromoteOptions & { defaultSourceEnv?: string },
  ): Promise<PromoteResult> {
    if (!this.resolver.isConfigured()) {
      return {
        status: 'invalid-env',
        message:
          'Promotion requires `promotionChain` to be configured with at least two environments.',
      };
    }

    const sourceEnvName = opts.sourceEnv ?? opts.defaultSourceEnv;
    if (!sourceEnvName) {
      return {
        status: 'invalid-env',
        message: 'sourceEnv is required when the instance has no `environment` option configured.',
      };
    }
    if (sourceEnvName === opts.targetEnv) {
      return {
        status: 'invalid-env',
        message: `sourceEnv and targetEnv must differ (both are '${opts.targetEnv}').`,
      };
    }

    const source = this.resolver.resolve(sourceEnvName);
    const target = this.resolver.resolve(opts.targetEnv);
    if (!source) {
      return {
        status: 'invalid-env',
        message: `Source env '${sourceEnvName}' is not in promotionChain.`,
      };
    }
    if (!target) {
      return {
        status: 'invalid-env',
        message: `Target env '${opts.targetEnv}' is not in promotionChain.`,
      };
    }

    if (source.repo !== target.repo) {
      // Cross-repo promotion is plan-OOS for v1 (PLAN.md §12). Refuse
      // explicitly so the failure mode is named, not "GitHub said no".
      return {
        status: 'cross-repo-not-supported',
        message: `Cross-repo promotion not supported in v1 (source: ${source.repo}, target: ${target.repo}).`,
        sourceEnv: source.name,
        targetEnv: target.name,
      };
    }

    let comparison: BranchComparison;
    try {
      comparison = await this.provider.compareBranches(
        source.repo,
        target.branch, // base = target (where the changes will go)
        source.branch, // head = source (where they're coming from)
      );
    } catch (err) {
      this.logger.error('promotion: compareBranches failed', {
        sourceBranch: source.branch,
        targetBranch: target.branch,
        error: (err as Error).message,
      });
      return {
        status: 'error',
        message: `Failed to compare branches: ${(err as Error).message}`,
        sourceEnv: source.name,
        targetEnv: target.name,
        sourceBranch: source.branch,
        targetBranch: target.branch,
      };
    }

    if (comparison.aheadBy === 0) {
      return {
        status: 'nothing-to-promote',
        message: `${source.branch} has no commits ahead of ${target.branch}.`,
        sourceEnv: source.name,
        targetEnv: target.name,
        sourceBranch: source.branch,
        targetBranch: target.branch,
        aheadBy: 0,
        behindBy: comparison.behindBy,
        files: [],
      };
    }

    // Phase 4 — fetch the source-branch manifest for the PR body. Reading
    // it from git rather than from the local DB means it reflects exactly
    // what's about to land, including any flows that the manifest has
    // entries for but the local DB doesn't (cross-instance promotion
    // scenarios). Failure is non-fatal: we proceed without the section.
    const manifest = await this.tryLoadManifest(source.repo, source.branch);

    // Build the PR. Auto title encodes the chain step so reviewers see at
    // a glance what's being moved. Body lists the file changes plus the
    // manifest delta when available.
    const title = opts.titleOverride ?? this.buildTitle(source.name, target.name, comparison);
    const body = opts.bodyOverride ?? this.buildBody(source, target, comparison, manifest);

    let pr;
    try {
      pr = await this.provider.createPullRequest(source.repo, {
        title,
        body,
        head: source.branch,
        base: target.branch,
      });
    } catch (err) {
      this.logger.error('promotion: createPullRequest failed', {
        sourceBranch: source.branch,
        targetBranch: target.branch,
        error: (err as Error).message,
      });
      return {
        status: 'error',
        message: `Failed to open PR: ${(err as Error).message}`,
        sourceEnv: source.name,
        targetEnv: target.name,
        sourceBranch: source.branch,
        targetBranch: target.branch,
      };
    }

    // Record per-flow history rows for the audit trail. Map changed file
    // paths back to flowIds via vc_sync_config — each tracked flow has a
    // 1:1 file path. Files that don't map to a tracked flow (legacy /
    // hand-written .flow.ts in the repo) are skipped silently.
    await this.recordHistoryForChangedFiles(db, comparison.files, {
      prNumber: pr.number,
      message: `PR #${pr.number} opened: ${source.name} → ${target.name}`,
      identity: opts.identity ?? null,
    });

    this.logger.info('promotion: PR opened', {
      sourceEnv: source.name,
      targetEnv: target.name,
      prNumber: pr.number,
      prUrl: pr.url,
      filesAffected: comparison.files.length,
    });

    return {
      status: 'pr-opened',
      sourceEnv: source.name,
      targetEnv: target.name,
      sourceBranch: source.branch,
      targetBranch: target.branch,
      prNumber: pr.number,
      prUrl: pr.url,
      aheadBy: comparison.aheadBy,
      behindBy: comparison.behindBy,
      files: comparison.files,
    };
  }

  // ---------------------------------------------------------------------------

  private buildTitle(sourceEnv: string, targetEnv: string, comparison: BranchComparison): string {
    const fileCount = comparison.files.length;
    const fileWord = fileCount === 1 ? 'flow' : 'flows';
    return `Promote ${sourceEnv} → ${targetEnv} (${fileCount} ${fileWord})`;
  }

  private buildBody(
    source: ResolvedEnv,
    target: ResolvedEnv,
    comparison: BranchComparison,
    manifest: AggregateManifest | null,
  ): string {
    const lines: string[] = [];
    lines.push(`Automated promotion from \`${source.branch}\` to \`${target.branch}\`.`);
    lines.push('');
    lines.push(`**${comparison.aheadBy}** commit(s) ahead of \`${target.branch}\`.`);
    if (comparison.behindBy > 0) {
      lines.push(
        `⚠️ \`${source.branch}\` is \`${comparison.behindBy}\` commit(s) BEHIND \`${target.branch}\` — review for diverging history.`,
      );
    }
    lines.push('');
    lines.push('### Files');
    if (comparison.files.length === 0) {
      lines.push('_(no file-level changes — commits may be infrastructure-only)_');
    } else {
      for (const f of comparison.files) {
        const tag =
          f.status === 'added'
            ? '➕'
            : f.status === 'removed'
              ? '➖'
              : f.status === 'renamed'
                ? '↪'
                : '✏️';
        const renameSuffix = f.previousPath ? ` (was ${f.previousPath})` : '';
        lines.push(`- ${tag} \`${f.path}\`${renameSuffix}`);
      }
    }

    // Phase 4 — manifest section. Lists the union of credentials needed
    // by all flows on the source branch. Reviewers (and CI tools) use
    // this to verify the target env has the right credentials before
    // merging. Source of truth: the source branch's `_manifest.json`.
    if (manifest) {
      lines.push('');
      lines.push('### Required credentials (manifest contract)');
      const allCreds = new Set<string>();
      for (const flow of Object.values(manifest.flows)) {
        for (const c of flow.requires.credentials) {
          allCreds.add(c);
        }
      }
      if (allCreds.size === 0) {
        lines.push('_(none — these flows reference no external credentials)_');
      } else {
        const sorted = Array.from(allCreds).sort();
        for (const c of sorted) {
          // List per-credential the flows that reference it so a reviewer
          // can trace why a given env appears in the contract.
          const referencingFlows = Object.values(manifest.flows)
            .filter((f) => f.requires.credentials.includes(c))
            .map((f) => f.name || f.flowId);
          lines.push(`- \`${c}\`  _(used by: ${referencingFlows.join(', ')})_`);
        }
        lines.push('');
        lines.push(
          `Run \`flowlib check --target ${target.name}\` to verify \`${target.branch}\` can satisfy this contract before merging.`,
        );
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('_Generated by @flowlib/version-control. Merge to advance the target environment._');
    return lines.join('\n');
  }

  /**
   * Best-effort manifest load from the source branch. Returns null when:
   *   - the file doesn't exist (legacy repo without a manifest yet),
   *   - the JSON is malformed (logged but doesn't fail the promotion),
   *   - the network call throws (logged + skipped).
   *
   * The PR opens regardless — the manifest is presentational, not
   * load-bearing in v1.
   */
  private async tryLoadManifest(repo: string, ref: string): Promise<AggregateManifest | null> {
    try {
      const path = manifestFilePath(this.basePath);
      const file = await this.provider.getFileContent(repo, path, ref);
      if (!file) {
        return null;
      }
      const parsed = JSON.parse(file.content) as AggregateManifest;
      if (parsed.version !== 1 || typeof parsed.flows !== 'object') {
        this.logger.warn('promotion: manifest has unexpected shape, skipping', {
          path,
          ref,
        });
        return null;
      }
      return parsed;
    } catch (err) {
      this.logger.warn('promotion: failed to load manifest', {
        ref,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private async recordHistoryForChangedFiles(
    db: PluginDatabaseApi,
    files: BranchComparisonFile[],
    opts: { prNumber: number; message: string; identity: string | null },
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const paths = files.map((f) => f.path).filter(Boolean);
    if (paths.length === 0) {
      return;
    }

    const placeholders = paths.map(() => '?').join(', ');
    const rows = await db.query<{ flow_id: string }>(
      `SELECT flow_id FROM flowlib_vc_sync_config WHERE file_path IN (${placeholders})`,
      paths,
    );

    const now = new Date().toISOString();
    for (const row of rows) {
      await db.execute(
        `INSERT INTO flowlib_vc_sync_history
         (id, flow_id, action, commit_sha, pr_number, version, message, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          row.flow_id,
          'pr-created',
          null,
          opts.prNumber,
          null,
          opts.message,
          now,
          opts.identity,
        ],
      );
    }
  }
}
