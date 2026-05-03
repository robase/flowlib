// =============================================================================
// Phase 0c — In-memory lock manager
//
// Two semantics surface here:
//
// 1. **Try-acquire (fail-fast)** — used for user-initiated push and pull.
//    A second concurrent operation on the same flow returns LockBusyError,
//    which the endpoint translates to a 409 with retry guidance. Queueing
//    would mean a slow GitHub round-trip blocks every other writer; users
//    prefer "your push collided, try again" over "your push hangs".
//
// 2. **Per-instance reconciler lock** — already lives inside ReconcilerService
//    (`inFlight` boolean). This module isn't strictly necessary for that
//    case, but exposing it here lets future code (Phase 4 manifest regen,
//    Phase 6 break-glass mutations) coordinate via the same primitive.
//
// Scope: in-memory, per-process. For multi-replica deployments the DB-level
// idempotency token (`flowlib_vc_pull_commits` PK + the planned `(flowId,
// commitSha)` unique constraint on flow_versions in Phase 1) is the actual
// race-safety mechanism. The lock is a UX optimization that turns same-pod
// races into clean errors instead of "last write wins" surprises.
// =============================================================================

/**
 * Thrown when `withTryLock` is called for a key that's already locked.
 * Endpoints translate this to HTTP 409 with a "retry" hint.
 */
export class LockBusyError extends Error {
  constructor(public readonly lockKey: string) {
    super(`Operation already in progress for ${lockKey}`);
    this.name = 'LockBusyError';
  }
}

export class LockManager {
  private readonly held = new Set<string>();

  /**
   * Try to acquire `key`. Synchronous — returns true if newly acquired,
   * false if already held. Caller is responsible for calling `release`.
   */
  tryAcquire(key: string): boolean {
    if (this.held.has(key)) {
      return false;
    }
    this.held.add(key);
    return true;
  }

  /** Release `key`. Idempotent — no-op if not held. */
  release(key: string): void {
    this.held.delete(key);
  }

  /** Diagnostic — true if `key` is currently held. */
  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /**
   * Run `fn` with `key` held. Throws `LockBusyError` immediately if the
   * key is already locked — the operation is *not* queued.
   */
  async withTryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.tryAcquire(key)) {
      throw new LockBusyError(key);
    }
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  /**
   * Run `fn` with multiple keys held atomically. If ANY key is already
   * held, throws `LockBusyError` with the first conflict and releases
   * any partial holds — never partially acquired. Used by batch push to
   * lock all flows in a batch up front.
   */
  async withMultipleTryLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const acquired: string[] = [];
    for (const k of keys) {
      if (!this.tryAcquire(k)) {
        // roll back partial acquisition before throwing
        for (const a of acquired) {
          this.release(a);
        }
        throw new LockBusyError(k);
      }
      acquired.push(k);
    }
    try {
      return await fn();
    } finally {
      for (const k of acquired) {
        this.release(k);
      }
    }
  }
}
