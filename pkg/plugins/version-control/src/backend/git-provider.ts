// =============================================================================
// Git Provider Interface — abstraction over GitHub / GitLab / Bitbucket
// =============================================================================

/** Result of fetching a file from the remote */
export interface GitFileContent {
  content: string;
  sha: string;
}

/** Result of creating/updating a file on the remote */
export interface GitCommitResult {
  commitSha: string;
}

/** Branch info */
export interface GitBranchInfo {
  sha: string;
}

/** Provider auth posture exposed for Phase 6 hardening checks. */
export interface GitProviderSecurity {
  /** Authentication mode used by the provider, when known. */
  authType?: 'token' | 'app' | 'credential' | 'unknown';
  /** Whether this provider supports GitHub App style installation auth. */
  supportsAppAuth?: boolean;
  /** Whether this provider can create signed commits through the plugin. */
  supportsSignedCommits?: boolean;
  /** Whether commit signing is configured for this provider instance. */
  signedCommitsConfigured?: boolean;
}

/**
 * One entry in a tree listing — a file (`blob`) or a directory (`tree`).
 *
 * The reconciler walks `blob` entries to build the canonical map of
 * `path → blobSha` for the configured branch on each tick. Directory
 * entries are filtered out by callers that only care about files.
 */
export interface GitTreeEntry {
  /** Full path from the repo root, e.g. `flows/triage.flow.ts` */
  path: string;
  /** Either a file (`blob`) or a directory (`tree`) */
  type: 'blob' | 'tree';
  /** Blob/tree SHA — used for cache invalidation and stable identity */
  sha: string;
  /** File size in bytes (blobs only). May be omitted by some providers. */
  size?: number;
}

/** Pull request / merge request creation options */
export interface CreatePullRequestOptions {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

/** Pull request / merge request result */
export interface GitPullRequestResult {
  number: number;
  url: string;
}

/** Pull request / merge request info */
export interface GitPullRequestInfo {
  state: 'open' | 'closed' | 'merged';
  mergedAt?: string;
}

/** File update options */
export interface GitFileUpdateOptions {
  branch: string;
  sha?: string;
}

/**
 * Files that should land in a single tree commit.
 *
 * `path` is the full repo-relative path. `content` is the raw text — providers
 * are responsible for any base64 / encoding work the underlying API requires.
 */
export interface TreeCommitFile {
  path: string;
  content: string;
}

/** Create-tree-commit options for atomic multi-file batch pushes. */
export interface CreateTreeCommitOptions {
  /** Branch to advance once the commit is built. */
  branch: string;
  /** Commit message. */
  message: string;
  /** Files to write or update. */
  files: TreeCommitFile[];
  /** Repo paths to delete from the new tree (relative to current head). */
  deletes?: string[];
  /**
   * Expected current branch head SHA. Pre-flight check before construction:
   * if the branch has advanced past this, throws `StaleHeadError` and no
   * blobs/trees are created. Omit for unconditional advance (rare — typically
   * caller has the SHA from a prior `getBranch`).
   */
  expectedParentSha?: string;
  /** Optional commit author override. Provider-defined defaults otherwise. */
  author?: { name: string; email: string };
}

/** Per-file outcome of a successful tree commit. */
export interface TreeCommitFileResult {
  path: string;
  /** Blob SHA in the new tree — callers persist this as their `lastCommitSha`. */
  blobSha: string;
}

export interface TreeCommitResult {
  /** SHA of the new commit on the branch. */
  commitSha: string;
  /** New blob SHAs for every file written (deletes are not listed). */
  files: TreeCommitFileResult[];
}

/**
 * Thrown when `createTreeCommit` detects the branch has advanced past the
 * caller's `expectedParentSha`. Callers handle by re-fetching state and
 * either retrying or surfacing a 409 Conflict to the user.
 *
 * Atomicity guarantee: when this is thrown, **no commit was created and no
 * blobs were uploaded** (or whatever was uploaded is unreferenced garbage
 * that GitHub will GC). The branch ref is unchanged.
 */
export class StaleHeadError extends Error {
  constructor(
    public readonly expectedSha: string,
    public readonly actualSha: string,
  ) {
    super(`Stale parent SHA: expected ${expectedSha} but branch is at ${actualSha}`);
    this.name = 'StaleHeadError';
  }
}

/** One file change in a branch comparison. */
export interface BranchComparisonFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'changed';
  /** Source path when `status === 'renamed'`, otherwise undefined. */
  previousPath?: string;
}

/**
 * Result of comparing two branches (`base...head`). Used by Phase 3
 * promotion to decide whether opening a PR makes sense and to pre-render
 * the PR body's "files changed" summary.
 */
