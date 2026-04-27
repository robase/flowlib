/**
 * InMemoryApiClient — an `ApiClient` replacement backed by props.
 *
 * The flow editor's existing hooks all read through `useApiClient()` →
 * `ApiClient` → `fetch(baseURL + path)`. For the headless `<FlowCanvas>`
 * there is no backend, so we subclass `ApiClient` and override the
 * handful of methods the editor actually invokes. Methods we don't
 * override fall through to `fetch(...)`, which will fail loudly in
 * development but never fire during normal canvas operation.
 *
 * The class is mutable so the FlowCanvas provider can re-seed it when
 * props change (flow / actions / nodeRunStatus) without discarding the
 * React Query cache.
 *
 * Method signatures here must match the parent `ApiClient` exactly so
 * TypeScript's structural compat check passes. Unused parameters are
 * prefixed with `_` to silence noUnusedParameters.
 */

import type {
  AgentToolDefinition,
  DashboardStats,
  Flow,
  FlowInputs,
  FlowRun,
  FlowRunResult,
  FlowVersion,
  FlowValidationResult,
  InvectDefinition,
  Model,
  NodeExecution,
  PaginatedResponse,
  ReactFlowData,
} from '@flowlib/core/types';
import { ApiClient } from '../api/client';
import type {
  Credential,
  CredentialFilters,
  CredentialUsage,
  CreateCredentialInput,
  UpdateCredentialInput,
  CreateTriggerInput,
  UpdateTriggerInput,
  FlowTriggerRegistration,
  NodeConfigUpdateResponse,
  NodeDefinition,
  OAuth2ProviderDefinition,
  OAuth2StartResult,
  ReactFlowDataOptions,
} from '../api/types';
import { invectDefinitionToReactFlowData } from './flow-adapter';
import type { ActionMetadata, NodeRunStatus } from './types';

export interface InMemoryState {
  flowId: string;
  flow: InvectDefinition;
  actions: ActionMetadata[];
  credentials: Credential[];
  agentTools: AgentToolDefinition[];
  nodeRunStatus?: Record<string, NodeRunStatus>;
  chatEnabled: boolean;
  /** Recent runs for `flowId`, newest first. Drives `useFlowRuns`. */
  runs?: FlowRun[];
  /**
   * Per-run node-execution lookup. Drives `useNodeExecutions(runId)` and
   * also feeds `getFlowReactFlowData` when a `flowRunId` option is passed.
   */
  nodeExecutionsByRun?: Record<string, NodeExecution[]>;
}

export interface InMemoryCallbacks {
  onEdit?: (flow: InvectDefinition) => void;
  onRequestRun?: (inputs: Record<string, unknown>) => void;
  onOpenCredentialManager?: () => void;
}

function emptyPage<T>(): PaginatedResponse<T> {
  return {
    data: [],
    pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
  } as unknown as PaginatedResponse<T>;
}

function notSupported(method: string): Error {
  return new Error(
    `InMemoryApiClient: "${method}" is not supported — this operation requires a connected backend.`,
  );
}

/**
 * Map a backend node-execution status string (PENDING / RUNNING / SUCCESS /
 * FAILED / CANCELLED / SKIPPED) to the canvas's `NodeRunStatus` union.
 * Returns undefined for unknown values so the caller can skip them.
 */
function mapNodeStatus(status: unknown): NodeRunStatus | undefined {
  if (typeof status !== 'string') {
    return undefined;
  }
  switch (status.toUpperCase()) {
    case 'PENDING':
      return 'pending';
    case 'RUNNING':
      return 'running';
    case 'SUCCESS':
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
    case 'ERROR':
      return 'failed';
    case 'SKIPPED':
    case 'CANCELLED':
      return 'skipped';
    default:
      return undefined;
  }
}

export class InMemoryApiClient extends ApiClient {
  private state: InMemoryState;
  private callbacks: InMemoryCallbacks;

