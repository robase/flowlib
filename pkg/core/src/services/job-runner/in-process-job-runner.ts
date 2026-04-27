/**
 * Default in-process implementation of `JobRunnerAdapter` (PR 13/14).
 *
 * Stores enqueued jobs in an in-memory queue. Handlers are registered
 * by `ServiceFactory.initialize()` (via the orchestration service)
 * for each known job type and invoked on a microtask immediately after
 * enqueue, preserving today's fire-and-forget behaviour for self-hosted
 * Node deployments.
 *
 * `processNextBatch` lets a host drain the queue synchronously
 * (e.g. tests). External-queue adapters (Cloudflare Queues, SQS) leave
 * this method `undefined` because their consumer Worker is driven by
 * the platform, not by an Flowlib API call.
 *
 * Idempotency: if `enqueue` is called twice with the same
 * `(jobType, options.idempotencyKey)` pair, the handler runs at most
 * once. The seen-set is bounded — entries older than `idempotencyTtlMs`
 * are pruned on each enqueue. Self-hosted users who don't need dedupe
 * simply omit `idempotencyKey` and incur no overhead.
 */

import type { Logger } from 'src/schemas';
import type { JobOptions, JobRunnerAdapter } from '../../types/services';

/** Handler signature: receives the same payload that was enqueued. */
export type JobHandler<T = unknown> = (payload: T) => Promise<void> | void;

interface PendingJob {
  jobId: string;
  jobType: string;
  payload: unknown;
  options?: JobOptions;
  /** Unix-ms epoch at which this job is eligible to run. */
  runAfter: number;
  /** How many attempts so far (0 before first run). */
  attempts: number;
}

interface SeenIdempotencyEntry {
  jobId: string;
  expiresAt: number;
}

export interface InProcessJobRunnerOptions {
  /**
   * How long an idempotency key is remembered, in ms. Default 24 h.
   * Tune lower if memory pressure matters; tune higher if your
   * dedupe window needs to span longer than a day.
   */
  idempotencyTtlMs?: number;
  /**
   * If `true` (default), `enqueue` schedules `processNextBatch` on a
   * microtask so handlers run roughly when control returns to the
   * event loop — the historical fire-and-forget behaviour. If `false`,
   * callers must invoke `processNextBatch()` explicitly to drain the
   * queue (useful for deterministic tests).
   */
  autoRun?: boolean;
  /**
   * Logger used for handler-thrown errors. Optional — falls back to
   * `console` when not provided.
   */
  logger?: Logger;
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

let nextJobIdCounter = 0;

function generateJobId(): string {
  // crypto.randomUUID is available in Node 19+, Workers, Deno, Bun —
  // anywhere we'd reasonably run @flowlib/core. Fall back to a counter
  // for the (very rare) runtime that lacks it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  nextJobIdCounter += 1;
  return `job-${Date.now()}-${nextJobIdCounter}`;
}

export class InProcessJobRunner implements JobRunnerAdapter {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: PendingJob[] = [];
  private readonly seenIdempotency = new Map<string, SeenIdempotencyEntry>();
  private readonly idempotencyTtlMs: number;
  private readonly autoRun: boolean;
  private readonly logger: Pick<Logger, 'warn' | 'error'>;

  constructor(options: InProcessJobRunnerOptions = {}) {
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    this.autoRun = options.autoRun ?? true;
    // Minimal fallback so this class is usable without wiring a Logger
    // (e.g. unit tests that construct it directly).
    /* eslint-disable no-console */
    this.logger =
      options.logger ??
      ({
        warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
        error: (msg: string, ...args: unknown[]) => console.error(msg, ...args),
      } as Pick<Logger, 'warn' | 'error'>);
    /* eslint-enable no-console */
  }

  /**
   * Register (or replace) the handler for a given `jobType`.
   *
   * `ServiceFactory.initialize()` calls this once per job type during
   * startup (via `FlowOrchestrationService.registerInProcessJobHandlers`).
   * Registering a second handler for the same type overwrites the
   * first — useful for tests, harmless in production.
   */
  registerHandler<T = unknown>(jobType: string, handler: JobHandler<T>): void {
    this.handlers.set(jobType, handler as JobHandler);
  }

