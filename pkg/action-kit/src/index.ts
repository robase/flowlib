/**
 * `@flowlib/action-kit` — types-only package defining the Flowlib action
 * authoring surface.
 *
 * Consumed by `@flowlib/core`, `@flowlib/actions`, and runtime plugins so they
 * can speak the same type language without pulling the action catalogue.
 */

// Core action types
export type {
  ActionDefinition,
  ActionExecutionContext,
  ActionOutputDef,
  ActionResult,
  ActionCategory,
  ActionRetryConfig,
  ProviderDef,
  ProviderCategory,
  CredentialRequirement,
  ParamField,
  ActionConfigUpdateContext,
  ActionConfigUpdateEvent,
  ActionConfigUpdateResponse,
  LoadOptionsContext,
  LoadOptionsConfig,
  LoadOptionsResult,
  FieldHelperSpec,
  ActionLoader,
} from './action';

// Credential
export type { ActionCredential } from './action-credential';

// Logger
export type { Logger } from './logger';

// Evaluator
export type { JsExpressionEvaluator } from './evaluator';
export { JsExpressionError, JsExpressionEvaluationError } from './evaluator';

// Services (structural)
export type { ActionCredentialsService, ActionAIClient } from './services';

// Node definition types
export type { NodeDefinition, NodeHandleDefinition, NodeParamField, NodeCategory } from './node';

// Agent tool types
export type {
  AgentToolDefinition,
  AgentToolCategory,
  AgentToolExecutionContext,
  AgentToolResult,
  AgentToolExecutor,
  AgentToolCall,
  AgentMessage,
  AgentStopCondition,
  AgentFinishReason,
  AgentPromptResult,
  AgentPromptRequest as AgentPromptRequestBasic,
  AgentExecutionOutput,
  AddedToolInstance,
  ConfiguredToolDefinition,
  RegisteredAgentTool,
  ToolExecutionRecord,
} from './agent-tool';
export {
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_CONVERSATION_TOKENS,
  TOKENS_PER_CHAR_BY_PROVIDER,
  DEFAULT_TOKENS_PER_CHAR,
  APPROX_TOKENS_PER_CHAR,
  newToolInstanceId,
} from './agent-tool';

// Flow graph (structural)
export type { FlowEdge, FlowNodeDefinitions } from './flow';

// Node execution (runtime result shapes + structural executor context)
export { NodeExecutionStatus, FlowRunStatus } from './node-execution';
export type {
  NodeExecutionResult,
  NodeExecutionFailedResult,
  NodeExecutionPendingResult,
  NodeExecutionSuccessResult,
  NodeOutput,
  StructuredOutput,
  OutputVariable,
  OutputVariables,
  NodeErrorCode,
  NodeErrorDetails,
} from './node-execution';
export type { NodeExecutionContext } from './node-executor-context';

// Error classifier
export { classifyError, DEFAULT_RETRYABLE_ERROR_CODES } from './error-classifier';

// AI types (enums + request/result shapes)
export { BatchProvider, AIProvider, BatchStatus } from './ai-types';
export type {
  Model,
  PromptResult,
  AgentPromptRequest,
  BatchSubmissionResult,
  BatchResult,
  BatchPollResult,
} from './ai-types';

// Prompt / submission shapes
export type {
  SubmitPromptRequest,
  SubmitAgentPromptRequest,
  SubmitPromptResult,
  SubmitAgentPromptResult,
  PromptRequest,
  BatchRequest,
  RecordToolExecutionInput,
} from './prompt';

// Helpers
export { defineAction } from './define-action';
export type { ActionHelper, HandleIdsOf } from './define-action';

// Lazy action loading (edge-runtime bundle size)
export type { LazyActionDefinition } from './lazy-action';

// SDK node types (produced by action helpers)
export type { SdkFlowNode, NodeOptions, MapperOptions } from './sdk-node';
