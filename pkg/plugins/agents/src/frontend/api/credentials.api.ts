/**
 * Credentials API client (agents-plugin scope).
 *
 * Backed by `GET /plugins/agents/credentials/llm` — returns the LLM
 * credentials the picker UI needs without requiring the frontend to
 * touch the generic `/credentials` endpoint.
 */

import type { AgentsApiClientOptions } from './client-options';

export interface AgentCredentialOption {
  id: string;
  name: string;
  description: string | null;
  /** Inferred OpenCode provider slug ('anthropic' | 'openai' | …). */
  provider: string;
  authType: string;
  isActive: boolean;
  isShared: boolean;
  expiresAt: string | null;
}

export class CredentialsApiClient {
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

  async listLlm(): Promise<AgentCredentialOption[]> {
    const res = await this.fetchImpl(this.url('/credentials/llm'), {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...this.headers },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Credentials API GET /credentials/llm failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as { data: AgentCredentialOption[] };
    return body.data ?? [];
  }
}

export function createCredentialsApiClient(options?: AgentsApiClientOptions): CredentialsApiClient {
  return new CredentialsApiClient(options);
}
