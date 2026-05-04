/**
 * AI service types shared between action-kit, core, and runtime hosts.
 */

import type { AgentMessage, AgentToolDefinition } from './agent-tool';

export enum BatchProvider {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  OPENROUTER = 'OPENROUTER',
}

export enum AIProvider {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  OPENROUTER = 'OPENROUTER',
}

export enum BatchStatus {
  SUBMITTED = 'SUBMITTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface Model {
  id: string;
  name?: string;
  created?: number;
  provider?: string;
  contextLength?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
}

export type PromptResult = { value: object; type: 'object' } | { value: string; type: 'string' };

/** Agent prompt request shared between action-kit and core. */
export interface AgentPromptRequest {
  model: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
  parallelToolCalls?: boolean;
  /** Abort signal to cancel an in-flight request (e.g. client disconnect). */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds. Overrides adapter default. */
  timeoutMs?: number;
  /**
   * Request extended reasoning / "thinking" tokens when the model supports it.
   * Adapters silently no-op when unsupported so callers can always pass this.
   */
  thinking?: {
    enabled: boolean;
    /**
     * Soft budget in tokens for the thinking block (Anthropic).
     * Mapped to `reasoning.max_tokens` on OpenRouter. Ignored by providers
     * that only accept effort levels.
     */
    budgetTokens?: number;
    /**
     * Effort level for providers that use qualitative knobs (OpenAI o-series,
     * OpenRouter generic). Mapped heuristically to `budgetTokens` elsewhere.
     */
    effort?: 'low' | 'medium' | 'high';
  };
  /** Called with incremental assistant text as the stream arrives. */
  onTextDelta?: (text: string) => void;
  /** Called with incremental reasoning / thinking text as the stream arrives. */
  onReasoningDelta?: (text: string) => void;
}

export interface BatchSubmissionResult {
  externalBatchId: string;
}

export type BatchResult =
  | {
      batchId: string;
      status: BatchStatus.COMPLETED;
      content: PromptResult;
      /**
       * Provider-reported token usage for the batched request. Optional
       * because some batch result line items may not carry usage (e.g.
       * malformed responses, older API surfaces). Hosts use this to meter
       * llmTokens consumption for batch-resumed nodes — see the resumption
       * path in flow-orchestration/flow-run-coordinator.ts.
       */
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { batchId: string; status: BatchStatus.FAILED | BatchStatus.CANCELLED; error: string }
  | { batchId: string; status: BatchStatus.SUBMITTED | BatchStatus.PROCESSING };

export interface BatchPollResult {
  status: BatchStatus;
  result?: BatchResult[];
  completedRequests?: number;
  totalRequests?: number;
  failedRequests?: number;
  error?: string;
}
