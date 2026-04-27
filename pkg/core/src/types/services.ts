/**
 * Pluggable service adapter interfaces (PR 2/14 from flowlib-hosted/UPSTREAM.md).
 *
 * These interfaces define the seams that allow `createFlowlib()` users to swap
 * the default implementations of cross-cutting infrastructure services
 * (encryption, event bus, chat sessions, cron, batch polling) for
 * runtime-specific alternatives. The hosted Cloudflare variant uses these to
 * inject DO-backed event buses, KV-backed chat sessions, and no-op
 * schedulers (because Cloudflare Cron Triggers handle scheduling externally).
 *
 * Self-hosted users get the unchanged in-process defaults and never need to
 * touch this surface.
 *
 * Wave 2 PRs (5, 8, 12, 13, 14) will plug concrete adapters into these seams;
 * this file only defines the contracts.
 */

import type { ExecutionStreamEvent } from '../services/execution-event-bus';
import type { EncryptedData } from '../services/credentials/encryption.service';
import type { ActiveChatSession } from '../services/chat/active-chat-sessions';

// ─── Encryption ──────────────────────────────────────────────────────

/**
 * Optional scope passed alongside `encrypt`/`decrypt` calls.
 *
 * The default `EncryptionService` ignores this entirely (wire-format unchanged).
 * Hosted multi-tenant adapters use it to look up a per-organization Data
 * Encryption Key (DEK) — see PR 12 in flowlib-hosted/UPSTREAM.md.
 */
export interface EncryptionContext {
  /** Tenant scope — multi-tenant hosts derive a per-org DEK from this. */
  organizationId?: string;
  /** Optional user scope for auditability. */
  userId?: string;
  /** Free-form purpose string (e.g. `"credential"`, `"webhook-secret"`). */
  purpose?: string;
}

/**
 * Pluggable encryption adapter.
 *
 * The default in-process implementation is `EncryptionService`
 * ([encryption.service.ts](../services/credentials/encryption.service.ts)),
 * which uses AES-256-GCM via WebCrypto and ignores `context`.
 *
 * Wire format (`EncryptedData`) is shared across implementations so
 * envelopes written by one adapter can be decrypted by another (subject
 * to the host owning the right key material).
 */
export interface EncryptionAdapter {
  encrypt(plaintext: string | object, context?: EncryptionContext): Promise<EncryptedData>;
  decrypt(envelope: EncryptedData, context?: EncryptionContext): Promise<string>;
}

// ─── Execution event bus ─────────────────────────────────────────────

/**
 * Pluggable execution-event pub/sub.
 *
 * The default in-process implementation is `ExecutionEventBus`
 * ([execution-event-bus.ts](../services/execution-event-bus.ts)) backed
 * by Node's `EventEmitter`. It works well for single-process self-hosted
 * deployments. Multi-isolate runtimes (Cloudflare Workers, multi-region
 * Vercel) need an out-of-process adapter — typically a Durable Object
 * that fans events out over WebSockets — see PR 8 in
 * flowlib-hosted/UPSTREAM.md.
 *
 * `subscribe` returns an unsubscribe function. Implementations MUST be
 * idempotent — calling the returned disposer twice is a no-op.
 */
export interface ExecutionEventBusAdapter {
  emit(event: ExecutionStreamEvent): void | Promise<void>;
  subscribe(flowRunId: string, handler: (event: ExecutionStreamEvent) => void): () => void;
}

// ─── Chat session store ──────────────────────────────────────────────

/**
 * Pluggable chat-session storage.
 *
 * The default in-process implementation is `ActiveChatSessions`
 * ([active-chat-sessions.ts](../services/chat/active-chat-sessions.ts)),
 * a `Map<string, ActiveChatSession>`. It survives client disconnects
 * within a single process by keeping a bounded FIFO of stream events.
 *
 * Multi-instance deployments need either sticky-session routing or a
 * shared store implementing this interface (KV, Redis, or DO-backed).
 *
 * `set` accepts a `ttlSeconds` hint — adapters that support TTL (KV,
 * Redis) should honor it; in-process adapters may ignore it (the
 * existing service has its own internal eviction timer).
 */
export interface ChatSessionStore {
  get(id: string): Promise<ActiveChatSession | null>;
  set(id: string, session: ActiveChatSession, options?: { ttlSeconds?: number }): Promise<void>;
  delete(id: string): Promise<void>;
}

// ─── Cron scheduler ──────────────────────────────────────────────────

/**
 * Pluggable cron scheduler lifecycle.
 *
 * The default in-process implementation is `CronSchedulerService`
 * ([cron-scheduler.service.ts](../services/triggers/cron-scheduler.service.ts)),
 * built on `croner`. It reads enabled cron triggers from the DB at
 * `start()` and re-reads on `refresh()`.
 *
 * Edge runtimes that use externally-managed cron (Cloudflare Cron
 * Triggers, Vercel Cron) should pass a no-op adapter and call
 * `flowlib.triggers.runDueTriggers()` (PR 5) directly from their
 * platform's cron entry point.
 */
