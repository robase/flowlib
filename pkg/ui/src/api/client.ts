// API client for communicating with the Flowlib backend

import type {
  Flow,
  FlowVersion,
  FlowRun,
  NodeExecution,
  CreateFlowRequest,
  CreateFlowVersionRequest,
  FlowValidationResult,
  PaginatedResponse,
  SubmitPromptRequest,
  QueryOptions,
  FlowlibDefinition,
  Model,
  ReactFlowData,
  AgentToolDefinition,
  NodeConfigUpdateResponse,
  DashboardStats,
  FlowRunResult,
  FlowInputs,
  ExecuteFlowOptions,
  UpdateFlowInput,
  NodeDefinition,
} from './types';

import {
  ValidationError,
  type ReactFlowDataOptions,
  type Credential,
  type CredentialFilters,
  type CreateCredentialInput,
  type UpdateCredentialInput,
  type CredentialUsage,
  type OAuth2ProviderDefinition,
  type OAuth2StartResult,
  type FlowTriggerRegistration,
  type CreateTriggerInput,
  type UpdateTriggerInput,
  type SettingsRecord,
  type SettingsDescriptorGroup,
  type SetSettingInput,
} from './types';

class ApiClient {
  private baseURL: string;
  private userId: string;

  constructor(baseURL: string, options?: { userId?: string }) {
    this.baseURL = baseURL;
    this.userId = options?.userId ?? 'user_123';
  }

  // Method to configure the base URL
  setBaseURL(baseURL: string): void {
    this.baseURL = baseURL;
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  private getUserHeaders(): Record<string, string> {
    return this.userId ? { 'X-User-ID': this.userId } : {};
  }

  /**
   * Raw fetch with standard credentials/headers. Returns the raw Response
   * for streaming endpoints (SSE, chat) that need access to response.body.
   */
  async rawRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;

    const { headers: optionsHeaders, ...restOptions } = options;
    const config: RequestInit = {
      ...restOptions,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(optionsHeaders as Record<string, string>),
      },
    };

    return fetch(url, config);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await this.rawRequest(endpoint, options);

    if (!response.ok) {
      // Try to extract error message from response body
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();

        const validationError = this.parseValidationError(errorData);
        if (validationError) {
          throw validationError;
        }

        // Handle other errors
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch (parseError) {
        // Re-throw validation errors
        if (parseError instanceof ValidationError) {
          throw parseError;
        }
        // If we can't parse the response body, use the default message
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content responses (e.g., DELETE operations)
    if (response.status === 204) {
      return undefined as T;
    }

    const result = await response.json();
    return result;
  }

  /**
   * Parse validation errors from various backend response formats into a
   * unified ValidationError. Returns null if the response is not a validation error.
   */
  private parseValidationError(errorData: Record<string, unknown>): ValidationError | null {
    const message =
      (errorData.message as string) ||
      ((errorData.response as Record<string, unknown> | undefined)?.message as string) ||
      'Flow validation failed';

    // Format 1: Zod-style { error: "Validation Error", details: [{ message, path }] }
    // Format 2: Express-style { error: "VALIDATION_ERROR", details: [{ message, field, value }] }
    if (
      (errorData.error === 'Validation Error' || errorData.error === 'VALIDATION_ERROR') &&
      Array.isArray(errorData.details)
    ) {
      const details = errorData.details as Array<{
        message: string;
        path?: string;
        field?: string;
        value?: unknown;
      }>;
      return new ValidationError(message, {
        isValid: false,
        errors: details.map((d) => ({
          type: 'VALIDATION_SYSTEM_ERROR' as const,
          message: d.message,
          severity: 'error' as const,
          field: d.field || d.path || '',
          value: d.value,
        })),
        warnings: [],
      });
    }

    // Format 3: Pre-built validation result at top level { validation: FlowValidationResult }
    if (errorData.validation && typeof errorData.validation === 'object') {
      return new ValidationError(message, errorData.validation as FlowValidationResult);
    }

    // Format 4: Nested in response property { response: { validation: FlowValidationResult } }
    const nested = errorData.response as Record<string, unknown> | undefined;
    if (nested?.validation && typeof nested.validation === 'object') {
      return new ValidationError(
        (nested.message as string) || message,
        nested.validation as FlowValidationResult,
      );
    }

    return null;
  }

  // Dashboard endpoints
  async getDashboardStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>('/dashboard/stats');
  }

