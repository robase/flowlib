/**
 * Chat Stream Session
 *
 * Per-request streaming session that orchestrates the LLM conversation loop.
 * Implements the core streaming loop:
 *   1. Build system prompt with flow context
 *   2. Call LLM via existing adapters (Anthropic/OpenAI)
 *   3. On tool_use → execute tool → feed result back → continue
 *   4. Yield ChatStreamEvents as an async generator
 *
 * The session is stateless between requests — the frontend sends the full
 * message history with each POST. The session only holds per-request state
 * (draft accumulator, abort flag, usage counters).
 */

import type { Logger } from 'src/schemas';
import type { AgentMessage, AgentPromptResult } from 'src/types/agent-tool.types';
import type { ProviderAdapter } from '../ai/provider-adapter';
import type { FlowlibIdentity } from 'src/types/auth.types';
import type { FlowlibInstance } from 'src/api/types';
import type {
  ChatMessage,
  ChatContext,
  ChatReadState,
  ChatStreamEvent,
  ChatToolContext,
  ResolvedChatConfig,
  ChatUsage,
} from './chat-types';
import type { ChatToolkit } from './chat-toolkit';
import type { FlowContextData } from './system-prompt';
import { buildSystemPrompt } from './system-prompt';
import type { ActionRegistry } from 'src/actions';
import { classifyError } from '@flowlib/action-kit';

/**
 * Dependencies injected into the session from the ChatStreamService.
 */
export interface ChatStreamSessionDeps {
  logger: Logger;
  toolkit: ChatToolkit;
  config: ResolvedChatConfig;
  adapter: ProviderAdapter;
  identity?: FlowlibIdentity;
  /** The Flowlib core instance */
  flowlib: FlowlibInstance;
  /** Action registry for provider summary in system prompt */
  actionRegistry: ActionRegistry | null;
}

/** Check if an error is a rate-limit (429) error */
function isRateLimitError(error: unknown): boolean {
  return classifyError(error).code === 'RATE_LIMIT';
}

/**
 * Check if an error is a transient network failure worth retrying.
 *
 * Delegates to the shared classifier. Includes rate-limit, 5xx, connection
 * timeouts, and undici socket teardowns.
 */
function isTransientNetworkError(error: unknown): boolean {
  const code = classifyError(error).code;
  return code === 'NETWORK' || code === 'UPSTREAM_5XX' || code === 'TIMEOUT';
}

/** Check if an error was triggered by the caller aborting the request. */
function isAbortError(error: unknown): boolean {
  return classifyError(error).code === 'CANCELLED';
}

/**
 * Minimal producer/consumer queue to bridge the adapter's callback-driven
 * streaming with the session's async generator. The adapter pushes delta
 * events from its stream callbacks; the generator loop pulls them out in
 * order and yields them to the SSE framework adapter.
 */
class StreamEventQueue {
  private events: ChatStreamEvent[] = [];
  private waiter: ((e: ChatStreamEvent | null) => void) | null = null;
  private closed = false;

  push(event: ChatStreamEvent): void {
    if (this.closed) {
      return;
    }
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(event);
    } else {
      this.events.push(event);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }

  next(): Promise<ChatStreamEvent | null> {
    const pending = this.events.shift();
    if (pending) {
      return Promise.resolve(pending);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise<ChatStreamEvent | null>((resolve) => {
      this.waiter = resolve;
    });
  }
}

/**
 * A single chat streaming session (one per user message).
 */
/** Max consecutive source-edit failures before the session injects a correction
 *  message forcing the LLM to refresh / switch tools. See Phase 5 of
 *  plans/chat-assistant-edit-hardening.md. */
const MAX_CONSECUTIVE_EDIT_FAILURES = 3;

/** Tool IDs that count toward (and reset) the consecutive-failure counter. */
const EDIT_FAILURE_TOOLS = new Set(['edit_flow_source', 'write_flow_source']);

/** Reset the failure counter when any of these tools succeed, or when a
 *  successful `get_flow_source` happens. */
const FAILURE_RESET_TOOLS = new Set(['get_flow_source', 'update_node_config']);

export class ChatStreamSession {
  private aborted = false;
  private usage: ChatUsage = {};
  /** Track which tool IDs were called during this session */
  private toolsCalled: string[] = [];
  /**
   * Per-turn read-before-edit tracking. Populated by `get_flow_source`, read
   * and updated by `edit_flow_source` / `write_flow_source`. Keyed by `flowId`.
   */
  private readonly readState: Map<string, ChatReadState> = new Map();
  /** Consecutive failed source-edit calls without an intervening read/success. */
  private consecutiveEditFailures = 0;

