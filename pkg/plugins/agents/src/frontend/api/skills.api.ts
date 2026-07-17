/**
 * Skills REST API client (agents-plugin scope).
 *
 * Backed by `/plugins/agents/skills` (full CRUD). The inspector's Skills
 * panel lists authored skills and shows their Markdown body; the agent's
 * system prompt consumes them via progressive disclosure.
 */

import type { AgentSkill, SkillScope } from '../../shared/types';
import type { AgentsApiClientOptions } from './client-options';

export interface CreateSkillInput {
  name: string;
  description: string;
  body: string;
  scope?: SkillScope;
  tags?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  body?: string;
  scope?: SkillScope;
  tags?: string[];
}

export class SkillsApiClient {
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
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Skills API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${text}`,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  list(): Promise<{ data: AgentSkill[] }> {
    return this.request<{ data: AgentSkill[] }>('/skills');
  }

  get(id: string): Promise<AgentSkill> {
    return this.request<AgentSkill>(`/skills/${encodeURIComponent(id)}`);
  }

  create(input: CreateSkillInput): Promise<AgentSkill> {
    return this.request<AgentSkill>('/skills', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  update(id: string, input: UpdateSkillInput): Promise<AgentSkill> {
    return this.request<AgentSkill>(`/skills/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  delete(id: string): Promise<void> {
    return this.request<void>(`/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
