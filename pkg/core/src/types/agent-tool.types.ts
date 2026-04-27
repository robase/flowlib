/**
 * Agent Tool Types — thin wrapper that re-exports from `@flowlib/action-kit`
 * and specialises `AgentToolExecutionContext` / `AgentToolExecutor` /
 * `RegisteredAgentTool` with core's concrete `NodeExecutionContext`.
 */

import type { NodeExecutionContext } from 'src/types.internal';
import type {
  AgentToolExecutionContext as AgentToolExecutionContextGeneric,
  AgentToolExecutor as AgentToolExecutorGeneric,
  RegisteredAgentTool as RegisteredAgentToolGeneric,
} from '@flowlib/action-kit';

export type {
  AgentToolCategory,
  AgentToolDefinition,
  AgentToolResult,
  AgentToolCall,
  AddedToolInstance,
  ConfiguredToolDefinition,
  AgentMessage,
  AgentStopCondition,
  AgentFinishReason,
  AgentPromptResult,
  AgentPromptRequestBasic as AgentPromptRequest,
  AgentExecutionOutput,
  ToolExecutionRecord,
} from '@flowlib/action-kit';

export {
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_CONVERSATION_TOKENS,
  TOKENS_PER_CHAR_BY_PROVIDER,
  DEFAULT_TOKENS_PER_CHAR,
  APPROX_TOKENS_PER_CHAR,
  newToolInstanceId,
} from '@flowlib/action-kit';

/**
 * Concrete tool-execution context — narrows action-kit's generic
 * `AgentToolExecutionContext` to core's `NodeExecutionContext`.
 */
export type AgentToolExecutionContext = AgentToolExecutionContextGeneric<NodeExecutionContext>;

export type AgentToolExecutor = AgentToolExecutorGeneric<NodeExecutionContext>;

export type RegisteredAgentTool = RegisteredAgentToolGeneric<NodeExecutionContext>;
