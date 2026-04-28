// Flowlib Core Package - Main entry point
// Framework-agnostic core package for Flowlib execution engine

// Legacy class (deprecated — use createFlowlib instead)
export * from './flowlib-core';
export * from './database';
export * from './types.internal';

// Provider-Actions architecture
// Re-export action infrastructure from the canonical packages.
// `defineAction` + types live in @flowlib/action-kit (no runtime deps);
// the registry, executor bridges, providers, and per-provider action
// bundles live in @flowlib/actions.
export { defineAction } from '@flowlib/action-kit';
export {
  ActionRegistry,
  getGlobalActionRegistry,
  initializeGlobalActionRegistry,
} from '@flowlib/actions/registry';
export {
  executeActionAsNode,
  executeActionAsTool,
  createToolExecutorForAction,
  allProviderActions,
  coreActions,
  httpActions,
  gmailActions,
  slackActions,
  githubActions,
  googleDocsActions,
  googleSheetsActions,
  googleDriveActions,
  googleCalendarActions,
  linearActions,
  postgresActions,
} from '@flowlib/actions';
export {
  CORE_PROVIDER,
  HTTP_PROVIDER,
  GMAIL_PROVIDER,
  SLACK_PROVIDER,
  GITHUB_PROVIDER,
  GOOGLE_DOCS_PROVIDER,
  GOOGLE_SHEETS_PROVIDER,
  GOOGLE_DRIVE_PROVIDER,
  GOOGLE_CALENDAR_PROVIDER,
  LINEAR_PROVIDER,
  POSTGRES_PROVIDER,
  TRIGGERS_PROVIDER,
} from '@flowlib/actions/providers';

/**
 * Convenience alias for `allProviderActions`. Retained for back-compat;
 * new code should import `allProviderActions` from `@flowlib/actions`.
 *
 * @deprecated Use `allProviderActions` instead.
 */
export { allProviderActions as allBuiltinActions } from '@flowlib/actions';

export type {
  ActionDefinition,
  ActionExecutionContext,
  ActionResult,
  ActionCredential,
  ActionCategory,
  ProviderDef,
  ProviderCategory,
  CredentialRequirement,
  ParamField,
} from '@flowlib/action-kit';

// Re-export shared plugin database API factory
export { createPluginDatabaseApi } from './services/plugin-database-api';

// Re-export auth types and service
export { AuthorizationService, createAuthorizationService } from './services/auth';
export type { AuthorizationServiceOptions } from './services/auth';
export type {
  FlowlibIdentity,
  FlowlibResourceAccess,
  FlowlibBuiltInRole,
  FlowlibRole,
  FlowlibPermission,
  FlowlibResourceType,
  AuthorizationContext,
  AuthorizationResult,
  AuthEventBase,
  AuthAuthorizedEvent,
  AuthForbiddenEvent,
  AuthUnauthenticatedEvent,
  AuthEvent,
  CustomAuthorizeFn,
  FlowlibAuthConfig,
} from './types/auth.types';
export { DEFAULT_ROLE_PERMISSIONS, ACTION_PERMISSION_MAP } from './types/auth.types';

// Re-export schema types for flow definitions
export {
  flowNodeDefinitionsSchema,
  flowEdgeSchema,
  flowlibDefinitionSchema,
  createFlowVersionRequestSchema,
  mapperConfigSchema,
  // Export types with schema prefix to avoid conflicts
  type FlowNodeDefinitions,
  type FlowNodeForType,
  type FlowEdge,
  type FlowlibDefinition,
  type CreateFlowVersionRequest,
  type MapperConfig,
} from './services/flow-versions/schemas-fresh';

export type { FlowNodeDefinitions as FlowNode } from './services/flow-versions/schemas-fresh';

// Re-export service types for API clients
export type {
  FlowRunResult,
  FlowInputs,
  ExecuteFlowOptions,
} from './services/flow-runs/flow-runs.service';

export type {
  Flow,
  CreateFlowInput as CreateFlowRequest,
  UpdateFlowInput,
} from './services/flows/flows.model';

// Aliases consumed by frontend/express/nestjs
export type { CreateFlowInput as CreateFlowDto } from './services/flows/flows.model';
export type { CreateFlowVersionRequest as CreateFlowVersionDto } from './services/flow-versions/schemas-fresh';

export type {
  FlowRun,
  CreateFlowRunInput,
  UpdateFlowRunInput,
} from './services/flow-runs/flow-runs.model';

export type {
  NodeExecution,
  CreateNodeExecutionInput,
  UpdateNodeExecutionInput,
  AgentToolExecution,
  CreateAgentToolExecutionInput,
} from './services/node-executions/node-executions.model';