  /** True iff a handler is registered for `jobType`. */
  hasHandler(jobType: string): boolean {
    return this.handlers.has(jobType);
  }

  /** Number of jobs currently queued (not yet processed). Mostly useful for tests. */
  queueSize(): number {
    return this.queue.length;
  }

  async enqueue<T = unknown>(
    jobType: string,
    payload: T,
    options?: JobOptions,
  ): Promise<{ jobId: string }> {
    // Dedupe BEFORE we mutate state so the second caller observes the
    // first enqueue's jobId.
    const dedupeKey = options?.idempotencyKey
      ? this.makeDedupeKey(jobType, options.idempotencyKey)
      : null;

    if (dedupeKey) {
      this.pruneIdempotency();
      const seen = this.seenIdempotency.get(dedupeKey);
      if (seen) {
        return { jobId: seen.jobId };
      }
    }

    const jobId = generateJobId();
    const delayMs = Math.max(0, (options?.delaySeconds ?? 0) * 1000);
    const job: PendingJob = {
      jobId,
      jobType,
      payload,
      options,
      runAfter: Date.now() + delayMs,
      attempts: 0,
    };
    this.queue.push(job);

    if (dedupeKey) {
      this.seenIdempotency.set(dedupeKey, {
        jobId,
        expiresAt: Date.now() + this.idempotencyTtlMs,
      });
    }

    if (this.autoRun) {
      // Fire-and-forget on a microtask. `processNextBatch` returns a
      // promise; we intentionally don't await it so `enqueue` resolves
      // promptly (matches today's `executeFlowAsync` behaviour).
      queueMicrotask(() => {
        void this.processNextBatch();
      });
    }

    return { jobId };
  }

  /**
   * Pull up to `maxJobs` ready jobs off the queue and run them.
   *
   * "Ready" = `runAfter <= now`. Jobs whose `delaySeconds` hasn't
   * elapsed are skipped this pass and remain in the queue. Returns
   * the number of handler invocations attempted (including ones that
   * threw).
   */
  async processNextBatch(maxJobs?: number): Promise<{ processed: number }> {
    const limit = maxJobs ?? this.queue.length;
    const now = Date.now();
    let processed = 0;

    // Index-based loop so we can splice ready jobs out without
    // confusing the iterator.
    let i = 0;
    while (i < this.queue.length && processed < limit) {
      const job = this.queue[i];
      if (job.runAfter > now) {
        i += 1;
        continue;
      }
      this.queue.splice(i, 1);
      processed += 1;
      await this.runJob(job);
      // Don't advance `i` — splice shifted everything left.
    }

    return { processed };
  }

  /** Test/host helper: drop every queued job without running it. */
  clear(): void {
    this.queue.length = 0;
    this.seenIdempotency.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async runJob(job: PendingJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      this.logger.warn(
        `[InProcessJobRunner] no handler registered for jobType "${job.jobType}" (jobId=${job.jobId}); dropping`,
      );
      return;
    }

    const maxAttempts = Math.max(1, job.options?.maxAttempts ?? 1);

    while (job.attempts < maxAttempts) {
      job.attempts += 1;
      try {
        await handler(job.payload);
        return;
      } catch (error) {
        if (job.attempts >= maxAttempts) {
          this.logger.error(
            `[InProcessJobRunner] job ${job.jobId} (${job.jobType}) failed after ${job.attempts} attempt(s)`,
            error,
          );
          return;
        }
        this.logger.warn(
          `[InProcessJobRunner] job ${job.jobId} (${job.jobType}) attempt ${job.attempts} failed; retrying`,
          error,
        );
      }
    }
  }

  private makeDedupeKey(jobType: string, idempotencyKey: string): string {
    return `${jobType}::${idempotencyKey}`;
  }

  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.seenIdempotency) {
      if (entry.expiresAt <= now) {
        this.seenIdempotency.delete(key);
      }
    }
  }
}
