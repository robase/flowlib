/**
 * `Backend` — single interface for everything the extension needs from an
 * Invect backend, regardless of where the backend lives.
 *
 * Three implementations satisfy this interface:
 *   - `InProcessBackend`  — embedded `@flowlib/core` against a local SQLite
 *                            file at `globalStorageUri` (Phase 2.5 default).
 *   - `HttpBackend`       — `fetch`-based client for both local-spawned
 *                            (Docker, `pnpm dev`) and remote backends.
 *   - `DisconnectedBackend` — placeholder when nothing is configured;
 *                              every method throws a friendly "not
 *                              connected" error so callers don't need to
 *                              null-check.
 *
 * Callers (`FlowsExplorer`, `runFlow`, `syncFlow`, `RunsPanel`) use this
 * interface and don't care which implementation is active. Switching
 * modes only swaps the singleton.
 */

import type { SseHandler } from './sse';

export interface FlowSummary {
  id: string;
  name: string;
  description?: string;
  updatedAt?: string;
  /**
   * Set by file-backed backends (embedded mode). When present, the explorer
   * opens this URI directly instead of going through `flowlib.pullFromBackend`.
   */
  fileUri?: string;
  [key: string]: unknown;
}

export interface PushFlowResult {
  id: string;
  versionId?: string;
  [key: string]: unknown;
}

export interface RunStartResult {
  flowRunId: string;
  flowId?: string;
  status?: string;
  eventsPath?: string;
  [key: string]: unknown;
}

export interface BackendDescriptor {
  /** UI-facing label for the status bar. */
  label: string;
  /** `embedded` | `http`. */
  kind: 'embedded' | 'http' | 'disconnected';
  /** For HTTP, the URL. For embedded, the DB path. */
  detail?: string;
}

export interface RunSummary {
  id: string;
  flowId: string;
  /**
   * Flow version this run executed against. Pinned to the deep link
   * so opening a historical run renders the graph that ran, not the
   * latest definition.
   */
  flowVersion?: number;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  duration?: number;
}

export interface NodeExecutionSummary {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface Backend {
  describe(): BackendDescriptor;

  /** Cheap connectivity / readiness probe. */
  healthCheck(): Promise<{ ok: boolean }>;

  /** Action catalogue — same shape as `@flowlib/ui/flow-canvas` ActionMetadata. */
  listActions(): Promise<unknown[]>;

  listFlows(): Promise<FlowSummary[]>;
  getFlow(id: string): Promise<unknown>;
  createFlow(definition: unknown): Promise<PushFlowResult>;
  updateFlow(id: string, definition: unknown): Promise<PushFlowResult>;

  runFlow(id: string, inputs: Record<string, unknown>): Promise<RunStartResult>;
  runEphemeral(definition: unknown, inputs: Record<string, unknown>): Promise<RunStartResult>;

  /**
   * Recent runs for a flow, newest first. `flowId` semantics match
   * `getFlow(id)` — i.e. a file URI in embedded mode, a backend row id in
   * HTTP mode. Returns `[]` if the flow has no recorded runs (e.g. a
   * file that's never been run on this backend).
   */
  listRuns(flowId: string): Promise<RunSummary[]>;

  /** Per-node executions for a single run, in execution order. */
  listNodeExecutions(runId: string): Promise<NodeExecutionSummary[]>;

  /**
   * Iterate run events for `runId`. Resolves when the run terminates or the
   * caller aborts. Both implementations bridge to `onEvent` with the same
   * `{ event, data }` shape so consumers don't see the underlying transport.
   */
  streamRunEvents(runId: string, onEvent: SseHandler, signal?: AbortSignal): Promise<void>;

  /** Free any held resources (DB connection, in-flight streams, etc.). */
  shutdown(): Promise<void>;
}

/** Disconnected stub — every operation throws a friendly error. */
export class DisconnectedBackend implements Backend {
  describe(): BackendDescriptor {
    return { label: 'offline', kind: 'disconnected' };
  }
  async healthCheck(): Promise<{ ok: boolean }> {
    throw new Error(
      'No backend configured. Run "Invect: Connect to Backend…" or use the embedded backend.',
    );
  }
  async listActions(): Promise<unknown[]> {
    return [];
  }
  async listFlows(): Promise<FlowSummary[]> {
    throw this.unavailable();
  }
  async getFlow(): Promise<unknown> {
    throw this.unavailable();
  }
  async createFlow(): Promise<PushFlowResult> {
    throw this.unavailable();
  }
  async updateFlow(): Promise<PushFlowResult> {
    throw this.unavailable();
  }
  async runFlow(): Promise<RunStartResult> {
    throw this.unavailable();
  }
  async runEphemeral(): Promise<RunStartResult> {
    throw this.unavailable();
  }
  async listRuns(): Promise<RunSummary[]> {
    return [];
  }
  async listNodeExecutions(): Promise<NodeExecutionSummary[]> {
    return [];
  }
  async streamRunEvents(): Promise<void> {
    throw this.unavailable();
  }
  async shutdown(): Promise<void> {
    /* no-op */
  }
  private unavailable(): Error {
    return new Error(
      'No backend connected. The default embedded backend should have started — check the Invect output channel.',
    );
  }
}