// Re-export node data service types
export type { SubmitPromptRequest } from './services/node-data.service';

// Re-export AI service types
export type { Model } from './services/ai/base-client';

// Re-export agent tool types
export type {
  AgentToolDefinition,
  AgentToolCategory,
  AgentToolExecutionContext,
  AgentToolResult,
  AgentToolExecutor,
  RegisteredAgentTool,
  AgentToolCall,
  ToolExecutionRecord,
  AgentMessage,
  AgentStopCondition,
  AgentFinishReason,
  AgentPromptResult,
  AgentPromptRequest,
  AgentExecutionOutput,
} from './types/agent-tool.types';

// Re-export OAuth2 types
export type { OAuth2ProviderDefinition } from './services/credentials/oauth2-providers';

export type {
  OAuth2AppConfig,
  OAuth2StartResult,
  OAuth2Tokens,
  OAuth2PendingState,
} from './services/credentials/oauth2.service';

// Re-export credential types
export type {
  Credential,
  CreateCredentialInput,
  UpdateCredentialInput,
  CredentialFilters,
} from './services/credentials/credentials.service';

// Re-export trigger types and services
export type {
  TriggerType,
  FlowTriggerRegistration,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerExecutionOptions,
  ExecuteDueCronTriggersOptions,
  ExecuteDueCronTriggersResult,
} from './services/triggers';

export { FlowTriggersService, CronSchedulerService } from './services/triggers';

// Re-export base types
// FlowEdge is already exported above from schemas-fresh

// Re-export pagination types
export type { PaginatedResponse, QueryOptions } from './schemas/pagination-sort-filter';

// Re-export commonly needed base types
export { FlowRunStatus, NodeExecutionStatus } from './types/base';

export type { FlowlibConfig } from './schemas/flowlib-config';
export { defineConfig, definePlugin } from './schemas/flowlib-config';

// Plugin system
export type {
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginSchema,
  FlowlibPluginHooks,
  FlowlibPluginEndpoint,
  FlowlibPluginContext,
  FlowlibPluginInitResult,
  PluginEndpointContext,
  PluginDatabaseApi,
  PluginEndpointCoreApi,
  PluginEndpointResponse,
  PluginFieldAttribute,
  PluginFieldType,
  PluginTableDefinition,
  PluginHookRunner,
  FlowRunHookContext,
  NodeExecutionHookContext,
  NodeExecutionHookResult,
} from './types/plugin.types';

// Schema infrastructure (for CLI and advanced usage)
export { CORE_SCHEMA, CORE_TABLE_NAMES, CORE_ENUMS } from './database/core-schema';
export { mergeSchemas, diffSchemas, SchemaConflictError } from './database/schema-merger';
export type {
  MergedSchema,
  MergedTable,
  SchemaProvenance,
  SchemaDiff,
  SchemaTransform,
  TableIndex,
} from './database/schema-merger';
export {
  generateSqliteSchema,
  generatePostgresSchema,
  generateMysqlSchema,
  generateSqliteSchemaAppend,
  generatePostgresSchemaAppend,
  generateMysqlSchemaAppend,
  generateSqliteRawSql,
  generatePostgresRawSql,
  generateMysqlRawSql,
} from './database/schema-generator';
export type { AppendSchemaResult } from './database/schema-generator';
export { generateFullPrismaSchema, generatePrismaModels } from './database/prisma-schema-generator';
export type { PrismaProvider } from './database/prisma-schema-generator';
export { verifySchema } from './database/schema-verification';
export type {
  SchemaVerificationResult,
  SchemaVerificationOptions,
} from './database/schema-verification';

export { generateNodeSlug } from './utils/node-slug';

// Re-export configuration types
export type { ExecutionConfig, LoggingConfig, Logger, FlowlibDatabaseConfig } from './schemas';

// Re-export scoped logging utilities
export {
  LoggerManager,
  ScopedLogger,
  BaseLogger,
  LogScope,
  type LogLevel,
  type LogScopeName,
  type ScopedLoggingConfig,
} from './utils/logger';

// Re-export node input mapping schema
export { NodeInputMappingSchema } from './types/node-io-types';

export type {
  NodeOutput,
  NodeOutputs,
  NodeInputData,
  NodeIncomingDataObject,
  InputMappingConfig,
  StructuredOutput,
  OutputVariable,
  OutputVariables,
} from './types/node-io-types';

// Re-export AI related types and enums
export { BatchProvider, BatchStatus, AIProvider } from './services/ai/base-client';
export type {
  ProviderAdapter,
  ProviderCapabilities,
  BatchPollingRunResult,
} from './services/ai/base-client';

