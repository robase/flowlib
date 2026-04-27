/**
 * Thin HTTP client over `@flowlib/core`'s REST surface.
 *
 * Methods cover the endpoints the extension actually uses — actions
 * catalogue, flows CRUD, runs (push-then-run path + ephemeral), SSE event
 * stream. Auth is bearer-token from `SecretStorage`. URL is per-folder
 * config.
 *
 * Errors:
 *   - Non-2xx responses throw `BackendHttpError` with status + body excerpt.
 *   - Invalid URL throws `BackendConfigError` before fetching.
 *   - Network errors propagate the underlying `TypeError` from `fetch`.
 *
 * The status bar / commands wrap calls and translate failures into
 * user-visible notifications; this layer just throws.
 */

import { isValidBackendUrl } from '../util/config';
import {
  type Backend,
  type BackendDescriptor,
  type FlowSummary,
  type NodeExecutionSummary,
  type PushFlowResult,
  type RunStartResult,
  type RunSummary,
} from './Backend';
import { consumeRunEventStream, type SseHandler } from './sse';

export class BackendHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly bodyExcerpt: string,
    public readonly url: string,
  ) {
    super(`${status} ${statusText} on ${url}`);
    this.name = 'BackendHttpError';
  }
}

export class BackendConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendConfigError';
  }
}

export interface BackendClientOptions {
  url: string;
  apiKey?: string;
  /** Custom fetch impl — used by tests. */
  fetchImpl?: typeof fetch;
}

// FlowSummary, PushFlowResult, RunStartResult moved to ./Backend.ts so the
// HTTP and embedded implementations share the same shapes.

/**
 * `BackendClient` (alias `HttpBackend`) — REST implementation of the
 * `Backend` interface used for both local-spawned (Docker, `pnpm dev`)
 * and remote backends. Same client; only the URL differs.
 */
