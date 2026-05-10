/**
 * MCP servers REST API client.
 *
 * MCP servers are configured at the org level — the chat settings drawer
 * lists them and toggles per-session opt-in via `enabledMcpServerIds` on
 * the session PATCH.
 */

import type { AgentMcpServer, McpTransport } from '../../shared/types';
import type { AgentsApiClientOptions } from './client-options';

export interface CreateMcpServerInput {
  name: string;
  description?: string | null;
  transport: McpTransport;
  config: Record<string, unknown>;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  transport?: McpTransport;
  config?: Record<string, unknown>;
}

export class McpServersApiClient {
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
        `MCP servers API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${text}`,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  list(): Promise<{ data: AgentMcpServer[] }> {
    return this.request<{ data: AgentMcpServer[] }>('/mcp-servers');
  }

  get(id: string): Promise<AgentMcpServer> {
    return this.request<AgentMcpServer>(`/mcp-servers/${encodeURIComponent(id)}`);
  }

  create(input: CreateMcpServerInput): Promise<AgentMcpServer> {
    return this.request<AgentMcpServer>('/mcp-servers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  update(id: string, input: UpdateMcpServerInput): Promise<AgentMcpServer> {
    return this.request<AgentMcpServer>(`/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  delete(id: string): Promise<void> {
    return this.request<void>(`/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
