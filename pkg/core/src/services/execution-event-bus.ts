/**
 * Execution Event Bus
 *
 * In-process pub/sub for flow-run and node-execution state changes.
 * Services emit events when they write to the database; SSE endpoints
 * subscribe per flow-run ID and forward events to connected clients.
 *
 * This module exports three implementations of `ExecutionEventBusAdapter`
 * (defined in `pkg/core/src/types/services.ts`):
 *
 *   1. `ExecutionEventBus` — the default `EventEmitter`-backed in-process
 *      bus. Used by single-process deployments.
 *   2. `RemoteEventBus` — a skeleton that delegates `emit` and `subscribe`
 *      to host-supplied async callbacks. Edge runtimes plug in a Durable
 *      Object or any other out-of-process pub/sub here.
 *   3. `NoopEventBus` — drops every event and returns idempotent no-op
 *      disposers from `subscribe`. Useful for tests and minimal hosts.
 */
import { EventEmitter } from 'events';
import type { ExecutionEventBusAdapter } from '../types/services';
import type { FlowRun } from './flow-runs/flow-runs.model';
import type { NodeExecution } from './node-executions/node-executions.model';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ExecutionSnapshotEvent = {
  type: 'snapshot';
  flowRun: FlowRun;
  nodeExecutions: NodeExecution[];
};

export type FlowRunUpdatedEvent = {
  type: 'flow_run.updated';
  flowRun: FlowRun;
};

export type NodeExecutionCreatedEvent = {
  type: 'node_execution.created';
  nodeExecution: NodeExecution;
};

export type NodeExecutionUpdatedEvent = {
  type: 'node_execution.updated';
  nodeExecution: NodeExecution;
};

export type HeartbeatEvent = {
  type: 'heartbeat';
};

export type EndEvent = {
  type: 'end';
  flowRun: FlowRun;
};

export type ExecutionStreamEvent =
  | ExecutionSnapshotEvent
  | FlowRunUpdatedEvent
  | NodeExecutionCreatedEvent
  | NodeExecutionUpdatedEvent
  | HeartbeatEvent
  | EndEvent;

// ---------------------------------------------------------------------------
// Bus implementation
// ---------------------------------------------------------------------------

/**
 * Lightweight event bus scoped to flow-run IDs.
 *
 * Consumers call `subscribe(flowRunId, callback)` and receive all events for
 * that run. Producers call `emitFlowRunUpdate`, `emitNodeExecutionCreate`, etc.
 *
 * Implements `ExecutionEventBusAdapter` (see `pkg/core/src/types/services.ts`).
 * Hosts may swap this for a `RemoteEventBus` or a fully custom adapter when
 * running across isolates (Cloudflare Workers, multi-region Vercel, etc.).
 */