  constructor(state: InMemoryState, callbacks: InMemoryCallbacks = {}) {
    super('http://flow-canvas.invalid');
    this.state = state;
    this.callbacks = callbacks;
  }

  setState(state: InMemoryState): void {
    this.state = state;
  }

  setCallbacks(callbacks: InMemoryCallbacks): void {
    this.callbacks = callbacks;
  }

  getState(): InMemoryState {
    return this.state;
  }

  // ─── Flows ──────────────────────────────────────────────────────────
  override async getDashboardStats(): Promise<DashboardStats> {
    return {
      totalFlows: 1,
      activeFlows: 0,
      totalRuns: 0,
      successRate: 0,
      recentFlows: [],
    } as unknown as DashboardStats;
  }

  override async getFlows(): Promise<PaginatedResponse<Flow>> {
    return emptyPage<Flow>();
  }

  override async getFlow(_id: string): Promise<Flow> {
    return {
      id: this.state.flowId,
      name: '',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false,
    } as unknown as Flow;
  }

  override async createFlow(): Promise<Flow> {
    throw notSupported('createFlow');
  }

  override async createFlowWithVersion(): Promise<Flow> {
    throw notSupported('createFlowWithVersion');
  }

  override async updateFlow(_id: string, _data: unknown): Promise<Flow> {
    return this.getFlow(_id);
  }

  override async deleteFlow(): Promise<void> {
    throw notSupported('deleteFlow');
  }

  override async createFlowVersion(
    flowId: string,
    data: { invectDefinition: InvectDefinition },
  ): Promise<FlowVersion> {
    this.state.flow = data.invectDefinition;
    this.callbacks.onEdit?.(data.invectDefinition);
    return {
      flowId,
      version: 1,
      invectDefinition: data.invectDefinition,
      createdAt: new Date().toISOString(),
      createdBy: null,
    } as unknown as FlowVersion;
  }

  override async getFlowVersions(): Promise<PaginatedResponse<FlowVersion>> {
    return emptyPage<FlowVersion>();
  }

  override async validateFlow(): Promise<FlowValidationResult> {
    return { isValid: true, errors: [], warnings: [] } as unknown as FlowValidationResult;
  }

  override async executeFlow(
    _flowId: string,
    inputs: FlowInputs,
    _options?: unknown,
  ): Promise<FlowRunResult> {
    this.callbacks.onRequestRun?.(inputs as Record<string, unknown>);
    return {
      flowRunId: 'flow-canvas-synthetic-run',
      status: 'pending',
    } as unknown as FlowRunResult;
  }

  override async getFlowRun(id: string): Promise<FlowRun> {
    const runs = this.state.runs ?? [];
    const found = runs.find((r) => r.id === id);
    if (!found) {
      throw new Error(`Run ${id} not found`);
    }
    return found;
  }

  override async getFlowRunsByFlowId(): Promise<PaginatedResponse<FlowRun>> {
    const runs = this.state.runs ?? [];
    return {
      data: runs,
      pagination: { limit: runs.length, offset: 0, total: runs.length, hasMore: false },
    } as unknown as PaginatedResponse<FlowRun>;
  }

  override async getAllFlowRuns(): Promise<PaginatedResponse<FlowRun>> {
    return emptyPage<FlowRun>();
  }

  override async pauseFlowRun(): Promise<{ message: string; timestamp: string }> {
    throw notSupported('pauseFlowRun');
  }

  override async resumeFlowRun(): Promise<{ message: string; timestamp: string }> {
    throw notSupported('resumeFlowRun');
  }

  override async cancelFlowRun(): Promise<{ message: string; timestamp: string }> {
    throw notSupported('cancelFlowRun');
  }

  override async getNodeExecutionsByFlowRun(runId: string): Promise<NodeExecution[]> {
    return this.state.nodeExecutionsByRun?.[runId] ?? [];
  }

  override async getAllNodeExecutions(): Promise<PaginatedResponse<NodeExecution>> {
    return emptyPage<NodeExecution>();
  }

