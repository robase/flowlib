/**
 * @flowlib/mcp — Shared types
 */

/** Configuration for the MCP plugin */
export interface McpPluginOptions {
  /** Session time-to-live in milliseconds. Default: 30 minutes */
  sessionTtlMs?: number;

  /** Audit logging configuration */
  audit?: {
    /** Enable audit logging. Default: true */
    enabled?: boolean;
    /** Persist audit logs to database. Default: false (log only) */
    persist?: boolean;
    /** Log level for audit entries. Default: 'info' */
    logLevel?: 'debug' | 'info' | 'warn';
  };
}

/**
 * MCP tool identifiers.
 *
 * Scope: flow building, editing, inspection, and debugging. Intentionally
 * excludes any tool whose purpose is to invoke an LLM (chat, agent prompt
 * submission, model-prompt dry-run) — MCP clients already have an LLM and
 * should not be paying for a second one round-tripped through Invect.
 */
export const TOOL_IDS = {
  // Flow management
  FLOW_LIST: 'flow_list',
  FLOW_GET: 'flow_get',
  FLOW_GET_DEFINITION: 'flow_get_definition',
  FLOW_GET_SDK_SOURCE: 'flow_get_sdk_source',
  FLOW_CREATE: 'flow_create',
  FLOW_UPDATE: 'flow_update',
  FLOW_DELETE: 'flow_delete',
  FLOW_VALIDATE: 'flow_validate',

  // Versions
  VERSION_LIST: 'version_list',
  VERSION_GET: 'version_get',
  VERSION_PUBLISH: 'version_publish',

  // Runs
  RUN_START: 'run_start',
  RUN_START_ASYNC: 'run_start_async',
  RUN_TO_NODE: 'run_to_node',
  RUN_LIST: 'run_list',
  RUN_GET: 'run_get',
  RUN_CANCEL: 'run_cancel',
  RUN_PAUSE: 'run_pause',
  RUN_RESUME: 'run_resume',
  RUN_LIST_NODE_EXECUTIONS: 'run_list_node_executions',
  RUN_GET_TOOL_EXECUTIONS: 'run_get_tool_executions',

  // Debug
  DEBUG_NODE_EXECUTIONS: 'debug_node_executions',
  DEBUG_TEST_NODE: 'debug_test_node',
  DEBUG_TEST_EXPRESSION: 'debug_test_expression',
  DEBUG_TEST_MAPPER: 'debug_test_mapper',

  // Credentials
  CREDENTIAL_LIST: 'credential_list',
  CREDENTIAL_TEST: 'credential_test',
  CREDENTIAL_LIST_OAUTH2_PROVIDERS: 'credential_list_oauth2_providers',

  // Triggers
  TRIGGER_LIST: 'trigger_list',
  TRIGGER_GET: 'trigger_get',
  TRIGGER_CREATE: 'trigger_create',
  TRIGGER_UPDATE: 'trigger_update',
  TRIGGER_DELETE: 'trigger_delete',
  TRIGGER_SYNC: 'trigger_sync',
  TRIGGER_EXECUTE_CRON: 'trigger_execute_cron',
  TRIGGER_LIST_ENABLED_CRON: 'trigger_list_enabled_cron',

  // Node reference
  NODE_LIST_PROVIDERS: 'node_list_providers',
  NODE_LIST_AVAILABLE: 'node_list_available',
  NODE_LIST_FOR_PROVIDER: 'node_list_for_provider',
  NODE_RESOLVE_FIELD_OPTIONS: 'node_resolve_field_options',

  // Agent — introspection only. Prompt submission is intentionally omitted.
  AGENT_LIST_TOOLS: 'agent_list_tools',
} as const;

export type ToolId = (typeof TOOL_IDS)[keyof typeof TOOL_IDS];

/** Audit log entry */
export interface AuditEntry {
  timestamp: string;
  sessionId?: string;
  userId?: string;
  userRole?: string;
  tool: string;
  params: Record<string, unknown>;
  status: 'success' | 'error';
  durationMs: number;
  error?: string;
}
