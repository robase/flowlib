/**
 * Workspaces REST API client.
 *
 * Workspaces back agents — the AgentFormPage uses this to populate the
 * "workspace" step picker.
 *
 * **Assumed contract** (Stream I, not yet landed):
 *
 * - `GET    /plugins/agents/workspaces`        → `AgentWorkspace[]`
 * - `GET    /plugins/agents/workspaces/:id`    → `AgentWorkspace`
 * - `POST   /plugins/agents/workspaces`        → `AgentWorkspace`
 * - `DELETE /plugins/agents/workspaces/:id`    → 204
 */

import type { AgentWorkspace, WorkspaceProviderId } from '../../shared/types';
import type { AgentsApiClientOptions } from './agents.api';

export interface CreateWorkspaceInput {
  name: string;
  workspaceProviderId: WorkspaceProviderId;
  rootPath?: string | null;
  gitRemote?: string | null;
  gitBranch?: string | null;
  sandboxConfig?: Record<string, unknown> | null;
  projectId?: string | null;
  visibility?: 'private' | 'shared' | 'public';
}

export class WorkspacesApiClient {
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
        `Workspaces API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  listWorkspaces(): Promise<AgentWorkspace[]> {
    return this.request<AgentWorkspace[]>('/workspaces');
  }

  getWorkspace(id: string): Promise<AgentWorkspace> {
    return this.request<AgentWorkspace>(`/workspaces/${encodeURIComponent(id)}`);
  }

  createWorkspace(input: CreateWorkspaceInput): Promise<AgentWorkspace> {
    return this.request<AgentWorkspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  deleteWorkspace(id: string): Promise<void> {
    return this.request<void>(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

export function createWorkspacesApiClient(
  options?: AgentsApiClientOptions,
): WorkspacesApiClient {
  return new WorkspacesApiClient(options);
}