export interface BranchComparison {
  /** Commits on head that aren't on base. Zero ⇒ nothing to promote. */
  aheadBy: number;
  /** Commits on base that aren't on head. Non-zero means head needs a rebase. */
  behindBy: number;
  /** Files that differ between base and head. */
  files: BranchComparisonFile[];
}

/**
 * Abstraction over a Git hosting provider (GitHub, GitLab, Bitbucket).
 *
 * All methods operate on a specific repo (owner/name string).
 * The provider handles authentication internally.
 */
export interface GitProvider {
  /** Provider identifier, e.g. 'github', 'gitlab', 'bitbucket' */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Optional security posture metadata surfaced by /vc/health. */
  readonly security?: GitProviderSecurity;

  // -- File operations --

  /** Get file content at a specific ref (branch/SHA). Returns null if file doesn't exist. */
  getFileContent(repo: string, path: string, ref?: string): Promise<GitFileContent | null>;

  /** Create or update a file. If sha is provided, it's an update (must match current SHA for conflict detection). */
  createOrUpdateFile(
    repo: string,
    path: string,
    content: string,
    message: string,
    opts: GitFileUpdateOptions,
  ): Promise<GitCommitResult>;

  /** Delete a file from the repo. */
  deleteFile(
    repo: string,
    path: string,
    message: string,
    opts: { branch: string; sha: string },
  ): Promise<void>;

  // -- Branch operations --

  /** Create a new branch from a ref (branch name or SHA). */
  createBranch(repo: string, branch: string, fromRef: string): Promise<void>;

  /** Delete a branch. */
  deleteBranch(repo: string, branch: string): Promise<void>;

  /** Get branch info. Returns null if branch doesn't exist. */
  getBranch(repo: string, branch: string): Promise<GitBranchInfo | null>;

  /**
   * List the tree at a given ref, optionally constrained to a path prefix.
   *
   * Used by the reconciler to enumerate every tracked `.flow.ts` on the
   * configured branch in one round-trip per tick — without this, status
   * computation would N+1-query a per-file Contents API call.
   *
   * Implementations should request a recursive listing where the underlying
   * API supports it (GitHub's `recursive=1`) so a single call returns the
   * full file tree. Path filtering is done client-side: the host platform
   * APIs typically don't support server-side path scoping.
   *
   * @param repo Repository in `owner/name` form
   * @param ref Branch name or commit SHA
   * @param opts.path Optional path prefix to filter to (e.g. `flows/`)
   */
  listTree(repo: string, ref: string, opts?: { path?: string }): Promise<GitTreeEntry[]>;

  /**
   * Compare two branches (`base...head`). Returns the count of commits
   * each side is ahead/behind, plus the file-level diff. Used by Phase 3
   * promotion to decide whether opening a PR is worth it (aheadBy === 0
   * ⇒ "nothing to promote") and to summarize the changeset in the PR body.
   *
   * GitHub's compare API caps at 300 files per request — providers should
   * note truncation in their comment but the contract here doesn't surface
   * it. Promotion-sized changesets are well below this cap in practice.
   */
  compareBranches(repo: string, base: string, head: string): Promise<BranchComparison>;

  /**
   * Build a single commit containing many file changes and atomically
   * advance the branch ref. The Phase 0c primitive that backs batch push.
   *
   * Atomicity: the underlying steps (build blobs → build tree → build
   * commit) have no side effects on the branch. Only the final ref-advance
   * mutates the branch. So a failure mid-sequence leaves the branch
   * untouched — either every file in `opts.files` lands in the new commit,
   * or none do. Never a partial state.
   *
   * Concurrency: when `expectedParentSha` is provided and the branch has
   * advanced past it, providers throw `StaleHeadError` *before* uploading
   * blobs. Callers should re-fetch their state and retry or surface a 409.
   */
  createTreeCommit(repo: string, opts: CreateTreeCommitOptions): Promise<TreeCommitResult>;

  // -- Pull Request / Merge Request operations --

  /** Create a PR/MR. */
  createPullRequest(repo: string, opts: CreatePullRequestOptions): Promise<GitPullRequestResult>;

  /** Update an existing PR/MR title/body. */
  updatePullRequest(
    repo: string,
    number: number,
    opts: { title?: string; body?: string },
  ): Promise<void>;

  /** Get PR/MR status. */
  getPullRequest(repo: string, number: number): Promise<GitPullRequestInfo>;

  /** Close a PR/MR with an optional comment. */
  closePullRequest(repo: string, number: number, comment?: string): Promise<void>;

  // -- Webhook --

  /**
   * Verify a webhook signature. Returns true if valid.
   *
   * Async because the WebCrypto-based HMAC implementation (used so this runs on
   * Cloudflare Workers / Deno) returns a `Promise<boolean>`. Node-only providers
   * may still implement it synchronously and return a boolean — `Promise<boolean>`
   * accepts both.
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<boolean>;
}
