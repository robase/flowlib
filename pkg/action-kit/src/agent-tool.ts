/**
 * Agent-tool types — the shape the agent tool registry and LLM tool-call
 * loop consume. Action authors don't usually touch these; the registry
 * builds them from `ActionDefinition`s.
 */

import type { Logger } from './logger';

export type AgentToolCategory = 'data' | 'web' | 'code' | 'utility' | 'custom';

/** Default timeout for tool execution (30 seconds) */
export const DEFAULT_TOOL_TIMEOUT_MS = 30000;

/** Default max tokens for conversation history (approximate) */
export const DEFAULT_MAX_CONVERSATION_TOKENS = 500000;

/**
 * Approximate tokens per character by provider family.
 */
export const TOKENS_PER_CHAR_BY_PROVIDER: Record<string, number> = {
  OPENAI: 0.25,
  ANTHROPIC: 0.3,
  OPENROUTER: 0.28,
};
export const DEFAULT_TOKENS_PER_CHAR = 0.3;

/** @deprecated Use TOKENS_PER_CHAR_BY_PROVIDER. */
export const APPROX_TOKENS_PER_CHAR = 0.25;

export interface AgentToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: AgentToolCategory;
  tags?: string[];
  enabledByDefault?: boolean;
  timeoutMs?: number;
  nodeType?: string;
  provider?: {
    id: string;
    name: string;
    icon: string;
    svgIcon?: string;
  };
}

export interface AddedToolInstance {
  instanceId: string;
  toolId: string;
  name: string;
  description: string;
  params: Record<string, unknown> & {
    _aiChosenModes?: Record<string, boolean>;
  };
}

/**
 * Generate a tool instance ID in the canonical `tool_XXXXXXXX` format used by
 * seeds, the chat-driven agent config, and the editor's tool panel. Centralized
 * so every entry point that creates an `AddedToolInstance` produces the same
 * shape — makes grep-across-logs and test fixtures interchangeable.
 */
export function newToolInstanceId(): string {
  return 'tool_' + Math.random().toString(36).slice(2, 10);
}

export interface ConfiguredToolDefinition extends AgentToolDefinition {
  instanceId: string;
  staticParams: Record<string, unknown>;
  baseToolId: string;
}

/**
 * Tool-execution context provided to tool handlers.
 *
 * `TNodeContext` is parameterized so hosts can supply their own concrete
 * `NodeExecutionContext` type. In this package it defaults to `unknown`
 * — the action executor downcasts at the boundary.
 */
export interface AgentToolExecutionContext<TNodeContext = unknown> {
  logger: Logger;
  iteration: number;
  maxIterations: number;
  nodeContext: TNodeContext;
  staticParams?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AgentToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export type AgentToolExecutor<TNodeContext = unknown> = (
  input: Record<string, unknown>,
  context: AgentToolExecutionContext<TNodeContext>,
) => Promise<AgentToolResult>;

export interface RegisteredAgentTool<TNodeContext = unknown> {
  definition: AgentToolDefinition;
  executor: AgentToolExecutor<TNodeContext>;
}

export interface AgentToolCall {
  id: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionRecord {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  success: boolean;
  iteration: number;
  executionTimeMs: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
}

export type AgentStopCondition = 'tool_result' | 'explicit_stop' | 'max_iterations';
export type AgentFinishReason = 'completed' | 'max_iterations' | 'tool_result' | 'error';

export interface AgentPromptResult {
  type: 'text' | 'tool_use';
  content: string;
  /** Accumulated reasoning / thinking content if the model emitted any. */
  reasoning?: string;
  toolCalls?: AgentToolCall[];
  /**
   * Provider-reported token usage for this single call. Optional because
   * not every provider/transport surfaces usage (e.g. some streaming
   * variants), and because batch-submitted responses report usage later.
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentPromptRequest {
  model: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
  parallelToolCalls?: boolean;
}

export interface AgentExecutionOutput {
  finalResponse: string;
  toolResults: ToolExecutionRecord[];
  iterations: number;
  finishReason: AgentFinishReason;
  conversationHistory: AgentMessage[];
  tokenUsage?: {
    conversationTokensEstimate: number;
    truncationOccurred: boolean;
    /**
     * Provider-reported input/output tokens summed across all LLM calls
     * the agent made during this loop. Absent when the provider didn't
     * surface usage on any iteration (e.g. some streaming transports).
     */
    inputTokens?: number;
    outputTokens?: number;
  };
}
