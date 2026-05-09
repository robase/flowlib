/**
 * Agents REST API client.
 *
 * Thin `fetch` wrapper that targets the agents plugin's backend
 * endpoints. Endpoints are mounted by Stream I (backend endpoints) at
 * `/plugins/agents/...` under the consumer's configured `apiPath`.
 *
 * **Assumed contract** (Stream I has not landed at the time of writing
 * — the shapes below are derived from `shared/types.ts` and the
 * acceptance criteria in `plans/agents/implementation-plan.md` Stream
 * I):
 *
 * - `GET    /plugins/agents/agents`           → `AgentDefinition[]`
 * - `GET    /plugins/agents/agents/:id`       → `AgentDefinition`
 * - `POST   /plugins/agents/agents`           → `AgentDefinition`
 * - `PATCH  /plugins/agents/agents/:id`       → `AgentDefinition`
 * - `DELETE /plugins/agents/agents/:id`       → 204
 *
 * The client uses **relative URLs**, so it works whenever the consumer
 * mounts Flowlib's API at the same origin (the standard case). For
 * cross-origin deployments, pass an absolute `baseUrl` to
 * `createAgentsApiClient`.
 */

import type { AgentDefinition } from '../../shared/types';

export interface AgentsApiClientOptions {
  /**
   * Base URL where the consumer mounts Flowlib's API. For example,
   * `'/api/flowlib'` or `'https://app.example.com/flowlib'`.
   *
   * Defaults to `''` (same-origin, root-mounted).
   */
  baseUrl?: string;
  /**
   * Optional `fetch` impl override, primarily for tests.
   */
  fetchImpl?: typeof fetch;
  /**
   * Extra headers merged into every request (e.g., auth tokens).
   */
  headers?: Record<string, string>;
}

export interface CreateAgentInput {
  name: string;
  description?: string | null;
  providerId: string;
  providerConfig?: Record<string, unknown>;
  defaultModel?: string | null;
  workspaceId?: string | null;
  personaId?: string | null;
  personaText?: string | null;
  mcpServers?: Record<string, unknown>;
  enabledTools?: string[] | null;
  visibility?: 'private' | 'shared' | 'public';
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export class AgentsApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: AgentsApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    // Bind to globalThis so tests using vi.stubGlobal('fetch', …) get
    // their stub picked up at call time (not at construction time).
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.headers = options.headers ?? {};
  }

  private url(path: string): string {
    return `${this.baseUrl}/plugins/agents${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Agents API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  listAgents(): Promise<AgentDefinition[]> {
    return this.request<AgentDefinition[]>('/agents');
  }

  getAgent(id: string): Promise<AgentDefinition> {
    return this.request<AgentDefinition>(`/agents/${encodeURIComponent(id)}`);
  }

  createAgent(input: CreateAgentInput): Promise<AgentDefinition> {
    return this.request<AgentDefinition>('/agents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateAgent(id: string, input: UpdateAgentInput): Promise<AgentDefinition> {
    return this.request<AgentDefinition>(`/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  deleteAgent(id: string): Promise<void> {
    return this.request<void>(`/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

/** Convenience factory — mirrors `pkg/ui/src/api/` patterns. */
export function createAgentsApiClient(options?: AgentsApiClientOptions): AgentsApiClient {
  return new AgentsApiClient(options);
}
