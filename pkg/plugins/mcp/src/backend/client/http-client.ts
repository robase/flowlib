/**
 * HttpClient — wraps Invect HTTP API for CLI/stdio mode.
 */

import { emitSdkSource, SdkEmitError } from '@flowlib/sdk';
import type {
  InvectClient,
  CredentialSummary,
  FlowSdkSourceResult,
  GetFlowSdkSourceOptions,
} from './types';

export class HttpClient implements InvectClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${text}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  /** Health check — throws if API is unreachable */
  async healthCheck(): Promise<void> {
    await this.request('GET', '/health');
  }

  // ===== Flows =====

  async listFlows() {
    return await this.request('GET', '/flows/list');
  }

  async getFlow(flowId: string) {
    return await this.request('GET', `/flows/${encodeURIComponent(flowId)}`);
  }

  async getFlowDefinition(flowId: string) {
    try {
      return await this.request('GET', `/flows/${encodeURIComponent(flowId)}/versions/latest`);
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  async getFlowSdkSource(
    flowId: string,
    options: GetFlowSdkSourceOptions = {},
  ): Promise<FlowSdkSourceResult> {
    const requested = options.version ?? 'latest';
    const version = (await this.request(
      'GET',
      `/flows/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(String(requested))}`,
    )) as { invectDefinition?: unknown; version: string | number };
    if (!version?.invectDefinition) {
      throw new Error(`Version "${requested}" of flow ${flowId} has no invectDefinition`);
    }
    try {
      const result = emitSdkSource(
        version.invectDefinition as Parameters<typeof emitSdkSource>[0],
        {
          flowName: options.flowName,
          sdkImport: options.sdkImport,
        },
      );
      return {
        code: result.code,
        importedBuilders: result.sdkImports,
        flowName: options.flowName ?? 'myFlow',
        version: version.version,
      };
    } catch (err) {
      if (err instanceof SdkEmitError) {
        throw new Error(
          err.nodeId
            ? `Cannot emit SDK source (node ${err.nodeId}): ${err.message}`
            : `Cannot emit SDK source: ${err.message}`,
        );
      }
      throw err;
    }
  }

  async createFlow(data: { name: string; description?: string }) {
    return await this.request('POST', '/flows', data);
  }

  async updateFlow(flowId: string, data: { name?: string; description?: string }) {
    return await this.request('PUT', `/flows/${encodeURIComponent(flowId)}`, data);
  }

  async deleteFlow(flowId: string) {
    await this.request('DELETE', `/flows/${encodeURIComponent(flowId)}`);
  }

  async validateFlow(flowId: string, definition: unknown) {
    try {
      const raw = await this.request<{
        valid?: boolean;
        isValid?: boolean;
        errors?: Array<string | { message?: string }>;
      }>('POST', '/validate-flow', { flowId, flowDefinition: definition });
      const valid = raw.valid ?? raw.isValid ?? false;
      if (valid) {
        return { valid: true };
      }
      const errors = (raw.errors ?? []).map((e) => (typeof e === 'string' ? e : (e.message ?? '')));
      return { valid: false, errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, errors: [message] };
    }
  }

  // ===== Versions =====

  async listVersions(flowId: string) {
    return await this.request('POST', `/flows/${encodeURIComponent(flowId)}/versions/list`, {});
  }

  async getVersion(flowId: string, version: string | number | 'latest') {
    return await this.request(
      'GET',
      `/flows/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(String(version))}`,
    );
  }

  async publishVersion(flowId: string, data: unknown) {
    return await this.request('POST', `/flows/${encodeURIComponent(flowId)}/versions`, data);
  }

  // ===== Runs =====

  async startRun(flowId: string, inputs?: Record<string, unknown>) {
    const started = (await this.request(
      'POST',
      `/flows/${encodeURIComponent(flowId)}/run`,
      inputs ? { inputs } : {},
    )) as { flowRunId?: string; id?: string; status?: string };
    const flowRunId = started.flowRunId ?? started.id;
    if (!flowRunId) {
      return started;
    }
    return await this.pollRun(flowRunId);
  }

  async startRunAsync(flowId: string, inputs?: Record<string, unknown>) {
    return await this.request(
      'POST',
      `/flows/${encodeURIComponent(flowId)}/run`,
      inputs ? { inputs } : {},
    );
  }

  private async pollRun(flowRunId: string): Promise<unknown> {
    const terminal = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);
    const deadline = Date.now() + 10 * 60_000;
    let delay = 500;
    while (Date.now() < deadline) {
      const run = (await this.getRun(flowRunId)) as { status?: string };
      if (run.status && terminal.has(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 5000);
    }
    throw new Error(`Timed out waiting for flow run ${flowRunId} to complete`);
  }

  async runToNode(flowId: string, nodeId: string, inputs?: Record<string, unknown>) {
    return await this.request(
      'POST',
      `/flows/${encodeURIComponent(flowId)}/run-to-node/${encodeURIComponent(nodeId)}`,
      inputs ? { inputs } : {},
    );
  }

  async listRuns(flowId: string) {
    return await this.request('GET', `/flows/${encodeURIComponent(flowId)}/flow-runs`);
  }

  async getRun(flowRunId: string) {
    return await this.request('GET', `/flow-runs/${encodeURIComponent(flowRunId)}`);
  }

  async cancelRun(flowRunId: string) {
    return await this.request<{ message: string }>(
      'POST',
      `/flow-runs/${encodeURIComponent(flowRunId)}/cancel`,
    );
  }

  async pauseRun(flowRunId: string) {
    return await this.request<{ message: string }>(
      'POST',
      `/flow-runs/${encodeURIComponent(flowRunId)}/pause`,
    );
  }

  async resumeRun(flowRunId: string) {
    return await this.request<{ message: string }>(
      'POST',
      `/flow-runs/${encodeURIComponent(flowRunId)}/resume`,
    );
  }

  // ===== Debug =====

  async getNodeExecutions(flowRunId: string) {
    const result = await this.request<{ data: unknown[]; pagination: unknown }>(
      'GET',
      `/flow-runs/${encodeURIComponent(flowRunId)}/node-executions?limit=100`,
    );
    return result.data;
  }

  async listNodeExecutions() {
    const result = await this.request<{ data: unknown[] } | unknown[]>(
      'POST',
      '/node-executions/list',
      { pagination: { page: 1, limit: 100 } },
    );
    return Array.isArray(result) ? result : (result.data ?? []);
  }

  async getToolExecutions(nodeExecutionId: string) {
    return await this.request<unknown[]>(
      'GET',
      `/node-executions/${encodeURIComponent(nodeExecutionId)}/tool-executions`,
    );
  }

  async testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData?: Record<string, unknown>,
  ) {
    return await this.request<{ success: boolean; output?: unknown; error?: string }>(
      'POST',
      '/nodes/test',
      { nodeType, params, inputData },
    );
  }

  async testJsExpression(expression: string, context: Record<string, unknown>) {
    return await this.request<{ success: boolean; result?: unknown; error?: string }>(
      'POST',
      '/node-data/test-expression',
      { expression, context },
    );
  }

  async testMapper(expression: string, incomingData: Record<string, unknown>) {
    return await this.request<{ success: boolean; result?: unknown; error?: string }>(
      'POST',
      '/node-data/test-mapper',
      { expression, incomingData },
    );
  }

  // ===== Credentials =====

  async listCredentials(): Promise<CredentialSummary[]> {
    const result = await this.request<{ data?: unknown[] } | unknown[]>('GET', '/credentials');
    const items = Array.isArray(result) ? result : (result.data ?? []);
    return (items as Array<Record<string, unknown>>).map((c) => this.mapCredential(c));
  }

  async testCredential(credentialId: string) {
    return await this.request<{ success: boolean; error?: string }>(
      'POST',
      `/credentials/${encodeURIComponent(credentialId)}/test`,
    );
  }

  async listOAuth2Providers() {
    return await this.request<unknown[]>('GET', '/credentials/oauth2/providers');
  }

  private mapCredential(c: Record<string, unknown>): CredentialSummary {
    const metadata = (c.metadata ?? undefined) as Record<string, unknown> | undefined;
    const providerFromTop = typeof c.provider === 'string' ? c.provider : undefined;
    const providerFromMeta = typeof metadata?.provider === 'string' ? metadata.provider : undefined;
    return {
      id: String(c.id),
      name: String(c.name),
      type: String(c.type),
      provider: providerFromTop ?? providerFromMeta,
      lastUsedAt: c.lastUsedAt ? String(c.lastUsedAt) : undefined,
      createdAt: c.createdAt ? String(c.createdAt) : undefined,
      expiresAt: c.expiresAt ? String(c.expiresAt) : undefined,
    };
  }

  // ===== Triggers =====

  async listTriggers(flowId: string) {
    return await this.request<unknown[]>('GET', `/flows/${encodeURIComponent(flowId)}/triggers`);
  }

  async getTrigger(triggerId: string) {
    return await this.request('GET', `/triggers/${encodeURIComponent(triggerId)}`);
  }

  async createTrigger(input: unknown) {
    const data = input as Record<string, unknown>;
    const flowId = data.flowId as string;
    return await this.request('POST', `/flows/${encodeURIComponent(flowId)}/triggers`, data);
  }

  async updateTrigger(triggerId: string, input: unknown) {
    return await this.request('PUT', `/triggers/${encodeURIComponent(triggerId)}`, input);
  }

  async deleteTrigger(triggerId: string) {
    await this.request('DELETE', `/triggers/${encodeURIComponent(triggerId)}`);
  }

  async syncTriggers(flowId: string, definition: unknown) {
    return await this.request<unknown[]>(
      'POST',
      `/flows/${encodeURIComponent(flowId)}/triggers/sync`,
      { definition },
    );
  }

  async executeCronTrigger(triggerId: string) {
    return await this.request('POST', `/triggers/${encodeURIComponent(triggerId)}/execute-cron`);
  }

  async listEnabledCronTriggers() {
    return await this.request<unknown[]>('GET', '/triggers/enabled-cron');
  }

  // ===== Node Reference =====

  async listProviders() {
    const nodes = await this.request<unknown[]>('GET', '/nodes');
    const providerSet = new Map<string, Record<string, unknown>>();
    for (const node of nodes as Array<Record<string, unknown>>) {
      const p = node.provider as Record<string, unknown> | undefined;
      if (p && typeof p.id === 'string' && !providerSet.has(p.id)) {
        providerSet.set(p.id, p);
      }
    }
    return Array.from(providerSet.values());
  }

  async listAvailableNodes() {
    return await this.request<unknown[]>('GET', '/nodes');
  }

  async listNodesForProvider(providerId: string) {
    const nodes = (await this.request<unknown[]>('GET', '/nodes')) as Array<
      Record<string, unknown>
    >;
    return nodes.filter((n) => {
      const p = n.provider as Record<string, unknown> | undefined;
      return p?.id === providerId;
    });
  }

  async resolveFieldOptions(actionId: string, fieldName: string, deps: Record<string, unknown>) {
    const qs = `?deps=${encodeURIComponent(JSON.stringify(deps))}`;
    return await this.request(
      'GET',
      `/actions/${encodeURIComponent(actionId)}/fields/${encodeURIComponent(fieldName)}/options${qs}`,
    );
  }

  // ===== Agent =====

  async listAgentTools() {
    return await this.request<unknown[]>('GET', '/agent/tools');
  }
}