export class ExecutionEventBus implements ExecutionEventBusAdapter {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many concurrent SSE listeners per flow-run
    this.emitter.setMaxListeners(0);
  }

  // ---- adapter surface ----------------------------------------------------

  /**
   * Generic emit — required by `ExecutionEventBusAdapter`.
   *
   * Routes the event onto the per-`run:` channel (and, for flow-run updates,
   * the per-`flow:` channel as well) so existing in-process subscribers built
   * against `subscribe` / `subscribeFlow` keep receiving events. Always
   * returns synchronously; the `void | Promise<void>` adapter signature is
   * a superset for async out-of-process implementations like `RemoteEventBus`.
   */
  emit(event: ExecutionStreamEvent): void {
    switch (event.type) {
      case 'flow_run.updated':
        this.emitter.emit(`run:${event.flowRun.id}`, event);
        this.emitter.emit(`flow:${event.flowRun.flowId}`, event);
        return;
      case 'node_execution.created':
      case 'node_execution.updated':
        this.emitter.emit(`run:${event.nodeExecution.flowRunId}`, event);
        return;
      case 'snapshot':
      case 'end':
        this.emitter.emit(`run:${event.flowRun.id}`, event);
        return;
      case 'heartbeat':
        // Heartbeats have no flow-run scope; nothing to do for the in-process bus.
        return;
      default: {
        // Exhaustiveness guard — if a new event variant is added, TS will flag this.
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  // ---- emit helpers -------------------------------------------------------

  emitFlowRunUpdate(flowRun: FlowRun): void {
    const event: FlowRunUpdatedEvent = { type: 'flow_run.updated', flowRun };
    this.emitter.emit(`run:${flowRun.id}`, event);

    // Also emit on the flow-level channel so the runs-list can update
    this.emitter.emit(`flow:${flowRun.flowId}`, event);
  }

  emitNodeExecutionCreate(nodeExecution: NodeExecution): void {
    const event: NodeExecutionCreatedEvent = {
      type: 'node_execution.created',
      nodeExecution,
    };
    this.emitter.emit(`run:${nodeExecution.flowRunId}`, event);
  }

  emitNodeExecutionUpdate(nodeExecution: NodeExecution): void {
    const event: NodeExecutionUpdatedEvent = {
      type: 'node_execution.updated',
      nodeExecution,
    };
    this.emitter.emit(`run:${nodeExecution.flowRunId}`, event);
  }

  // ---- subscription -------------------------------------------------------

  /**
   * Subscribe to events for a specific flow run.
   * Returns an unsubscribe function. Calling the disposer twice is safe
   * (Node's `EventEmitter#off` is a no-op for unregistered listeners).
   */
  subscribe(flowRunId: string, callback: (event: ExecutionStreamEvent) => void): () => void {
    const channel = `run:${flowRunId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }

  /**
   * Subscribe to all run-level events for a specific flow (e.g. runs list updates).
   */
  subscribeFlow(flowId: string, callback: (event: ExecutionStreamEvent) => void): () => void {
    const channel = `flow:${flowId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }
}

// ---------------------------------------------------------------------------
// Remote / no-op adapters
// ---------------------------------------------------------------------------

/**
 * Callbacks supplied by the host to back a `RemoteEventBus`.
 *
 * `publish` is invoked once per `emit(event)` call. `subscribe` is invoked
 * once per `subscribe(flowRunId, handler)` call and MUST return a disposer
 * that the host honors (calling it twice should be safe).
 */
export interface RemoteEventBusOptions {
  publish: (event: ExecutionStreamEvent) => void | Promise<void>;
  subscribe: (
    flowRunId: string,
    handler: (event: ExecutionStreamEvent) => void,
  ) => (() => void) | Promise<() => void>;
}

/**
 * Skeleton out-of-process event bus.
 *
 * Implements `ExecutionEventBusAdapter` by delegating to host-supplied
 * `publish` / `subscribe` callbacks. Typical edge-runtime wiring routes
 * `publish` to a Durable Object (or external pub/sub) that fans events
 * out via WebSockets to subscribed clients.
 *
 * `subscribe` returns a synchronous disposer. If the host's `subscribe`
 * callback returns a `Promise<() => void>`, the disposer awaits the
 * resolution before invoking the underlying off-handler. Calling the
 * returned disposer multiple times is safe (subsequent calls are no-ops).
 */
export class RemoteEventBus implements ExecutionEventBusAdapter {
  constructor(private readonly options: RemoteEventBusOptions) {}

  emit(event: ExecutionStreamEvent): void | Promise<void> {
    return this.options.publish(event);
  }

  subscribe(flowRunId: string, handler: (event: ExecutionStreamEvent) => void): () => void {
    let disposed = false;
    let syncOff: (() => void) | null = null;

    const result = this.options.subscribe(flowRunId, handler);
    if (typeof (result as Promise<() => void>).then === 'function') {
      const pending = result as Promise<() => void>;
      pending.then((off) => {
        if (disposed) {
          // Disposer was called before the subscription resolved; tear down now.
          off();
        } else {
          syncOff = off;
        }
      });
    } else {
      syncOff = result as () => void;
    }

    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (syncOff) {
        syncOff();
      }
      // If the subscription is still pending, the .then() callback above
      // will tear it down once it resolves.
    };
  }
}

/**
 * No-op event bus — drops every event and hands back idempotent no-op
 * disposers from `subscribe`.
 *
 * Use in tests or in minimal hosts that don't need execution streaming
 * (e.g. one-shot CLI invocations). Implements `ExecutionEventBusAdapter`
 * so it can be passed straight into `config.services.eventBus`.
 */
export class NoopEventBus implements ExecutionEventBusAdapter {
  emit(_event: ExecutionStreamEvent): void {
    // intentionally empty
  }

  subscribe(_flowRunId: string, _handler: (event: ExecutionStreamEvent) => void): () => void {
    return NOOP_DISPOSER;
  }
}

const NOOP_DISPOSER = (): void => {
  // intentionally empty — calling repeatedly is safe
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalBus: ExecutionEventBus | null = null;

export function getExecutionEventBus(): ExecutionEventBus {
  if (!globalBus) {
    globalBus = new ExecutionEventBus();
  }
  return globalBus;
}

/** Reset for tests */
export function resetExecutionEventBus(): void {
  globalBus = null;
}
