/**
 * Adapter bridges — translate between the pluggable adapter interfaces
 * (`src/types/services.ts`) and the concrete service classes that the rest
 * of `@flowlib/core` already calls into.
 *
 * Each bridge is a thin shim. Their only purpose is to let `ServiceFactory`
 * substitute a user-provided adapter without touching every call site.
 */

import type { FlowRun } from './flow-runs/flow-runs.model';
import type { NodeExecution } from './node-executions/node-executions.model';
import {
  ExecutionEventBus,
  type ExecutionStreamEvent,
  type FlowRunUpdatedEvent,
  type NodeExecutionCreatedEvent,
  type NodeExecutionUpdatedEvent,
} from './execution-event-bus';
import type {
  ExecutionEventBusAdapter,
  CronSchedulerAdapter,
  BatchPollerAdapter,
} from '../types/services';
import type { CronSchedulerService } from './triggers/cron-scheduler.service';
import type { BaseAIClient } from './ai/base-client';

// ─── Execution event bus bridge ──────────────────────────────────────

/**
 * `ExecutionEventBus` subclass that forwards every emit to a user-supplied
 * `ExecutionEventBusAdapter`.
 *
 * The default `ExecutionEventBus` uses Node `EventEmitter` channels; when the
 * host provides an adapter (e.g. a Cloudflare Durable Object client), we
 * still need `flowRunsService.setEventBus(bus)` etc. to keep working —
 * downstream services call typed `emitFlowRunUpdate` / `emitNodeExecutionCreate`
 * / `emitNodeExecutionUpdate`. This bridge translates those calls into
 * `adapter.emit(event)` while keeping the parent class's in-process
 * subscription as a fallback so any same-process subscribers still receive
 * events. Subscribe is also forwarded to the adapter so out-of-process
 * subscribers (e.g. SSE handlers in another isolate) can receive them.
 */
export class AdapterBackedExecutionEventBus extends ExecutionEventBus {
  constructor(private readonly adapter: ExecutionEventBusAdapter) {
    super();
  }

  override emitFlowRunUpdate(flowRun: FlowRun): void {
    super.emitFlowRunUpdate(flowRun);
    const event: FlowRunUpdatedEvent = { type: 'flow_run.updated', flowRun };
    void this.adapter.emit(event);
  }

  override emitNodeExecutionCreate(nodeExecution: NodeExecution): void {
    super.emitNodeExecutionCreate(nodeExecution);
    const event: NodeExecutionCreatedEvent = {
      type: 'node_execution.created',
      nodeExecution,
    };
    void this.adapter.emit(event);
  }

  override emitNodeExecutionUpdate(nodeExecution: NodeExecution): void {
    super.emitNodeExecutionUpdate(nodeExecution);
    const event: NodeExecutionUpdatedEvent = {
      type: 'node_execution.updated',
      nodeExecution,
    };
    void this.adapter.emit(event);
  }

  override subscribe(
    flowRunId: string,
    callback: (event: ExecutionStreamEvent) => void,
  ): () => void {
    // Subscribe both in-process (for same-isolate emitters that go through
    // the parent class's EventEmitter) and through the adapter (for
    // out-of-process emitters routed by the host).
    const offLocal = super.subscribe(flowRunId, callback);
    const offAdapter = this.adapter.subscribe(flowRunId, callback);
    return () => {
      offLocal();
      offAdapter();
    };
  }
}

// ─── Cron scheduler bridge ───────────────────────────────────────────

/**
 * Lifecycle-only view over `CronSchedulerService` for `CronSchedulerAdapter`.
 *
 * `CronSchedulerAdapter` exposes only `start` / `stop` / `refresh` — the rest
 * of `CronSchedulerService` (job introspection, internal `Cron` instances)
 * is intentionally not part of the adapter contract. Use this when the
 * caller has the concrete service but wants to expose only the adapter
 * surface (e.g. testing).
 */
export function cronSchedulerToAdapter(service: CronSchedulerService): CronSchedulerAdapter {
  return {
    async start() {
      await service.start();
    },
    async stop() {
      service.stop();
    },
    async refresh() {
      await service.refresh();
    },
  };
}

// ─── Batch poller bridge ─────────────────────────────────────────────

/**
 * Lifecycle-only view over `BaseAIClient`'s batch polling for
 * `BatchPollerAdapter`.
 *
 * Used by `ServiceFactory` to expose the default batch poller through the
 * same adapter contract that edge runtimes plug a no-op into.
 */
export function batchPollerFromAIClient(client: BaseAIClient): BatchPollerAdapter {
  return {
    async start() {
      await client.startBatchPolling();
    },
    async stop() {
      await client.stopBatchPolling();
    },
  };
}
