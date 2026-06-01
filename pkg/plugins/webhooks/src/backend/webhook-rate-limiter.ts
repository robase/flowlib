/**
 * Webhook Rate Limiter — sliding-window in-memory rate limiter.
 * Moved from @flowlib/core to the webhooks plugin.
 */

export interface RateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
}

interface WindowEntry {
  timestamps: number[];
}

export class WebhookRateLimiter {
  // Mutable so the webhooks plugin can hot-reload these from settings.
  private maxRequests: number;
  private windowMs: number;
  private readonly windows = new Map<string, WindowEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: RateLimiterOptions) {
    this.maxRequests = options?.maxRequests ?? 60;
    this.windowMs = options?.windowMs ?? 60_000;

    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Update the max requests cap. Existing window entries are preserved. */
  setMaxRequests(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      this.maxRequests = Math.floor(value);
    }
  }

  /** Update the rolling-window size in ms. Future `check()` calls use the new value. */
  setWindowMs(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      this.windowMs = Math.floor(value);
    }
  }

  check(key: string): { allowed: boolean; retryAfterMs?: number; remaining?: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldestInWindow = entry.timestamps[0] ?? now;
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1), remaining: 0 };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: this.maxRequests - entry.timestamps.length };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs * 2;
    for (const [key, entry] of this.windows) {
      if (
        entry.timestamps.length === 0 ||
        (entry.timestamps[entry.timestamps.length - 1] ?? 0) < cutoff
      ) {
        this.windows.delete(key);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}