// Re-export Chat Assistant types and service
export { ChatStreamService, ChatToolkit, ChatConfigSchema } from './services/chat';
export type {
  ChatMessage,
  ChatContext,
  ChatStreamEvent,
  ChatToolCall,
  ChatToolResult,
  ChatToolContext,
  ChatToolDefinition,
  ChatConfig,
  ChatUsage,
  CreateChatStreamOptions,
} from './services/chat';

// Pluggable service adapter interfaces — swap defaults for edge runtimes
export type {
  EncryptionAdapter,
  EncryptionContext,
  ExecutionEventBusAdapter,
  ChatSessionStore,
  CronSchedulerAdapter,
  BatchPollerAdapter,
  // PR 13/14 — background job runner abstraction
  JobRunnerAdapter,
  JobOptions,
  FlowlibServiceOverrides,
} from './types/services';
// EncryptedData envelope type (referenced by EncryptionAdapter signatures).
export type { EncryptedData } from './services/credentials/encryption.service';

// Default in-process job runner + canonical job-type strings (PR 13/14)
export { InProcessJobRunner, JOB_TYPES } from './services/job-runner';
export type {
  InProcessJobRunnerOptions,
  JobHandler,
  JobType,
  FlowRunJobPayload,
  BatchJobResumeJobPayload,
} from './services/job-runner';

// Execution event bus (SSE streaming)
export {
  ExecutionEventBus,
  RemoteEventBus,
  NoopEventBus,
  getExecutionEventBus,
  resetExecutionEventBus,
} from './services/execution-event-bus';
export type {
  ExecutionStreamEvent,
  ExecutionSnapshotEvent,
  FlowRunUpdatedEvent,
  NodeExecutionCreatedEvent,
  NodeExecutionUpdatedEvent,
  HeartbeatEvent,
  EndEvent,
  RemoteEventBusOptions,
} from './services/execution-event-bus';
// Public alias used by external clients (VSCode extension, etc.).
// See pkg/core/src/types.frontend.ts for the full doc comment.
export type { ExecutionStreamEvent as RunEvent } from './services/execution-event-bus';

// Re-export validation types
export type {
  FlowValidationResult,
  FlowValidationError,
  FlowValidationWarning,
  ValidationIssue,
} from './types/validation';

// Re-export validation constants
export { FLOW_VALIDATION_ERROR_TYPES } from './types/validation';

export type { FlowVersion } from './database';

// Node configuration update contracts
export type {
  NodeConfigUpdateEvent,
  NodeConfigUpdateResponse,
  NodeConfigUpdateContext,
} from './types/node-config-update.types';

// Re-export template service for param field templating
export {
  TemplateService,
  getTemplateService,
  createTemplateService,
  resetTemplateService,
} from './services/templating/template.service';

export type {
  TemplateValidationResult,
  TemplateRenderResult,
} from './services/templating/template.service';

// Re-export JS expression evaluator (pluggable backend for core.javascript / if_else / switch).
export {
  DirectEvaluator,
  HAS_EVAL,
  JsExpressionEvaluationError,
  needsAutoReturn,
} from './services/templating/evaluator';
export type {
  DirectEvaluatorOptions,
  JsExpressionEvaluator,
} from './services/templating/evaluator';
export {
  JsExpressionService,
  JsExpressionError,
  getJsExpressionService,
  createJsExpressionService,
  disposeJsExpressionService,
} from './services/templating/js-expression.service';
export type { JsExpressionServiceConfig } from './services/templating/js-expression.service';

// Re-export React Flow types
export type {
  ReactFlowNode,
  ReactFlowNodeData,
  ReactFlowEdge,
  ReactFlowData,
  TypedReactFlowData,
  NodeVisualStatus,
  NodeExecutionStatusInfo,
  Position,
} from './services/react-flow-renderer.service';

export * from './types/node-definition.types';

// Re-export layout utilities from @flowlib/layouts
export {
  applyDagreLayout,
  detectSkipEdges,
  applyVerticalOffsetForSkipEdges,
  applyMultiOutputBranchOffsets,
  applyIfElseBranchOffsets, // Deprecated alias for applyMultiOutputBranchOffsets
} from '@flowlib/layouts';

export type { LayoutNode, LayoutEdge, DagreLayoutOptions } from '@flowlib/layouts';

// =====================================
// New API (namespaced sub-APIs)
// =====================================
export { createFlowlib } from './api';
export type {
  FlowlibInstance,
  FlowlibMaintenanceOptions,
  FlowlibMaintenanceResult,
  FlowsAPI,
  FlowVersionsAPI,
  FlowRunsAPI,
  CredentialsAPI,
  TriggersAPI,
  AgentAPI,
  ChatAPI,
  ActionsAPI,
  TestingAPI,
  AuthAPI,
  PluginsAPI,
  MaintenanceAPI,
} from './api';