  constructor(private readonly deps: ChatStreamSessionDeps) {}

  /**
   * Main streaming loop — yields ChatStreamEvents.
   *
   * Framework adapters consume this and write SSE frames:
   * ```typescript
   * for await (const event of session.stream(messages, context)) {
   *   res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
   * }
   * ```
   */
  async *stream(
    messages: ChatMessage[],
    context: ChatContext,
    flowContext: FlowContextData | null,
  ): AsyncGenerator<ChatStreamEvent> {
    const { logger, toolkit, config, adapter } = this.deps;

    try {
      // 1. Build system prompt with dynamic context
      const systemPrompt = buildSystemPrompt({
        flowContext,
        actionRegistry: this.deps.actionRegistry,
      });

      // 2. Truncate message history
      const truncatedMessages = this.truncateHistory(messages, config.maxHistoryMessages);

      const toolDefs = toolkit.getToolDefinitions();

      // 4. Convert ChatMessages to AgentMessages for the adapter
      const conversationMessages = this.toAgentMessages(truncatedMessages);

      let steps = 0;

      while (steps < config.maxSteps && !this.aborted) {
        steps++;

        logger.debug(`Chat stream step ${steps}/${config.maxSteps}`, {
          messageCount: conversationMessages.length,
          toolCount: toolDefs.length,
        });

        // 5. Call the LLM via the existing adapter (with retry on transient
        //    network errors and rate-limits). The adapter streams text and
        //    reasoning deltas into `queue` as they arrive; we drain the queue
        //    concurrently with the adapter promise and yield each delta out
        //    to the SSE framework so the UI updates token-by-token.
        //    AbortError short-circuits the retry loop since it means the
        //    caller asked us to stop.
        let response: AgentPromptResult | undefined;
        const MAX_RETRIES = 3;
        let lastError: unknown;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const queue = new StreamEventQueue();
          const promise = adapter
            .executeAgentPrompt({
              model: config.model,
              messages: conversationMessages,
              tools: toolDefs,
              systemPrompt,
              maxTokens: 8192,
              thinking: { enabled: true, effort: 'medium' },
              onTextDelta: (text) => queue.push({ type: 'text_delta', text }),
              onReasoningDelta: (text) => queue.push({ type: 'reasoning_delta', text }),
            })
            .finally(() => queue.close());

          try {
            // Drain deltas until the queue closes (adapter has resolved/rejected).
            while (true) {
              const event = await queue.next();
              if (event === null) {
                break;
              }
              yield event;
            }
            // Surface the final result (or re-throw the adapter's error).
            response = await promise;
            lastError = undefined;
            break;
          } catch (error: unknown) {
            lastError = error;
            // Ensure any stragglers from a half-consumed queue don't leak into
            // the next attempt.
            queue.close();

            if (isAbortError(error) || this.aborted) {
              logger.debug('Chat stream aborted during LLM call');
              return;
            }

            const retryable = isRateLimitError(error) || isTransientNetworkError(error);
            if (retryable && attempt < MAX_RETRIES) {
              const delayMs = Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s, 8s
              const delaySec = Math.round(delayMs / 1000);
              const reason = isRateLimitError(error) ? 'Rate limited' : 'Connection error';
              const userLabel = isRateLimitError(error)
                ? 'Rate limited by the AI provider'
                : 'Connection to the AI provider was interrupted';
              logger.warn(
                `${reason} on chat step ${steps}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
                { error: error instanceof Error ? error.message : String(error) },
              );
              yield {
                type: 'text_delta',
                text: `\n\n⏳ *${userLabel} — retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})…*\n\n`,
              };
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              continue;
            }

            const msg = error instanceof Error ? error.message : String(error);
            logger.error('LLM call failed in chat stream:', { error: msg });
            yield { type: 'error', message: `LLM call failed: ${msg}`, recoverable: false };
            return;
          }
        }

        if (lastError || !response) {
          const msg =
            lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
          logger.error('LLM call failed after retries:', { error: msg });
          yield { type: 'error', message: `LLM call failed: ${msg}`, recoverable: false };
          return;
        }

        // 6. Text and reasoning content already yielded as deltas during the
        //    stream. No need to re-yield the final buffer.

        // 7. If no tool calls, we're done
        if (response.type !== 'tool_use' || !response.toolCalls?.length) {
          break;
        }

        // 8. Execute tool calls and collect results
        const toolResults: Array<{
          id: string;
          toolId: string;
          input: Record<string, unknown>;
          result: Awaited<ReturnType<typeof toolkit.executeTool>>;
        }> = [];

        for (const toolCall of response.toolCalls) {
          if (this.aborted) {
            break;
          }

          yield {
            type: 'tool_call_start',
            toolName: toolCall.toolId,
            toolCallId: toolCall.id,
            args: toolCall.input,
          };

          // Build tool context — includes per-turn read-state and logger so
          // source-editing tools can enforce the read-before-edit invariant
          // and emit structured failure telemetry.
          const toolCtx: ChatToolContext = {
            flowlib: this.deps.flowlib,
            identity: this.deps.identity,
            chatContext: context,
            readState: this.readState,
            currentStep: steps,
            logger,
          };

          // Execute tool
          const result = await toolkit.executeTool(toolCall.toolId, toolCall.input, toolCtx);

          yield {
            type: 'tool_call_result',
            toolName: toolCall.toolId,
            toolCallId: toolCall.id,
            result,
          };

          // Emit UI action if tool requested one
          if (result.uiAction) {
            yield {
              type: 'ui_action',
              action: result.uiAction.action,
              data: result.uiAction.data,
            };
          }

          // Update consecutive-failure counter for source-editing tools.
          // A success on any source-edit call OR a successful read/structured
          // update resets the counter.
          if (EDIT_FAILURE_TOOLS.has(toolCall.toolId)) {
            if (result.success) {
              this.consecutiveEditFailures = 0;
            } else {
              this.consecutiveEditFailures++;
            }
          } else if (FAILURE_RESET_TOOLS.has(toolCall.toolId) && result.success) {
            this.consecutiveEditFailures = 0;
          }

          toolResults.push({
            id: toolCall.id,
            toolId: toolCall.toolId,
            input: toolCall.input,
            result,
          });
          this.toolsCalled.push(toolCall.toolId);
        }

        // Append ONE assistant message with ALL tool calls (correct protocol
        // for both Anthropic and OpenAI — avoids duplicated assistant content)
        if (toolResults.length > 0) {
          conversationMessages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: toolResults.map((t) => ({
              id: t.id,
              toolId: t.toolId,
              input: t.input,
            })),
          });

          // Append one tool-result message per call
          for (const t of toolResults) {
            conversationMessages.push({
              role: 'tool',
              content: JSON.stringify(t.result),
              toolCallId: t.id,
            });
          }

          // Loop-breaker: if the LLM has failed N consecutive source edits,
          // inject a user-role correction message so it can't keep retrying
          // the same failing call. Reset the counter so we only interject once
          // per streak.
          if (this.consecutiveEditFailures >= MAX_CONSECUTIVE_EDIT_FAILURES) {
            logger.warn(
              `Chat assistant hit ${this.consecutiveEditFailures} consecutive edit failures — injecting correction message`,
              { sessionStep: steps },
            );
            conversationMessages.push({
              role: 'user',
              content:
                `You have failed ${this.consecutiveEditFailures} consecutive source-edit calls. ` +
                `Stop retrying \`edit_flow_source\` / \`write_flow_source\` with new guesses. ` +
                `Call \`get_flow_source\` to refresh the source, and check \`availableReferenceIds\` ` +
                `in the most recent failure payload — if the node you want to edit isn't listed, it ` +
                `does not exist in this flow. For single-node changes prefer \`update_node_config\`.`,
            });
            this.consecutiveEditFailures = 0;
          }
        }
      }

