/**
 * Chat Assistant Types
 *
 * Type definitions for the AI chat assistant feature.
 * These types define the streaming protocol, tool interface,
 * and context objects used across the chat system.
 */

import { z } from 'zod/v4';
import type { InvectIdentity } from 'src/types/auth.types';
import type { InvectInstance } from 'src/api/types';
import type { Logger } from 'src/schemas';

// =====================================
// CHAT MESSAGES
// =====================================

/**
 * A message in the chat conversation.
 * Compatible with both Anthropic and OpenAI message formats
 * after conversion via the existing adapter layer.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Tool calls made by the assistant */
  toolCalls?: ChatToolCall[];
  /** For tool result messages — references which tool call this is a result for */
  toolCallId?: string;
}

/**
 * A tool call from the LLM response
 */
export interface ChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// =====================================
// CHAT CONTEXT (sent by frontend)
// =====================================

/**
 * Context sent with each chat request.
 * The backend loads full flow data from the database — only IDs are needed.
 */
export interface ChatContext {
  /** Currently open flow ID (null/undefined if on home page) */
  flowId?: string;
  /** Currently selected node ID */
  selectedNodeId?: string;
  /** Currently selected flow run ID (when in runs view) */
  selectedRunId?: string;
  /** Current editor view mode */
  viewMode?: 'edit' | 'runs';
  /** Credential ID to use for the chat model (user override) */
  credentialId?: string;
  /** Per-request override for max tool-calling steps (1–50) */
  maxSteps?: number;
  /** Per-request model override (e.g. "claude-sonnet-4-20250514") */
  model?: string;
  /** Browser-local memory notes (sent from the frontend on each request) */
  memoryNotes?: {
    flowNotes?: string[];
    workspaceNotes?: string[];
  };
}

// =====================================
// CHAT TOOL INTERFACE
// =====================================

/**
 * Result returned by a chat tool execution
 */
export interface ChatToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorType?: string;
  suggestion?: string;
  /** Optional UI action to trigger on the frontend */
  uiAction?: { action: string; data: Record<string, unknown> };
}

/**
 * Per-flow record of the most recent `get_flow_source` call within the current
 * turn. Used by `edit_flow_source` / `write_flow_source` to enforce the
 * read-before-edit invariant and detect hash drift between reads and edits.
 *
 * Scope is per-session (i.e. per HTTP request). Because sessions are stateless
 * across requests, this survives only within a single assistant turn — which is
 * where the observed edit-loop failure mode lives.
 */
export interface ChatReadState {
  /** sha1 of the emitted source when `get_flow_source` succeeded. */
  hash: string;
  /** Tool-loop step index on which the read occurred. */
  readAtStep: number;
}

/**
 * Context provided to chat tool execute functions
 */
export interface ChatToolContext {
  /** The Invect core instance for accessing all services */
  flowlib: InvectInstance;
  /** The requesting user's identity (for RBAC) */
  identity?: InvectIdentity;
  /** Chat context from the frontend */
  chatContext: ChatContext;
  /**
   * Mutable per-session map keyed by `flowId`. `get_flow_source` populates it;
   * `edit_flow_source` / `write_flow_source` read and update it. Stays null
   * when no read-state tracking is wired (older callers).
   */
  readState?: Map<string, ChatReadState>;
  /**
   * Current tool-loop step index (1-based) when the tool executes. Used by
   * tools that need to reason about call order within a single turn.
   */
  currentStep?: number;
  /** Logger for structured telemetry from tools. */
  logger?: Logger;
}

/**
 * A single chat tool definition.
 * Tools have Zod schemas for parameter validation and an execute function.
 */
export interface ChatToolDefinition {
  /** Unique tool ID (snake_case) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description for the LLM to understand when/how to use this tool */
  description: string;
  /** Zod schema for parameter validation */
  parameters: z.ZodType;
  /** Execute the tool */
  execute: (params: unknown, ctx: ChatToolContext) => Promise<ChatToolResult>;
}

// =====================================
// CHAT STREAM EVENTS (yielded by core, serialized to SSE by framework adapters)
// =====================================

/**
 * Events yielded by the ChatStreamSession async generator.
 * Framework adapters (Express, NestJS, Next.js) serialize these to SSE.
 */
export type ChatStreamEvent =
  | { type: 'session'; sessionId: string; flowId?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolName: string; toolCallId: string; args: Record<string, unknown> }
  | { type: 'tool_call_result'; toolName: string; toolCallId: string; result: ChatToolResult }
  | { type: 'ui_action'; action: string; data: Record<string, unknown> }
  | {
      type: 'suggestions';
      suggestions: Array<{ label: string; prompt: string }>;
    }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done'; usage?: ChatUsage };

/**
 * Token usage information
 */
export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

// =====================================
// CHAT CONFIG
// =====================================

/**
 * Zod schema for chat configuration in InvectConfig.
 */
export const ChatConfigSchema = z.object({
  /** Credential ID for the default chat model (from credentials table) */
  credentialId: z.string().optional(),
  /** Default model identifier (e.g. "claude-3-5-haiku-20241022", "gpt-4o-mini") */
  defaultModel: z.string().optional(),
  /** Max tool-calling steps per message (default: 15) */
  maxSteps: z.number().min(1).max(50).default(15),
  /** Max message history to send to LLM (default: 20) */
  maxHistoryMessages: z.number().min(1).max(100).default(20),
  /** Whether chat is enabled (default: true) */
  enabled: z.boolean().default(true),
});

export type ChatConfig = z.infer<typeof ChatConfigSchema>;

/**
 * Resolved chat config with all defaults applied, plus runtime-resolved fields.
 */
export interface ResolvedChatConfig {
  credentialId?: string;
  model: string;
  maxSteps: number;
  maxHistoryMessages: number;
  enabled: boolean;
  /** Resolved provider type (determined from credential) */
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER';
  /** Decrypted API key (resolved from credential) */
  apiKey: string;
}
