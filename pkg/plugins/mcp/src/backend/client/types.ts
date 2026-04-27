/**
 * FlowlibClient — abstraction over Flowlib API access.
 *
 * Both DirectClient (plugin mode) and HttpClient (CLI mode) implement this
 * interface so tool handlers remain transport-agnostic.
 *
 * Return types are intentionally `unknown` for most operations since the
 * MCP layer JSON-stringifies everything. This avoids mapping internal
 * types to a duplicated schema.
 *
 * Note on identity: these methods do NOT take an `FlowlibIdentity`. Auth is
 * handled at the transport layer — the plugin endpoint resolves identity
 * via the framework adapter's middleware before the MCP server dispatches
 * tool calls, and the stdio CLI authenticates via API key.
 */

/** Sanitized credential (no secrets) */
export interface CredentialSummary {
  id: string;
  name: string;
  type: string;
  provider?: string;
  lastUsedAt?: string;
  createdAt?: string;
  expiresAt?: string;
}

/** Result of emitting a flow as SDK source */
export interface FlowSdkSourceResult {
  code: string;
  importedBuilders: string[];
  flowName: string;
  version: string | number;
}

export interface GetFlowSdkSourceOptions {
  version?: string | number;
  flowName?: string;
  sdkImport?: string;
}

export interface FlowlibClient {
  // ===== Flows =====
  listFlows(): Promise<unknown>;
  getFlow(flowId: string): Promise<unknown>;
  getFlowDefinition(flowId: string): Promise<unknown | null>;
  getFlowSdkSource(flowId: string, options?: GetFlowSdkSourceOptions): Promise<FlowSdkSourceResult>;
  createFlow(data: { name: string; description?: string }): Promise<unknown>;
  updateFlow(flowId: string, data: { name?: string; description?: string }): Promise<unknown>;
  deleteFlow(flowId: string): Promise<void>;
  validateFlow(flowId: string, definition: unknown): Promise<{ valid: boolean; errors?: string[] }>;

  // ===== Versions =====
  listVersions(flowId: string): Promise<unknown>;
  getVersion(flowId: string, version: string | number | 'latest'): Promise<unknown>;
  publishVersion(flowId: string, data: unknown): Promise<unknown>;

  // ===== Runs =====
  startRun(flowId: string, inputs?: Record<string, unknown>): Promise<unknown>;
  startRunAsync(flowId: string, inputs?: Record<string, unknown>): Promise<unknown>;
  runToNode(flowId: string, nodeId: string, inputs?: Record<string, unknown>): Promise<unknown>;
  listRuns(flowId: string): Promise<unknown>;
  getRun(flowRunId: string): Promise<unknown>;
  cancelRun(flowRunId: string): Promise<{ message: string }>;
  pauseRun(flowRunId: string): Promise<{ message: string }>;
  resumeRun(flowRunId: string): Promise<{ message: string }>;

  // ===== Debug =====
  getNodeExecutions(flowRunId: string): Promise<unknown[]>;
  listNodeExecutions(): Promise<unknown[]>;
  getToolExecutions(nodeExecutionId: string): Promise<unknown[]>;
  testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData?: Record<string, unknown>,
  ): Promise<{ success: boolean; output?: unknown; error?: string }>;
  testJsExpression(
    expression: string,
    context: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }>;
  testMapper(
    expression: string,
    incomingData: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }>;

  // ===== Credentials =====
  listCredentials(): Promise<CredentialSummary[]>;
  testCredential(credentialId: string): Promise<{ success: boolean; error?: string }>;
  listOAuth2Providers(): Promise<unknown[]>;

  // ===== Triggers =====
  listTriggers(flowId: string): Promise<unknown[]>;
  getTrigger(triggerId: string): Promise<unknown>;
  createTrigger(input: unknown): Promise<unknown>;
  updateTrigger(triggerId: string, input: unknown): Promise<unknown>;
  deleteTrigger(triggerId: string): Promise<void>;
  syncTriggers(flowId: string, definition: unknown): Promise<unknown[]>;
  executeCronTrigger(triggerId: string): Promise<unknown>;
  listEnabledCronTriggers(): Promise<unknown[]>;

  // ===== Node Reference =====
  listProviders(): Promise<unknown[]>;
  listAvailableNodes(): Promise<unknown[]>;
  listNodesForProvider(providerId: string): Promise<unknown[]>;
  resolveFieldOptions(
    actionId: string,
    fieldName: string,
    deps: Record<string, unknown>,
  ): Promise<unknown>;

  // ===== Agent =====
  listAgentTools(): Promise<unknown[]>;
}