  // ─── React-Flow data ────────────────────────────────────────────────
  override async getFlowReactFlowData(
    _flowId: string,
    options?: ReactFlowDataOptions,
  ): Promise<ReactFlowData> {
    // When a `flowRunId` is supplied (Runs view), derive the per-node
    // status overlay from that run's executions instead of the live
    // `nodeRunStatus`. This way the same canvas component works for both
    // edit-mode (live status) and runs-mode (recorded status).
    let runStatus: Record<string, NodeRunStatus> | undefined = this.state.nodeRunStatus;
    if (options?.flowRunId) {
      const execs = this.state.nodeExecutionsByRun?.[options.flowRunId] ?? [];
      const next: Record<string, NodeRunStatus> = {};
      for (const e of execs) {
        const mapped = mapNodeStatus((e as { status?: unknown }).status);
        if (mapped) {
          next[(e as { nodeId: string }).nodeId] = mapped;
        }
      }
      runStatus = next;
    }
    return invectDefinitionToReactFlowData({
      flow: this.state.flow,
      actions: this.state.actions,
      nodeRunStatus: runStatus,
    });
  }

  // ─── Node definitions ───────────────────────────────────────────────
  override async getAvailableNodes(): Promise<NodeDefinition[]> {
    return this.state.actions as NodeDefinition[];
  }

  override async resolveNodeDefinition(
    nodeType: string,
    _options?: {
      nodeId?: string | null;
      flowId?: string | null;
      params?: Record<string, unknown>;
      changeField?: string;
      changeValue?: unknown;
    },
  ): Promise<NodeConfigUpdateResponse> {
    const def = this.state.actions.find((a) => a.type === nodeType);
    if (!def) {
      throw new Error(`Unknown node type: ${nodeType}`);
    }
    return {
      definition: def as NodeDefinition,
    } as NodeConfigUpdateResponse;
  }

  override async loadFieldOptions(
    _actionId: string,
    _fieldName: string,
    _dependencyValues: Record<string, unknown>,
  ): Promise<{
    options: { label: string; value: string | number }[];
    defaultValue?: string | number;
    placeholder?: string;
    disabled?: boolean;
  }> {
    return { options: [], disabled: true, placeholder: 'Connect a backend to load options' };
  }

