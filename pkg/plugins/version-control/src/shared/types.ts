// =============================================================================
// Version Control Plugin — Shared Types (browser-safe, no runtime code)
// =============================================================================

/** Supported sync modes */
export const VC_SYNC_MODES = ['direct-commit', 'pr-per-save', 'pr-per-publish'] as const;
export type VcSyncMode = (typeof VC_SYNC_MODES)[number];

/** Sync direction */
export const VC_SYNC_DIRECTIONS = ['read', 'write', 'read-write'] as const;
export type VcSyncDirection = (typeof VC_SYNC_DIRECTIONS)[number];

/** Legacy sync direction values accepted only when reading old persisted rows. */
export type VcLegacySyncDirection = 'push' | 'pull' | 'bidirectional';

/** Normalize pre-Phase-8 direction values into the public direction vocabulary. */
export function normalizeSyncDirection(direction: string | null | undefined): VcSyncDirection {
  switch (direction) {
    case 'pull':
      return 'read';
    case 'push':
      return 'write';
    case 'bidirectional':
      return 'read-write';
    case 'read':
    case 'write':
    case 'read-write':
      return direction;
    default:
      return 'write';
  }
}

/** Sync history action types */
export type VcSyncAction = 'push' | 'pull' | 'pr-created' | 'pr-merged' | 'conflict';

/** Status of a synced flow */
export type VcSyncStatus = 'synced' | 'pending' | 'conflict' | 'not-connected' | 'error';

/** Git provider authentication config */
export type GitProviderAuth =
  | { type: 'token'; token: string }
  | { type: 'app'; appId: string; privateKey: string; installationId?: number }
  | { type: 'credential'; credentialId: string };

/** Sync config record (mirrors vc_sync_config table) */
export interface VcSyncConfig {
  id: string;
  flowId: string;
  provider: string;
  repo: string;
  branch: string;
  filePath: string;
  mode: VcSyncMode;
  syncDirection: VcSyncDirection;
  lastSyncedAt: string | null;
  lastCommitSha: string | null;
  lastSyncedVersion: number | null;
  draftBranch: string | null;
  activePrNumber: number | null;
  activePrUrl: string | null;
  enabled: boolean;
}

/** Sync history record (mirrors vc_sync_history table) */
export interface VcSyncHistoryRecord {
  id: string;
  flowId: string;
  action: VcSyncAction;
  commitSha: string | null;
  prNumber: number | null;
  version: number | null;
  message: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Sync status response for a flow */
export interface VcFlowSyncStatus {
  flowId: string;
  status: VcSyncStatus;
  config: VcSyncConfig | null;
  lastSync: VcSyncHistoryRecord | null;
}

/** Configure sync request body */
export interface ConfigureSyncInput {
  repo?: string;
  branch?: string;
  filePath?: string;
  mode?: VcSyncMode;
  syncDirection?: VcSyncDirection;
  enabled?: boolean;
}

/** Push/pull result */
export interface VcSyncResult {
  success: boolean;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  action: VcSyncAction;
}

// =============================================================================
// Phase 2 — Per-flow sync state for status chips
// =============================================================================

/**
 * The 13 states a tracked flow can be in. Drawn from the canonical state
 * machine in PLAN.md §3.3 — ordered roughly by observability (the first
 * three are "everything's fine" states, the rest indicate user attention
 * is needed somewhere along the chain).
 *
 * Some states (Behind, Diverged, StaleSha) require a comparison with the
 * remote and are only set by the reconciler on its tick. Others (Dirty,
 * NeverSynced, PrOpen, ConflictPending) are derivable purely from local
 * DB state and are computed synchronously.
 */
export const VC_SYNC_STATES = [
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
export type VcSyncState = (typeof VC_SYNC_STATES)[number];

/**
 * Chip color hints, derived purely from the state. Frontend maps these to
 * Tailwind tokens or theme colors — keeping the mapping abstract here means
 * the same hint serves CLI output, SSE events, and React components.
 */
export type VcSyncChipColor = 'grey' | 'green' | 'blue' | 'yellow' | 'red' | 'purple';

/**
 * Pre-computed UI hints for a state. The reconciler materializes this on
 * each tick into `flowlib_vc_status_cache` so dashboard renders are a
 * single SELECT — not N round-trips of "compute state per flow".
 *
 * `actionLabel` is null when the chip is informational (Synced) or when
 * the action requires a modal (ConflictPending → "Open diff"); the
 * frontend decides what clicking the chip does based on the state value
 * itself, this is just the default label to show on the button.
 */
export interface VcStatusDisplay {
  state: VcSyncState;
  chipColor: VcSyncChipColor;
  chipLabel: string;
  actionLabel: string | null;
  /** Banner / subtext shown on the flow card. Null when no banner. */
  banner: string | null;
}

/** Cached status row (mirrors flowlib_vc_status_cache table). */
export interface VcStatusCacheEntry {
  flowId: string;
  state: VcSyncState;
  chipLabel: string;
  actionLabel: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** Single dirty-list entry surfaced to the modal. */
export interface VcDirtyFlow {
  flowId: string;
  flowName: string;
  state: VcSyncState;
  filePath: string;
  /** Local DB version at time of computation. */
  currentVersion: number;
  /** Last version that was successfully synced (may be null for never-synced). */
  lastSyncedVersion: number | null;
  /** Number of versions ahead of the last sync. */
  ahead: number;
  /** ISO timestamp of last sync, null for never-synced. */
  lastSyncedAt: string | null;
}

/** Result from POST /vc/push (batch). One row per flow attempted. */
export interface VcBatchPushResultEntry {
  flowId: string;
  status: 'pushed' | 'unchanged' | 'error';
  filePath?: string;
  blobSha?: string;
  version?: number;
  error?: string;
}

export interface VcBatchPushResponse {
  success: boolean;
  commitSha?: string;
  results: VcBatchPushResultEntry[];
  error?: string;
}

// =============================================================================
// Phase 7 — Flow diff viewer
// =============================================================================

export type VcFlowDiffLineKind = 'context' | 'added' | 'removed' | 'changed';

/** One side-by-side row comparing the remote branch file to local DB source. */
export interface VcFlowDiffLine {
  kind: VcFlowDiffLineKind;
  /** 1-based line number in the remote branch file. Null for local-only rows. */
  remoteLineNumber: number | null;
  /** 1-based line number in the local DB export. Null for remote-only rows. */
  localLineNumber: number | null;
  /** Remote branch content for this row. Null for local-only rows. */
  remoteContent: string | null;
  /** Local DB content for this row. Null for remote-only rows. */
  localContent: string | null;
}

export interface VcFlowDiffResponse {
  flowId: string;
  filePath: string;
  repo: string;
  branch: string;
  hasRemote: boolean;
  hasChanges: boolean;
  local: {
    version: number;
    content: string;
  };
  remote: {
    sha: string | null;
    content: string | null;
  };
  lines: VcFlowDiffLine[];
}
