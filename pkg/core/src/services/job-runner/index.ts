/**
 * Background job runner — pluggable enqueue path for batch resumption and
 * trigger-driven flow runs.
 *
 * The interface lives in `src/types/services.ts` (`JobRunnerAdapter`,
 * `JobOptions`); this module ships the default in-process implementation
 * plus the canonical job-type strings used by the call sites in
 * `flow-orchestration.service.ts`.
 */

export { InProcessJobRunner } from './in-process-job-runner';
export type { InProcessJobRunnerOptions, JobHandler } from './in-process-job-runner';

import type { BatchResult } from '../ai/base-client';

/**
 * Canonical job-type strings recognised by the default
 * `ServiceFactory` wiring. Hosts that swap in their own
 * `JobRunnerAdapter` (e.g. a Cloudflare Queue producer) MUST register
 * matching consumer-side handlers for these types — otherwise trigger
 * fires and batch-resumption events will be silently dropped on the
 * consumer side.
 */
export const JOB_TYPES = {
  /**
   * Run a flow definition asynchronously.
   *
   * In-process payload shape (`FlowRunJobPayload`):
   * ```ts
   * { flowRunId: string; flowId: string; useBatchProcessing?: boolean }
   * ```
   * Fired by `FlowOrchestrationService.executeFlowAsync` (which is
   * itself called from the trigger path and from any HTTP "run flow"
   * handler that doesn't want to block on the result).
   *
   * The flow run row is created synchronously BEFORE enqueue so the
   * caller has a `flowRunId` to return to the client immediately;
   * the handler re-loads the row to recover inputs + trigger context.
   */
  FLOW_RUN: 'flow-run',
  /**
   * Resume a flow run that was paused on a batch node now that the
   * upstream batch has completed (or failed).
   *
   * Payload shape (`BatchJobResumeJobPayload`):
   * ```ts
   * {
   *   flowRunId: string;
   *   nodeId: string;
   *   batchResult?: BatchResult[];
   *   batchError?: string;
   * }
   * ```
   * Fired by `FlowOrchestrationService.runBatchResumptionSweep` for
   * each ready resumption found.
   */
  BATCH_JOB_RESUME: 'batch-job-resume',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/** Payload for a `JOB_TYPES.FLOW_RUN` job. */
export interface FlowRunJobPayload {
  flowRunId: string;
  flowId: string;
  useBatchProcessing?: boolean;
}

/** Payload for a `JOB_TYPES.BATCH_JOB_RESUME` job. */
export interface BatchJobResumeJobPayload {
  flowRunId: string;
  nodeId: string;
  // Carrying these over the wire keeps the consumer from having to
  // re-read the batch row when the local in-process runner just hands
  // back what the sweep already loaded.
  batchResult?: BatchResult[];
  batchError?: string;
}