export interface CronSchedulerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
}

// ─── Batch poller ────────────────────────────────────────────────────

/**
 * Pluggable batch-job polling lifecycle.
 *
 * The default behavior is the `setInterval` loop in `BaseAIClient`
 * ([base-client.ts](../services/ai/base-client.ts)) which polls every
 * 5 seconds for OpenAI/Anthropic batch results. This works fine on
 * long-lived Node processes but cannot run on serverless workers
 * (no timers between requests).
 *
 * Edge hosts pass a no-op adapter and invoke
 * `flowlib.runs.pollBatchJobs()` (PR 5) from a Cloudflare Cron Trigger
 * or Vercel Cron Job. `start()` then returns immediately and the
 * `setInterval` is never created.
 */
export interface BatchPollerAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ─── Background job runner ───────────────────────────────────────────

/**
 * Optional per-enqueue options.
 *
 * Adapters are free to ignore any field they don't natively support
 * (e.g. the in-process default ignores `delaySeconds` past `setTimeout`
 * granularity, and `maxAttempts` past one). External queue adapters
 * (Cloudflare Queues, AWS SQS, GCP Pub/Sub) typically map these
 * one-for-one.
 */
export interface JobOptions {
  /** Earliest time the job should run, expressed as a delay in seconds. */
  delaySeconds?: number;
  /** Maximum number of attempts (including the first) before the job is considered dead. */
  maxAttempts?: number;
  /**
   * Stable key used by dedupe-aware queues.
   *
   * Two `enqueue` calls with the same `(jobType, idempotencyKey)` pair
   * MUST result in the handler running at most once. Adapters whose
   * underlying queue lacks a dedupe primitive should track recently-seen
   * keys in memory (the in-process default does exactly this).
   */
  idempotencyKey?: string;
}

/**
 * Pluggable background job runner (PR 13/14 from
 * flowlib-hosted/UPSTREAM.md).
 *
 * Two work-shapes inside `@flowlib/core` route through this contract:
 *
 *  - `'flow-run'` — fired by trigger handlers (cron, webhook) and by
 *    `executeFlowAsync`. Default in-process payload is
 *    `{ flowRunId, flowId, useBatchProcessing? }`.
 *  - `'batch-job-resume'` — fired by the batch resumption sweep when a
 *    paused flow's batch completes. Payload is
 *    `{ flowRunId, nodeId, batchResult?, batchError? }`.
 *
 * The default `InProcessJobRunner` runs handlers on a microtask in the
 * same isolate, preserving today's fire-and-forget behaviour. Hosted
 * (Cloudflare) substitutes an adapter that maps `enqueue` to
 * `env.QUEUE.send(payload)` so a separate consumer Worker picks the
 * job up.
 *
 * `processNextBatch` is optional — it only makes sense for adapters
 * that pull from a local queue (the in-process default). External
 * queues drive their consumers separately and may leave it undefined.
 */
export interface JobRunnerAdapter {
  /**
   * Enqueue a job for asynchronous processing.
   *
   * Returns a stable `jobId` the caller can correlate with later events.
   * Implementations MUST resolve quickly — the actual work happens
   * asynchronously after this method returns.
   */
  enqueue<T = unknown>(
    jobType: string,
    payload: T,
    options?: JobOptions,
  ): Promise<{ jobId: string }>;

  /**
   * Pull up to `maxJobs` enqueued jobs and run them through their
   * registered handlers.
   *
   * Only meaningful for adapters that pull (the in-process default).
   * External queues (Cloudflare Queues, SQS, Pub/Sub) drive their
   * consumer Worker through the platform and may leave this
   * `undefined`.
   */
  processNextBatch?(maxJobs?: number): Promise<{ processed: number }>;
}

// ─── Aggregate config ────────────────────────────────────────────────

/**
 * Optional `services` block on `FlowlibConfig`.
 *
 * Each field is independently swappable — omit any field to keep the
 * built-in default. All fields are typed as the corresponding adapter
 * interface here, but on `FlowlibConfig` they are stored as
 * `z.unknown()` since adapter instances aren't Zod-validatable.
 */
export interface FlowlibServiceOverrides {
  encryption?: EncryptionAdapter;
  eventBus?: ExecutionEventBusAdapter;
  chatSessionStore?: ChatSessionStore;
  cronScheduler?: CronSchedulerAdapter;
  batchPoller?: BatchPollerAdapter;
  /** PR 13/14 — pluggable background job runner for triggers + batch resumption. */
  jobRunner?: JobRunnerAdapter;
}