  override async testJsExpression(): Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
  }> {
    return { success: false, error: 'Template preview requires a connected backend' };
  }

  override async testMapper(): Promise<{ success: boolean; output?: unknown; error?: string }> {
    return { success: false, error: 'Mapper preview requires a connected backend' };
  }

  override async testModelPrompt(): Promise<unknown> {
    throw notSupported('testModelPrompt');
  }

  override async getModels(_options?: {
    credentialId?: string;
    provider?: string;
  }): Promise<{ provider?: string; models: Model[]; defaultModel: string }> {
    return { models: [], defaultModel: '' };
  }

  override async getModelsForCredential(
    _credentialId: string,
  ): Promise<{ provider?: string; models: Model[]; defaultModel: string }> {
    return { models: [], defaultModel: '' };
  }

  override async testNode(): Promise<{
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
  }> {
    return { success: false, error: 'Node testing requires a connected backend' };
  }

  override async executeFlowToNode(
    _flowId: string,
    _nodeId: string,
    _inputs?: Record<string, unknown>,
    _options?: { version?: number | 'latest'; useBatchProcessing?: boolean },
  ): Promise<FlowRunResult> {
    throw notSupported('executeFlowToNode');
  }

  // ─── Credentials ────────────────────────────────────────────────────
  override async listCredentials(_filters?: CredentialFilters): Promise<Credential[]> {
    return this.state.credentials;
  }

  override async getCredential(id: string): Promise<Credential> {
    const c = this.state.credentials.find((x) => x.id === id);
    if (!c) {
      throw new Error(`Credential ${id} not found`);
    }
    return c;
  }

  override async createCredential(_input: CreateCredentialInput): Promise<Credential> {
    this.callbacks.onOpenCredentialManager?.();
    throw notSupported('createCredential');
  }

  override async updateCredential(_id: string, _input: UpdateCredentialInput): Promise<Credential> {
    this.callbacks.onOpenCredentialManager?.();
    throw notSupported('updateCredential');
  }

  override async deleteCredential(_id: string): Promise<void> {
    this.callbacks.onOpenCredentialManager?.();
    throw notSupported('deleteCredential');
  }

  override async testCredential(_id: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Credential testing requires a connected backend' };
  }

  override async testCredentialRequest(_params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; statusText: string; ok: boolean; body: unknown }> {
    return { status: 0, statusText: 'Not supported offline', ok: false, body: null };
  }

  override async getCredentialUsage(_id: string): Promise<CredentialUsage> {
    return { flows: [], nodes: [] } as unknown as CredentialUsage;
  }

  // ─── OAuth2 ─────────────────────────────────────────────────────────
  override async getOAuth2Providers(): Promise<OAuth2ProviderDefinition[]> {
    return [];
  }

  override async getOAuth2Provider(_providerId: string): Promise<OAuth2ProviderDefinition> {
    throw notSupported('getOAuth2Provider');
  }

  override async startOAuth2Flow(_params: {
    providerId?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    scopes?: string[];
    returnUrl?: string;
    credentialName?: string;
    existingCredentialId?: string;
  }): Promise<OAuth2StartResult> {
    this.callbacks.onOpenCredentialManager?.();
    throw notSupported('startOAuth2Flow');
  }

  override async handleOAuth2Callback(_params: {
    code: string;
    state: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }): Promise<Credential> {
    throw notSupported('handleOAuth2Callback');
  }

  override async refreshOAuth2Credential(_credentialId: string): Promise<Credential> {
    throw notSupported('refreshOAuth2Credential');
  }

  // ─── Agent tools ────────────────────────────────────────────────────
  override async getAgentTools(): Promise<AgentToolDefinition[]> {
    return this.state.agentTools;
  }

  // ─── Triggers ───────────────────────────────────────────────────────
  override async listTriggersForFlow(_flowId: string): Promise<FlowTriggerRegistration[]> {
    return [];
  }

  override async getTrigger(_triggerId: string): Promise<FlowTriggerRegistration> {
    throw notSupported('getTrigger');
  }

  override async createTrigger(
    _flowId: string,
    _input: CreateTriggerInput,
  ): Promise<FlowTriggerRegistration> {
    throw notSupported('createTrigger');
  }

  override async updateTrigger(
    _triggerId: string,
    _input: UpdateTriggerInput,
  ): Promise<FlowTriggerRegistration> {
    throw notSupported('updateTrigger');
  }

  override async deleteTrigger(_triggerId: string): Promise<void> {
    throw notSupported('deleteTrigger');
  }

  override async syncTriggersForFlow(
    _flowId: string,
    _definition: {
      nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
    },
  ): Promise<FlowTriggerRegistration[]> {
    return [];
  }

  // ─── Chat ───────────────────────────────────────────────────────────
  override async getChatStatus(): Promise<{ enabled: boolean }> {
    return { enabled: this.state.chatEnabled };
  }

  override async getChatModels(
    _credentialId: string,
    _query?: string,
  ): Promise<{ id: string; name?: string; provider?: string }[]> {
    return [];
  }

  override async sendChatMessage(): Promise<Response> {
    throw notSupported('sendChatMessage');
  }

  override async reattachChatStream(): Promise<Response> {
    throw notSupported('reattachChatStream');
  }

  override async getChatMessages(flowId: string): Promise<
    {
      id: string;
      flowId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      toolMeta?: Record<string, unknown> | null;
      createdAt: string;
    }[]
  > {
    // Keep the flowId parameter referenced so tsc doesn't complain under
    // noUnusedParameters if that flag ever flips on.
    void flowId;
    return [];
  }

  override async saveChatMessages(): Promise<void> {
    // no-op
  }

  override async deleteChatMessages(): Promise<void> {
    // no-op
  }
}
