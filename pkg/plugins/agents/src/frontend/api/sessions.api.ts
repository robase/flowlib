/**
 * Sessions REST API client.
 *
 * Same `fetch`-based pattern as `agents.api.ts`. Stream M owns the
 * chat-streaming surface (WebSocket via `useAgent` from
 * `@cloudflare/ai-chat`); this client only handles the CRUD/list views
 * needed by the AgentDetailPage.
 *
 * **Assumed contract** (Stream I, not yet landed):
 *
 * - `GET    /plugins/agents/agents/:agentId/sessions` → `AgentSession[]`
 * - `GET    /plugins/agents/sessions/:id`             → `AgentSession`
 * - `POST   /plugins/agents/sessions`                 → `AgentSession`
 * - `PATCH  /plugins/agents/sessions/:id`             → `AgentSession`
 * - `DELETE /plugins/agents/sessions/:id`             → 204
 *
 * Per Stream I acceptance: `GET /sessions/:id` and `POST /sessions`
 * include the tenant-scoped `doAgentName` field. The frontend passes
 * that string straight into `useAgent({ agent: 'AgentChatDO', name })`
 * (Stream M).
 */

import type {
  AgentProviderId,
  AgentSession,
  AgentSessionStatus,
  ToolOutputBudget,
} from '../../shared/types';
import type { AgentsApiClientOptions } from './client-options';

export interface CreateSessionInput {
  title?: string;
  providerId?: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  model?: string | null;
  permissionMode?: string | null;
  systemPrompt?: string | null;
  workspaceId?: string | null;
  enabledMcpServerIds?: string[];
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
  visibility?: 'private' | 'shared' | 'public';
}

export interface UpdateSessionInput {
  title?: string;
  providerId?: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  model?: string | null;
  permissionMode?: string | null;
  systemPrompt?: string | null;
  workspaceId?: string | null;
  enabledMcpServerIds?: string[];
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
  status?: AgentSessionStatus;
  visibility?: 'private' | 'shared' | 'public';
}

export class SessionsApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: AgentsApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
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
        `Sessions API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** List all sessions for the active org. */
  listSessions(): Promise<{ data: AgentSession[] }> {
    return this.request<{ data: AgentSession[] }>('/sessions');
  }

  getSession(sessionId: string): Promise<AgentSession> {
    return this.request<AgentSession>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  createSession(input: CreateSessionInput): Promise<AgentSession> {
    return this.request<AgentSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateSession(sessionId: string, input: UpdateSessionInput): Promise<AgentSession> {
    return this.request<AgentSession>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.request<void>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }
}

export function createSessionsApiClient(options?: AgentsApiClientOptions): SessionsApiClient {
  return new SessionsApiClient(options);
}
