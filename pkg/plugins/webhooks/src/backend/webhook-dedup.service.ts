/**
 * Webhook Dedup Service — prevents duplicate webhook events.
 * Moved from @flowlib/core to the webhooks plugin.
 */

export interface WebhookDedupOptions {
  ttlMs?: number;
  maxEntries?: number;
}

interface DedupEntry {
  createdAt: number;
  flowRunIds: string[];
}

export class WebhookDedupService {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, DedupEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: WebhookDedupOptions) {
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options?.maxEntries ?? 100_000;

    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private key(webhookPath: string, deliveryId: string): string {
    return `${webhookPath}:${deliveryId}`;
  }

  check(webhookPath: string, deliveryId: string | undefined): DedupEntry | null {
    if (!deliveryId) {
      return null;
    }

    const k = this.key(webhookPath, deliveryId);
    const existing = this.entries.get(k);
    if (!existing) {
      return null;
    }

    if (Date.now() - existing.createdAt > this.ttlMs) {
      this.entries.delete(k);
      return null;
    }

    return existing;
  }

  record(webhookPath: string, deliveryId: string | undefined, flowRunIds: string[]): void {
    if (!deliveryId) {
      return;
    }

    const k = this.key(webhookPath, deliveryId);

    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey) {
        this.entries.delete(firstKey);
      }
    }

    this.entries.set(k, { createdAt: Date.now(), flowRunIds });
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.createdAt < cutoff) {
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}
