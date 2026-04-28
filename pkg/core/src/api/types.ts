/**
 * Flowlib Sub-API Type Definitions
 *
 * These interfaces define the namespaced public API surface returned by createFlowlib().
 * Each interface groups related operations into a cohesive domain.
 */

import type { Flow, CreateFlowInput, UpdateFlowInput } from '../services/flows/flows.model';
import type { FlowVersion } from '../database';
import type { FlowRun } from '../services/flow-runs/flow-runs.model';
import type {
  NodeExecution,
  AgentToolExecution,
} from '../services/node-executions/node-executions.model';
import type {
  ExecuteFlowOptions,
  FlowRunResult,
  FlowInputs,
} from '../services/flow-runs/flow-runs.service';
import type { SubmitPromptRequest } from '../services/node-data.service';
import type {
  Credential,
  CreateCredentialInput,
  UpdateCredentialInput,
  CredentialFilters,
} from '../services/credentials';
import type { OAuth2PendingState } from '../services/credentials/oauth2.service';
import type { OAuth2ProviderDefinition } from '../services/credentials/oauth2-providers';
import type {
  FlowTriggerRegistration,
  CreateTriggerInput,
  UpdateTriggerInput,
  ExecuteDueCronTriggersResult,
} from '../services/triggers';
import type { FlowValidationResult } from '../types/validation';
import type { ReactFlowData } from '../services/react-flow-renderer.service';
import type { NodeDefinition } from '../types/node-definition.types';
import type { BatchProvider, Model, BatchPollingRunResult } from '../services/ai/base-client';
import type { PaginatedResponse, QueryOptions } from '../schemas';
import type {
  CreateFlowVersionRequest,
  FlowEdge,
  FlowlibDefinition,
} from '../services/flow-versions/schemas-fresh';
import type { ExecutionStreamEvent } from '../services/execution-event-bus';
import type { ActionDefinition, ProviderDef, LoadOptionsResult } from '@flowlib/action-kit';
import type { ActionRegistry } from '@flowlib/actions/registry';
import type { AgentToolDefinition, AgentPromptResult } from '../types/agent-tool.types';
import type { SubmitAgentPromptRequest } from '../types.internal';
import type {
  NodeConfigUpdateEvent,
  NodeConfigUpdateResponse,
} from '../types/node-config-update.types';
import type {
  FlowlibIdentity,
  FlowlibPermission,
  AuthorizationContext,
  AuthorizationResult,
  AuthEvent,
} from '../types/auth.types';
import type { AuthorizationService } from '../services/auth';
import type { FlowlibPlugin, FlowlibPluginEndpoint, PluginHookRunner } from '../types/plugin.types';
import type { DatabaseConnection } from '../database/connection';
import type { LoggerManager, ScopedLogger, LogLevel } from '../utils/logger';
import type { DashboardStats } from '../flowlib-core';
import type { ChatMessageRecord } from '../services/chat/chat-messages.model';

import type { ChatMessage, ChatContext, ChatStreamEvent } from '../services/chat/chat-types';

export interface FlowlibMaintenanceOptions {
  now?: Date | string;
  pollBatchJobs?: boolean;
  resumePausedFlows?: boolean;
  failStaleRuns?: boolean;
  executeCronTriggers?: boolean;
}

export interface FlowlibMaintenanceResult {
  timestamp: string;
  batchPolling?: BatchPollingRunResult;
  flowResumption?: {
    readyCount: number;
    resumedCount: number;
    failedCount: number;
  };
  staleRuns?: {
    failedCount: number;
  };
  cronTriggers?: ExecuteDueCronTriggersResult & {
    disabled?: boolean;
  };
}

// =====================================
// FLOWS
// =====================================

export interface FlowsAPI {
  create(data: CreateFlowInput): Promise<Flow>;
  list(options?: QueryOptions<Flow>): Promise<PaginatedResponse<Flow>>;
  get(flowId: string): Promise<Flow>;
  update(flowId: string, data: UpdateFlowInput): Promise<Flow>;
  delete(flowId: string): Promise<void>;
  validate(flowId: string, definition: unknown): Promise<FlowValidationResult>;
  renderToReactFlow(
    flowId: string,
    options?: { version?: string | number | 'latest'; flowRunId?: string },
  ): Promise<ReactFlowData>;
  getDashboardStats(): Promise<DashboardStats>;
}

// =====================================
// FLOW VERSIONS
// =====================================