export class BackendClient implements Backend {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BackendClientOptions) {
    const validation = isValidBackendUrl(opts.url);
    if (!validation.ok) {
      throw new BackendConfigError(`Invalid backend URL: ${validation.reason}`);
    }
    this.url = opts.url.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ── Generic helpers ────────────────────────────────────────────────────────

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...extra,
    };
    if (this.apiKey) {
      h.authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const u = `${this.url}${path}`;
    const res = await this.fetchImpl(u, { method: 'GET', headers: this.headers() });
    return this.json<T>(res, u);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const u = `${this.url}${path}`;
    const res = await this.fetchImpl(u, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body ?? {}),
    });
    return this.json<T>(res, u);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const u = `${this.url}${path}`;
    const res = await this.fetchImpl(u, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body ?? {}),
    });
    return this.json<T>(res, u);
  }

  private async json<T>(res: Response, url: string): Promise<T> {
    if (!res.ok) {
      const text = await safeReadBody(res);
      throw new BackendHttpError(res.status, res.statusText, text.slice(0, 500), url);
    }
    if (res.status === 204) {
      return undefined as unknown as T;
    }
    return (await res.json()) as T;
  }

  // ── Backend interface ──────────────────────────────────────────────────────

  describe(): BackendDescriptor {
    return { label: this.url, kind: 'http', detail: this.url };
  }

  async shutdown(): Promise<void> {
    /* No persistent connections; nothing to release. */
  }

  // ── High-level methods the extension uses ──────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean }> {
    // No dedicated /health endpoint — `/actions` is cheap, authenticated, and
    // exercises auth + connectivity in one shot.
    await this.get('/actions');
    return { ok: true };
  }

  async listActions(): Promise<unknown[]> {
    const items = await this.get<unknown>('/actions');
    return Array.isArray(items) ? items : [];
  }

  async listFlows(): Promise<FlowSummary[]> {
    const items = await this.get<unknown>('/flows');
    return Array.isArray(items) ? (items as FlowSummary[]) : [];
  }

  async getFlow(id: string): Promise<unknown> {
    return this.get(`/flows/${encodeURIComponent(id)}`);
  }

  async createFlow(definition: unknown): Promise<PushFlowResult> {
    return this.post<PushFlowResult>('/flows', definition);
  }

  async updateFlow(id: string, definition: unknown): Promise<PushFlowResult> {
    return this.put<PushFlowResult>(`/flows/${encodeURIComponent(id)}`, definition);
  }

  async runFlow(id: string, inputs: Record<string, unknown>): Promise<RunStartResult> {
    return this.post<RunStartResult>(`/flows/${encodeURIComponent(id)}/run`, { inputs });
  }

  async runEphemeral(
    definition: unknown,
    inputs: Record<string, unknown>,
  ): Promise<RunStartResult> {
    return this.post<RunStartResult>('/runs/ephemeral', { definition, inputs });
  }

  async listRuns(flowId: string): Promise<RunSummary[]> {
    // Express route: GET /flows/:flowId/flow-runs returns
    // `{ data: FlowRun[], pagination: {...} }`. Be permissive in case
    // older backends return a bare array.
    const raw = await this.get<unknown>(
      `/flows/${encodeURIComponent(flowId)}/flow-runs?limit=50&sortBy=startedAt&sortOrder=desc`,
    );
    const items = Array.isArray(raw)
      ? raw
      : ((raw as { data?: unknown[]; items?: unknown[] }).data ??
        (raw as { items?: unknown[] }).items ??
        []);
    return (items as Record<string, unknown>[]).map(toRunSummary);
  }

  async listNodeExecutions(runId: string): Promise<NodeExecutionSummary[]> {
    // Express route: GET /flow-runs/:flowRunId/node-executions
    const raw = await this.get<unknown>(`/flow-runs/${encodeURIComponent(runId)}/node-executions`);
    const items = Array.isArray(raw)
      ? raw
      : ((raw as { data?: unknown[]; items?: unknown[] }).data ??
        (raw as { items?: unknown[] }).items ??
        []);
    return (items as Record<string, unknown>[]).map(toNodeExecutionSummary);
  }

  /**
   * Open the SSE stream for a run. Calls `onEvent` for each parsed event.
   * Returns a promise that resolves when the stream ends or rejects on
   * transport error. The optional `signal` aborts the fetch cleanly.
   */
  async streamRunEvents(runId: string, onEvent: SseHandler, signal?: AbortSignal): Promise<void> {
    const u = `${this.url}/runs/${encodeURIComponent(runId)}/events`;
    const res = await this.fetchImpl(u, {
      method: 'GET',
      headers: this.headers({ accept: 'text/event-stream' }),
      signal,
    });
    if (!res.ok) {
      const text = await safeReadBody(res);
      throw new BackendHttpError(res.status, res.statusText, text.slice(0, 500), u);
    }
    await consumeRunEventStream(res, onEvent, signal);
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function toRunSummary(r: Record<string, unknown>): RunSummary {
  return {
    id: String(r.id ?? ''),
    flowId: String(r.flowId ?? ''),
    flowVersion: typeof r.flowVersion === 'number' ? r.flowVersion : undefined,
    status: String(r.status ?? 'UNKNOWN'),
    startedAt: String(r.startedAt ?? ''),
    completedAt: r.completedAt ? String(r.completedAt) : undefined,
    error: typeof r.error === 'string' ? r.error : undefined,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
  };
}

function toNodeExecutionSummary(n: Record<string, unknown>): NodeExecutionSummary {
  return {
    id: String(n.id ?? ''),
    nodeId: String(n.nodeId ?? ''),
    nodeType: String(n.nodeType ?? ''),
    status: String(n.status ?? 'UNKNOWN'),
    startedAt: n.startedAt ? String(n.startedAt) : undefined,
    completedAt: n.completedAt ? String(n.completedAt) : undefined,
    error: typeof n.error === 'string' ? n.error : undefined,
  };
}