      // If we hit the step limit, let the user know
      if (steps >= config.maxSteps && !this.aborted) {
        yield {
          type: 'text_delta',
          text:
            '\n\n---\n' +
            `⚠️ I've reached the maximum number of steps (${config.maxSteps}) for a single message. ` +
            'You can send another message to continue where I left off.',
        };
      }

      // Emit contextual suggestions based on what tools were called
      if (!this.aborted) {
        const suggestions = this.generateSuggestions(context);
        if (suggestions.length > 0) {
          yield { type: 'suggestions', suggestions };
        }
      }

      // Yield completion event
      yield { type: 'done', usage: this.usage };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Chat stream session error:', { error: msg });
      yield { type: 'error', message: msg, recoverable: false };
    }
  }

  /**
   * Abort the stream (called when client disconnects or user clicks Stop).
   */
  abort(): void {
    this.aborted = true;
  }

  // =====================================
  // SUGGESTION GENERATION
  // =====================================

  /**
   * Generate contextual follow-up suggestions based on the tools that were called.
   * Returns 2-3 relevant suggestions as clickable chips.
   */
  private generateSuggestions(_context: ChatContext): Array<{ label: string; prompt: string }> {
    const tools = new Set(this.toolsCalled);
    const suggestions: Array<{ label: string; prompt: string }> = [];

    // After flow modifications (add/update nodes, update_flow_definition)
    const modifiedFlow =
      tools.has('add_node') ||
      tools.has('update_flow_definition') ||
      tools.has('update_node_config') ||
      tools.has('add_edge') ||
      tools.has('remove_node');

    if (modifiedFlow) {
      if (!tools.has('validate_flow')) {
        suggestions.push({
          label: '✅ Validate flow',
          prompt: 'Validate the flow and check for any issues.',
        });
      }
      if (!tools.has('run_flow')) {
        suggestions.push({
          label: '▶ Test run',
          prompt: 'Run the flow with sample data to test it.',
        });
      }
      return suggestions.slice(0, 3);
    }

    // After running a flow
    if (tools.has('run_flow')) {
      suggestions.push({
        label: '📊 Show results',
        prompt: 'Show me the detailed execution results.',
      });
      suggestions.push({
        label: '🔧 Improve flow',
        prompt: 'Suggest improvements to this flow.',
      });
      return suggestions.slice(0, 3);
    }

    // After debugging (inspecting runs/executions)
    if (tools.has('get_flow_run') || tools.has('get_node_execution_results')) {
      suggestions.push({
        label: '🔧 Fix the issue',
        prompt: 'Apply the fix for the issue you found.',
      });
      suggestions.push({
        label: '🔄 Re-run flow',
        prompt: 'Re-run the flow to see if it works now.',
      });
      return suggestions.slice(0, 3);
    }

    // After searching actions (exploring what's available)
    if (tools.has('search_actions') || tools.has('list_providers')) {
      suggestions.push({
        label: '➕ Add to flow',
        prompt: 'Add the action we found to the flow.',
      });
      return suggestions.slice(0, 3);
    }

    // After creating a plan
    if (tools.has('set_plan')) {
      suggestions.push({
        label: '✅ Execute plan',
        prompt: 'Looks good — go ahead and execute the plan.',
      });
      return suggestions.slice(0, 3);
    }

    return [];
  }

  // =====================================
  // PRIVATE HELPERS
  // =====================================

  /**
   * Truncate message history to keep within token budget.
   *
   * Uses a two-pass approach:
   *   1. Cap at maxMessages (coarse — prevents runaway message counts)
   *   2. Estimate tokens and drop oldest messages until under TOKEN_BUDGET
   *
   * Token estimation uses ~4 chars per token (reasonable for English + JSON).
   * Tool result messages tend to be large, so this prevents a few big tool
   * results from consuming the entire context window.
   */
  private truncateHistory(messages: ChatMessage[], maxMessages: number): ChatMessage[] {
    if (messages.length <= 2) {
      return messages;
    }

    // Pass 1: cap by message count
    const truncated = messages.length > maxMessages ? messages.slice(-maxMessages) : [...messages];

    // Pass 2: token-budget-based truncation
    // ~4 chars per token. 100K token cap leaves room for system prompt + tool defs.
    const TOKEN_BUDGET = 100_000;
    const estimateMessageTokens = (m: ChatMessage) =>
      Math.ceil((m.content?.length ?? 0) / 4) +
      (m.toolCalls ? Math.ceil(JSON.stringify(m.toolCalls).length / 4) : 0);

    let totalTokens = truncated.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

    // Drop oldest messages until under budget, keeping at least the last 2
    while (totalTokens > TOKEN_BUDGET && truncated.length > 2) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- array length checked in while condition
      const removed = truncated.shift()!;
      totalTokens -= estimateMessageTokens(removed);
    }

    if (truncated.length < messages.length) {
      this.deps.logger.debug(
        `Truncated chat history from ${messages.length} to ${truncated.length} messages (~${totalTokens} est. tokens)`,
      );
    }

    return truncated;
  }

  /**
   * Convert ChatMessage[] to AgentMessage[] for the existing adapters.
   * The adapters expect AgentMessage format.
   */
  private toAgentMessages(messages: ChatMessage[]): AgentMessage[] {
    return messages
      .filter((m) => m.role !== 'system') // System prompt is passed separately
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCalls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          toolId: tc.name,
          input: tc.input,
        })),
        toolCallId: m.toolCallId,
      }));
  }
}