export interface FlowVersionsAPI {
  create(flowId: string, data: CreateFlowVersionRequest): Promise<FlowVersion>;
  list(
    flowId: string,
    options?: QueryOptions<FlowVersion>,
  ): Promise<PaginatedResponse<FlowVersion>>;
  get(flowId: string, version: string | number | 'latest'): Promise<FlowVersion | null>;
}

// =====================================
// FLOW RUNS
// =====================================

export interface FlowRunsAPI {
  start(flowId: string, inputs?: FlowInputs, options?: ExecuteFlowOptions): Promise<FlowRunResult>;
  startAsync(
    flowId: string,
    inputs?: FlowInputs,
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult>;
  executeToNode(
    flowId: string,
    targetNodeId: string,
    inputs?: FlowInputs,
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult>;
  resume(executionId: string): Promise<{ message: string; timestamp: string }>;
  list(options?: QueryOptions<FlowRun>): Promise<PaginatedResponse<FlowRun>>;
  listByFlowId(
    flowId: string,
    options?: QueryOptions<FlowRun>,
  ): Promise<PaginatedResponse<FlowRun>>;
  get(flowRunId: string): Promise<FlowRun>;
  cancel(flowRunId: string): Promise<{ message: string; timestamp: string }>;
  pause(flowRunId: string, reason?: string): Promise<{ message: string; timestamp: string }>;
  createEventStream(flowRunId: string): AsyncGenerator<ExecutionStreamEvent, void, undefined>;
  /**
   * Run an inline flow definition without persisting it as a regular flow.
   *
   * The definition is validated, then a temporary flow + version is created
   * (tagged `__ephemeral__`) so the run integrates with the existing
   * `flow_runs` and event bus infrastructure. SSE consumers, run inspection,
   * and node executions all work as normal — only the flow itself is hidden
   * from typical "list flows" surfaces by virtue of the tag.
   *
   * **Credentials are NOT ephemeral.** Any `credentialId` referenced by the
   * inline definition still resolves against the backend's persisted
   * credential store. Ephemeral here means flow-definition-ephemeral, not
   * credential-ephemeral.
   *
   * @returns `{ flowRunId, flowId, status, eventsPath }` — `eventsPath` is
   * the relative SSE path (e.g. `/flow-runs/<id>/stream`) the caller should
   * subscribe to for live execution events.
   */
  runEphemeral(
    definition: FlowlibDefinition,
    inputs?: FlowInputs,
    options?: { initiatedBy?: string; name?: string; useBatchProcessing?: boolean },
  ): Promise<{
    flowRunId: string;
    flowId: string;
    status: string;
    eventsPath: string;
  }>;
  getNodeExecutions(
    flowRunId: string,
    options?: QueryOptions<NodeExecution>,
  ): Promise<PaginatedResponse<NodeExecution>>;
  listNodeExecutions(
    options?: QueryOptions<NodeExecution>,
  ): Promise<PaginatedResponse<NodeExecution>>;
  getToolExecutionsByNodeExecutionId(nodeExecutionId: string): Promise<AgentToolExecution[]>;
}

// =====================================
// CREDENTIALS (includes OAuth2)
// =====================================

export interface CredentialsAPI {
  create(input: CreateCredentialInput): Promise<Credential>;
  list(filters?: CredentialFilters): Promise<Array<Omit<Credential, 'config'>>>;
  get(id: string): Promise<Credential>;
  getSanitized(id: string): Promise<Credential>;
  update(id: string, input: UpdateCredentialInput): Promise<Credential>;
  delete(id: string): Promise<void>;
  test(id: string): Promise<{ success: boolean; error?: string }>;
  updateLastUsed(id: string): Promise<void>;
  getExpiring(daysUntilExpiry?: number): Promise<Credential[]>;

  // OAuth2
  getOAuth2Providers(): OAuth2ProviderDefinition[];
  getOAuth2Provider(providerId: string): OAuth2ProviderDefinition | undefined;
  startOAuth2Flow(
    providerId: string,
    appConfig: { clientId: string; clientSecret: string; redirectUri: string },
    options?: {
      scopes?: string[];
      returnUrl?: string;
      credentialName?: string;
      existingCredentialId?: string;
    },
  ): { authorizationUrl: string; state: string };
  /** Start OAuth2 flow using secrets already stored on an existing credential */
  startOAuth2FlowForCredential(
    existingCredentialId: string,
    redirectUri: string,
    options?: { scopes?: string[]; returnUrl?: string },
  ): Promise<{ authorizationUrl: string; state: string }>;
  getOAuth2PendingState(state: string): OAuth2PendingState | undefined;
  handleOAuth2Callback(
    code: string,
    state: string,
    appConfig?: { clientId: string; clientSecret: string; redirectUri: string },
  ): Promise<Credential>;
  refreshOAuth2Credential(credentialId: string): Promise<Credential>;
}

// =====================================
// TRIGGERS
// =====================================

export interface TriggersAPI {
  list(flowId: string): Promise<FlowTriggerRegistration[]>;
  get(triggerId: string): Promise<FlowTriggerRegistration | null>;
  create(input: CreateTriggerInput): Promise<FlowTriggerRegistration>;
  update(triggerId: string, input: UpdateTriggerInput): Promise<FlowTriggerRegistration | null>;
  delete(triggerId: string): Promise<void>;
  sync(
    flowId: string,
    definition: {
      nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
      edges?: FlowEdge[];
    },
  ): Promise<FlowTriggerRegistration[]>;
  getEnabledCron(): Promise<FlowTriggerRegistration[]>;
  executeCron(triggerId: string): Promise<{ flowRunId: string; flowId: string }>;
  executeDueCron(options?: { now?: Date | string }): Promise<ExecuteDueCronTriggersResult>;
}

// =====================================
// AGENT
// =====================================

export interface AgentAPI {
  getTools(): AgentToolDefinition[];
  submitPrompt(
    request: SubmitAgentPromptRequest,
  ): Promise<
    | AgentPromptResult
    | { type: 'batch_submitted'; batchJobId: string; nodeId: string; flowRunId: string }
  >;
}

// =====================================
// CHAT
// =====================================

export interface ChatAPI {
  createStream(options: {
    messages: ChatMessage[];
    context: ChatContext;
    identity?: FlowlibIdentity;
  }): Promise<AsyncGenerator<ChatStreamEvent>>;
  /**
   * Reattach to an in-flight chat session by id. Replays the full event
   * buffer and then tails live events until the session completes. Useful
   * for surviving client disconnects (e.g. page refresh mid-generation).
   */
  subscribeToSession(sessionId: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent>;
  /** True if the given session id is currently live in this process. */
  hasActiveSession(sessionId: string): boolean;
  isEnabled(): boolean;
  listModels(
    credentialId: string,
    query?: string,
  ): Promise<{ id: string; name?: string; provider?: string }[]>;
  getMessages(
    flowId: string,
    options?: { limit?: number; page?: number },
  ): Promise<{
    data: ChatMessageRecord[];
    pagination: { page: number; limit: number; totalPages: number };
  }>;
  saveMessages(
    flowId: string,
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      toolMeta?: Record<string, unknown> | null;
    }>,
  ): Promise<ChatMessageRecord[]>;
  deleteMessages(flowId: string): Promise<void>;
}

// =====================================
// ACTIONS
// =====================================

export interface ActionsAPI {
  getRegistry(): ActionRegistry;
  register(action: ActionDefinition): void;
  getProviders(): ProviderDef[];
  getForProvider(providerId: string): ActionDefinition[];
  getAvailableNodes(): NodeDefinition[];
  handleConfigUpdate(event: NodeConfigUpdateEvent): Promise<NodeConfigUpdateResponse>;
  resolveFieldOptions(
    actionId: string,
    fieldName: string,
    deps: Record<string, unknown>,
  ): Promise<LoadOptionsResult>;
}

// =====================================
// TESTING
// =====================================

export interface TestingAPI {
  testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData?: Record<string, unknown>,
  ): Promise<{ success: boolean; output?: Record<string, unknown>; error?: string }>;
  testJsExpression(request: {
    expression: string;
    context: Record<string, unknown>;
  }): Promise<{ success: boolean; result?: unknown; error?: string }>;
  testMapper(request: {
    expression: string;
    incomingData: Record<string, unknown>;
    mode?: 'auto' | 'iterate' | 'reshape';
  }): Promise<{
    success: boolean;
    result?: unknown;
    resultType?: 'array' | 'object' | 'primitive';
    itemCount?: number;
    error?: string;
  }>;
  testModelPrompt(request: SubmitPromptRequest): Promise<unknown>;
  getAvailableModels(): Promise<unknown>;
  getModelsForProvider(
    provider: BatchProvider,
  ): Promise<{ provider: BatchProvider; models: Model[]; defaultModel: string }>;
  getModelsForCredential(
    credentialId: string,
  ): Promise<{ provider: BatchProvider; models: Model[]; defaultModel: string }>;
}

// =====================================
// AUTH
// =====================================

export interface AuthAPI {
  authorize(context: AuthorizationContext): Promise<AuthorizationResult>;
  hasPermission(identity: FlowlibIdentity | null, permission: FlowlibPermission): boolean;
  getPermissions(identity: FlowlibIdentity | null): FlowlibPermission[];
  getService(): AuthorizationService;
  getAvailableRoles(): ReturnType<AuthorizationService['getAvailableRoles']>;
  getResolvedRole(identity: FlowlibIdentity | null): string | null;
  onEvent<T extends AuthEvent['type']>(
    event: T,
    listener: (event: Extract<AuthEvent, { type: T }>) => void,
  ): void;
  isEnabled(): boolean;
  isPublicRoute(path: string): boolean;
}

// =====================================
// PLUGINS
// =====================================

export interface PluginsAPI {
  has(pluginId: string): boolean;
  get(pluginId: string): FlowlibPlugin | null;
  getAll(): readonly FlowlibPlugin[];
  getEndpoints(): FlowlibPluginEndpoint[];
  getHookRunner(): PluginHookRunner;
  getDatabaseConnection(): DatabaseConnection;
}

// =====================================
// MAINTENANCE (PR 5/14)
// =====================================

/**
 * External-scheduler entry points for the periodic lifecycle work that
 * `@flowlib/core` would otherwise drive with in-process `setInterval`s.
 *
 * Each method performs exactly one tick and returns a `{ count }` summary
 * of how many records it touched. Designed to be invoked from a host's
 * cron facility (Cloudflare Cron Triggers, Vercel Cron, Kubernetes
 * CronJob, etc.).
 *
 * On a long-lived Node process the existing `start*Polling` lifecycle
 * methods continue to handle this with timers — these maintenance
 * methods are an alternative entry point, not a replacement.
 */
export interface MaintenanceAPI {
  /** Mark RUNNING/PENDING runs whose heartbeat is stale as FAILED. */
  detectStaleRuns(): Promise<{ count: number }>;
  /** Resume flows paused for batch processing whose batches have completed. */
  pollBatchJobs(): Promise<{ count: number }>;
  /** Poll provider batch APIs for status updates on pending batch jobs. */
  pollPendingBatches(): Promise<{ count: number }>;
  /** Drop in-memory chat sessions past the lifetime / reconnect-grace cap. */
  evictExpiredChatSessions(): Promise<{ count: number }>;
  /** Drop in-memory OAuth2 pending-state entries older than 10 minutes. */
  cleanupExpiredOAuthStates(): Promise<{ count: number }>;
}

// =====================================
// FLOWLIB INSTANCE (top-level)
// =====================================

export interface FlowlibInstance {
  readonly flows: FlowsAPI;
  readonly versions: FlowVersionsAPI;
  readonly runs: FlowRunsAPI;
  readonly credentials: CredentialsAPI;
  readonly triggers: TriggersAPI;
  readonly agent: AgentAPI;
  readonly chat: ChatAPI;
  readonly actions: ActionsAPI;
  readonly testing: TestingAPI;
  readonly auth: AuthAPI;
  readonly plugins: PluginsAPI;
  /**
   * External-scheduler entry points for periodic lifecycle work
   * (PR 5/14). See {@link MaintenanceAPI}.
   */
  readonly maintenance: MaintenanceAPI;

  // Logging (root-level — too small for a namespace)
  getLogger(scope: string, context?: string): ScopedLogger;
  getLoggerManager(): LoggerManager;
  setLogLevel(scope: string, level: LogLevel): void;

  // Lifecycle
  shutdown(): Promise<void>;
  startBatchPolling(): Promise<void>;
  stopBatchPolling(): Promise<void>;
  startMaintenancePolling(): Promise<void>;
  stopMaintenancePolling(): Promise<void>;
  startCronScheduler(): Promise<void>;
  stopCronScheduler(): void;
  refreshCronScheduler(): Promise<void>;
  runMaintenance(options?: FlowlibMaintenanceOptions): Promise<FlowlibMaintenanceResult>;
  healthCheck(): Promise<Record<string, boolean>>;
}