  // Flow endpoints
  async getFlows(options?: QueryOptions<Flow>): Promise<PaginatedResponse<Flow>> {
    const response = await this.request<PaginatedResponse<Flow>>('/flows/list', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
    return response;
  }

  async getFlow(id: string): Promise<Flow> {
    const response = await this.request<Flow>(`/flows/${id}`);
    return response;
  }

  async createFlow(createFlowRequest: CreateFlowRequest): Promise<Flow> {
    const response = await this.request<Flow>('/flows', {
      method: 'POST',
      body: JSON.stringify(createFlowRequest),
    });
    return response;
  }

  async createFlowWithVersion(
    createFlowRequest: CreateFlowRequest,
    createVersionRequest: CreateFlowVersionRequest,
  ): Promise<Flow> {
    // First create the flow
    const flow = await this.createFlow(createFlowRequest);

    // Then create the initial version
    await this.createFlowVersion(flow.id, createVersionRequest);

    // Return the flow with the version data
    return this.getFlow(flow.id);
  }

  async updateFlow(id: string, updateData: UpdateFlowInput): Promise<Flow> {
    const flow = await this.request<Flow>(`/flows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
    return flow;
  }

  async deleteFlow(id: string): Promise<void> {
    return this.request<void>(`/flows/${id}`, {
      method: 'DELETE',
    });
  }

  // Flow version endpoints
  async createFlowVersion(
    flowId: string,
    createVersionRequest: CreateFlowVersionRequest,
  ): Promise<FlowVersion> {
    const endpoint = `/flows/${flowId}/versions`;

    const response = await this.request<FlowVersion>(endpoint, {
      method: 'POST',
      body: JSON.stringify(createVersionRequest),
    });

    return response;
  }

  async getFlowVersions(
    flowId: string,
    options?: QueryOptions<FlowVersion>,
  ): Promise<PaginatedResponse<FlowVersion>> {
    const response = await this.request<PaginatedResponse<FlowVersion>>(
      `/flows/${flowId}/versions/list`,
      {
        method: 'POST',
        body: JSON.stringify(options || {}),
      },
    );
    return response;
  }

  async validateFlow(
    flowId: string,
    flowDefinition: FlowlibDefinition,
  ): Promise<FlowValidationResult> {
    return this.request<FlowValidationResult>(`/validate-flow`, {
      method: 'POST',
      body: JSON.stringify({ flowId, flowDefinition }),
    });
  }

  // Flow run execution endpoints
  async executeFlow(
    flowId: string,
    inputs?: FlowInputs,
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult> {
    const response = await this.request<FlowRunResult>(`/flows/${flowId}/run`, {
      method: 'POST',
      body: JSON.stringify({ inputs, options }),
    });
    return response;
  }

  async getFlowRun(flowRunId: string): Promise<FlowRun> {
    const response = await this.request<FlowRun>(`/flow-runs/${flowRunId}`);
    return response;
  }

  async getFlowRunsByFlowId(flowId: string): Promise<PaginatedResponse<FlowRun>> {
    return this.request<PaginatedResponse<FlowRun>>(`/flows/${flowId}/flow-runs`);
  }

  async getAllFlowRuns(options?: QueryOptions<FlowRun>): Promise<PaginatedResponse<FlowRun>> {
    return this.request<PaginatedResponse<FlowRun>>('/flow-runs/list', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  // Flow run control endpoints
  async pauseFlowRun(
    flowRunId: string,
    reason?: string,
  ): Promise<{ message: string; timestamp: string }> {
    return this.request<{ message: string; timestamp: string }>(`/flow-runs/${flowRunId}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async resumeFlowRun(flowRunId: string): Promise<{ message: string; timestamp: string }> {
    return this.request<{ message: string; timestamp: string }>(`/flow-runs/${flowRunId}/resume`, {
      method: 'POST',
    });
  }

  async cancelFlowRun(flowRunId: string): Promise<{ message: string; timestamp: string }> {
    return this.request<{ message: string; timestamp: string }>(`/flow-runs/${flowRunId}/cancel`, {
      method: 'POST',
    });
  }

  // Node execution endpoints
  async getNodeExecutionsByFlowRun(flowRunId: string): Promise<NodeExecution[]> {
    const result = await this.request<PaginatedResponse<NodeExecution>>(
      `/flow-runs/${flowRunId}/node-executions?limit=100`,
    );
    return result.data;
  }

  async getAllNodeExecutions(
    options?: QueryOptions<NodeExecution>,
  ): Promise<PaginatedResponse<NodeExecution>> {
    return this.request<PaginatedResponse<NodeExecution>>('/node-executions/list', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  // React Flow endpoint
  async getFlowReactFlowData(
    flowId: string,
    options?: ReactFlowDataOptions,
  ): Promise<ReactFlowData> {
    const params = new URLSearchParams();

    if (options?.version) {
      params.set('version', options.version);
    }
    if (options?.flowRunId) {
      params.set('flowRunId', options.flowRunId);
    }

    const queryString = params.toString();
    const url = `/flows/${flowId}/react-flow${queryString ? `?${queryString}` : ''}`;

    return this.request<ReactFlowData>(url);
  }

  // JS expression test endpoint (for testing data mapper expressions)
  async testJsExpression(request: {
    expression: string;
    context: Record<string, unknown>;
  }): Promise<{ success: boolean; result?: unknown; error?: string }> {
    return this.request<{ success: boolean; result?: unknown; error?: string }>(
      '/node-data/test-expression',
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  // Data mapper test endpoint (for testing mapper expressions with mode semantics)
  async testMapper(request: {
    expression: string;
    incomingData: Record<string, unknown>;
    mode?: 'auto' | 'iterate' | 'reshape';
  }): Promise<{
    success: boolean;
    result?: unknown;
    resultType?: 'array' | 'object' | 'primitive';
    itemCount?: number;
    error?: string;
  }> {
    return this.request<{
      success: boolean;
      result?: unknown;
      resultType?: 'array' | 'object' | 'primitive';
      itemCount?: number;
      error?: string;
    }>('/node-data/test-mapper', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Model test endpoint (for testing model nodes)
  async testModelPrompt(request: SubmitPromptRequest): Promise<unknown> {
    return this.request<unknown>('/node-data/model-query', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Models endpoint
  async getModels(options?: {
    credentialId?: string;
    provider?: string;
  }): Promise<{ provider?: string; models: Model[]; defaultModel: string }> {
    const params = new URLSearchParams();
    if (options?.credentialId) {
      params.set('credentialId', options.credentialId);
    }
    if (options?.provider) {
      params.set('provider', options.provider);
    }

    const query = params.toString();
    const endpoint = `/node-data/models${query ? `?${query}` : ''}`;
    return this.request<{ provider?: string; models: Model[]; defaultModel: string }>(endpoint);
  }

  async getModelsForCredential(credentialId: string) {
    return this.getModels({ credentialId });
  }

  // Node definitions endpoint
  async getAvailableNodes(): Promise<NodeDefinition[]> {
    return this.request<NodeDefinition[]>('/nodes');
  }

  // Test/execute a single node in isolation
  async testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData: Record<string, unknown> = {},
  ): Promise<{ success: boolean; output?: Record<string, unknown>; error?: string }> {
    return this.request<{ success: boolean; output?: Record<string, unknown>; error?: string }>(
      '/nodes/test',
      {
        method: 'POST',
        body: JSON.stringify({ nodeType, params, inputData }),
      },
    );
  }

  /**
   * Execute a flow up to a specific target node.
   */
  async executeFlowToNode(
    flowId: string,
    nodeId: string,
    inputs: Record<string, unknown> = {},
    options?: { version?: number | 'latest'; useBatchProcessing?: boolean },
  ): Promise<FlowRunResult> {
    return this.request<FlowRunResult>(`/flows/${flowId}/run-to-node/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify({ inputs, options }),
    });
  }

  async resolveNodeDefinition(
    nodeType: string,
    options?: {
      nodeId?: string | null;
      flowId?: string | null;
      params?: Record<string, unknown>;
      changeField?: string;
      changeValue?: unknown;
    },
  ): Promise<NodeConfigUpdateResponse> {
    const searchParams = new URLSearchParams();

    if (options?.nodeId) {
      searchParams.set('nodeId', options.nodeId);
    }

    if (options?.flowId) {
      searchParams.set('flowId', options.flowId);
    }

    if (options?.changeField) {
      searchParams.set('changeField', options.changeField);
      if (options.changeValue !== undefined && options.changeValue !== null) {
        searchParams.set('changeValue', String(options.changeValue));
      }
    }

    if (options?.params && Object.keys(options.params).length > 0) {
      searchParams.set('params', JSON.stringify(options.params));
    }

    const query = searchParams.toString();
    const endpoint = `/node-definition/${encodeURIComponent(nodeType)}${query ? `?${query}` : ''}`;

    return this.request<NodeConfigUpdateResponse>(endpoint);
  }

  /**
   * Load dynamic options for a field that has `loadOptions` defined.
   */
  async loadFieldOptions(
    actionId: string,
    fieldName: string,
    dependencyValues: Record<string, unknown>,
  ): Promise<{
    options: { label: string; value: string | number }[];
    defaultValue?: string | number;
    placeholder?: string;
    disabled?: boolean;
  }> {
    const params = new URLSearchParams();
    params.set('deps', JSON.stringify(dependencyValues));
    return this.request(
      `/actions/${encodeURIComponent(actionId)}/fields/${encodeURIComponent(fieldName)}/options?${params.toString()}`,
    );
  }

  /**
   * Run a named action loader (powers `helper: { kind: 'async-picker' }`).
   * Returns the same shape as `loadFieldOptions`.
   */
  async runActionLoader(
    actionId: string,
    loaderName: string,
    dependencyValues: Record<string, unknown>,
    query?: string,
  ): Promise<{
    options: { label: string; value: string | number }[];
    defaultValue?: string | number;
    placeholder?: string;
    disabled?: boolean;
  }> {
    const params = new URLSearchParams();
    params.set('deps', JSON.stringify(dependencyValues));
    if (query !== undefined) {
      params.set('query', query);
    }
    return this.request(
      `/actions/${encodeURIComponent(actionId)}/loaders/${encodeURIComponent(loaderName)}?${params.toString()}`,
    );
  }

  // Credential endpoints
  async listCredentials(filters?: CredentialFilters): Promise<Credential[]> {
    const params = new URLSearchParams();
    if (filters?.type) {
      params.set('type', filters.type);
    }
    if (filters?.authType) {
      params.set('authType', filters.authType);
    }
    if (filters?.isActive !== undefined) {
      params.set('isActive', String(filters.isActive));
    }
    if (filters?.includeShared) {
      params.set('includeShared', 'true');
    }

    const query = params.toString();
    const endpoint = `/credentials${query ? `?${query}` : ''}`;
    return this.request<Credential[]>(endpoint, {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  async getCredential(id: string): Promise<Credential> {
    return this.request<Credential>(`/credentials/${id}`, {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    return this.request<Credential>('/credentials', {
      method: 'POST',
      headers: {
        ...this.getUserHeaders(),
      },
      body: JSON.stringify(input),
    });
  }

  async updateCredential(id: string, input: UpdateCredentialInput): Promise<Credential> {
    return this.request<Credential>(`/credentials/${id}`, {
      method: 'PUT',
      headers: {
        ...this.getUserHeaders(),
      },
      body: JSON.stringify(input),
    });
  }

  async deleteCredential(id: string): Promise<void> {
    await this.request<void>(`/credentials/${id}`, {
      method: 'DELETE',
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  async testCredential(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>(`/credentials/${id}/test`, {
      method: 'POST',
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  /**
   * Test a credential configuration by making an HTTP request through the backend
   */
  async testCredentialRequest(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; statusText: string; ok: boolean; body: unknown }> {
    return this.request<{ status: number; statusText: string; ok: boolean; body: unknown }>(
      '/credentials/test-request',
      {
        method: 'POST',
        headers: {
          ...this.getUserHeaders(),
        },
        body: JSON.stringify(params),
      },
    );
  }

  async getCredentialUsage(id: string): Promise<CredentialUsage> {
    return this.request<CredentialUsage>(`/credentials/${id}/usage`, {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  // =====================================
  // OAUTH2
  // =====================================

  async getOAuth2Providers(): Promise<OAuth2ProviderDefinition[]> {
    return this.request<OAuth2ProviderDefinition[]>('/credentials/oauth2/providers', {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  async getOAuth2Provider(providerId: string): Promise<OAuth2ProviderDefinition> {
    return this.request<OAuth2ProviderDefinition>(`/credentials/oauth2/providers/${providerId}`, {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  async startOAuth2Flow(params: {
    providerId?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    scopes?: string[];
    returnUrl?: string;
    credentialName?: string;
    existingCredentialId?: string;
  }): Promise<OAuth2StartResult> {
    return this.request<OAuth2StartResult>('/credentials/oauth2/start', {
      method: 'POST',
      headers: {
        ...this.getUserHeaders(),
      },
      body: JSON.stringify(params),
    });
  }

  async handleOAuth2Callback(params: {
    code: string;
    state: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }): Promise<Credential> {
    return this.request<Credential>('/credentials/oauth2/callback', {
      method: 'POST',
      headers: {
        ...this.getUserHeaders(),
      },
      body: JSON.stringify(params),
    });
  }

  async refreshOAuth2Credential(credentialId: string): Promise<Credential> {
    return this.request<Credential>(`/credentials/${credentialId}/refresh`, {
      method: 'POST',
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  // =====================================
  // AGENT TOOLS
  // =====================================

  async getAgentTools(): Promise<AgentToolDefinition[]> {
    return this.request<AgentToolDefinition[]>('/agent/tools', {
      headers: {
        ...this.getUserHeaders(),
      },
    });
  }

  // =====================================
  // TRIGGERS
  // =====================================

  async listTriggersForFlow(flowId: string): Promise<FlowTriggerRegistration[]> {
    return this.request<FlowTriggerRegistration[]>(`/flows/${flowId}/triggers`, {
      headers: { ...this.getUserHeaders() },
    });
  }

  async getTrigger(triggerId: string): Promise<FlowTriggerRegistration> {
    return this.request<FlowTriggerRegistration>(`/triggers/${triggerId}`, {
      headers: { ...this.getUserHeaders() },
    });
  }

  async createTrigger(flowId: string, input: CreateTriggerInput): Promise<FlowTriggerRegistration> {
    return this.request<FlowTriggerRegistration>(`/flows/${flowId}/triggers`, {
      method: 'POST',
      headers: { ...this.getUserHeaders() },
      body: JSON.stringify(input),
    });
  }

  async updateTrigger(
    triggerId: string,
    input: UpdateTriggerInput,
  ): Promise<FlowTriggerRegistration> {
    return this.request<FlowTriggerRegistration>(`/triggers/${triggerId}`, {
      method: 'PUT',
      headers: { ...this.getUserHeaders() },
      body: JSON.stringify(input),
    });
  }

  async deleteTrigger(triggerId: string): Promise<void> {
    await this.request<void>(`/triggers/${triggerId}`, {
      method: 'DELETE',
      headers: { ...this.getUserHeaders() },
    });
  }

  async syncTriggersForFlow(
    flowId: string,
    definition: { nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }> },
  ): Promise<FlowTriggerRegistration[]> {
    return this.request<FlowTriggerRegistration[]>(`/flows/${flowId}/triggers/sync`, {
      method: 'POST',
      headers: { ...this.getUserHeaders() },
      body: JSON.stringify({ definition }),
    });
  }

  // =====================================
  // CHAT ASSISTANT
  // =====================================

  async getChatStatus(): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>('/chat/status');
  }

  async getChatModels(
    credentialId: string,
    query?: string,
  ): Promise<Array<{ id: string; name?: string; provider?: string }>> {
    const params = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request<Array<{ id: string; name?: string; provider?: string }>>(
      `/chat/models/${credentialId}${params}`,
    );
  }

  async sendChatMessage(
    messages: Array<{ role: string; content: string; toolCalls?: unknown[]; toolCallId?: string }>,
    context: {
      flowId?: string;
      selectedNodeId?: string;
      selectedRunId?: string;
      viewMode?: string;
      credentialId?: string;
      maxSteps?: number;
      model?: string;
      memoryNotes?: {
        flowNotes?: string[];
        workspaceNotes?: string[];
      };
    },
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await this.rawRequest('/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, context }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Chat request failed: ${response.status}`);
    }

    return response;
  }

  /**
   * Reattach to an in-flight chat session. Replays buffered events and then
   * tails live events until generation completes. Returns 404 if the session
   * has been evicted (server restart, grace window expired).
   */
  async reattachChatStream(sessionId: string, signal?: AbortSignal): Promise<Response> {
    const response = await this.rawRequest(`/chat/stream/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Chat reattach failed: ${response.status}`);
    }

    return response;
  }

  // =====================================
  // CHAT MESSAGE PERSISTENCE
  // =====================================

  async getChatMessages(flowId: string): Promise<
    Array<{
      id: string;
      flowId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      toolMeta?: Record<string, unknown> | null;
      createdAt: string;
    }>
  > {
    const result = await this.request<{
      data: Array<{
        id: string;
        flowId: string;
        role: 'user' | 'assistant' | 'system' | 'tool';
        content: string;
        toolMeta?: Record<string, unknown> | null;
        createdAt: string;
      }>;
      pagination: { page: number; limit: number; totalPages: number };
    }>(`/chat/messages/${flowId}?limit=100`);
    return result.data;
  }

  async saveChatMessages(
    flowId: string,
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      toolMeta?: Record<string, unknown> | null;
    }>,
  ): Promise<void> {
    return this.request(`/chat/messages/${flowId}`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    });
  }

  async deleteChatMessages(flowId: string): Promise<void> {
    return this.request(`/chat/messages/${flowId}`, { method: 'DELETE' });
  }

  // =====================================
  // SETTINGS
  // =====================================

  async listSettings(namespace?: string): Promise<{ settings: SettingsRecord[] }> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.request<{ settings: SettingsRecord[] }>(`/settings${qs}`);
  }

  async getSetting(key: string): Promise<SettingsRecord | null> {
    try {
      return await this.request<SettingsRecord>(`/settings/${encodeURIComponent(key)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return null;
      }
      throw err;
    }
  }

  async setSetting(key: string, input: SetSettingInput): Promise<SettingsRecord> {
    return this.request<SettingsRecord>(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteSetting(key: string): Promise<{ removed: boolean }> {
    return this.request<{ removed: boolean }>(`/settings/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  async getSettingsDescriptors(): Promise<{ groups: SettingsDescriptorGroup[] }> {
    return this.request<{ groups: SettingsDescriptorGroup[] }>(`/settings/descriptors`);
  }
}

export { ApiClient };
