/**
 * Anthropic Provider Adapter
 *
 * Handles Anthropic-specific message formats, tool schemas, and API calls.
 * Uses streaming by default to avoid timeout warnings.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Logger } from 'src/schemas';
import {
  AgentToolDefinition,
  AgentMessage,
  AgentPromptResult,
  AgentToolCall,
} from 'src/types/agent-tool.types';
import { BatchRequest, PromptRequest } from '../node-data.service';
import {
  AgentPromptRequest,
  BatchPollResult,
  BatchStatus,
  BatchSubmissionResult,
  BatchResult,
  Model,
  PromptResult,
} from './ai-types';
import { BaseProviderAdapter, ProviderCapabilities } from './provider-adapter';

/**
 * The usage fields this adapter reads off streaming events. Narrower than
 * `Anthropic.Usage` because the SSE events type `usage` loosely (partial on
 * `message_delta`), so the stream is cast to this rather than the full shape.
 */
type AnthropicUsageShape = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Anthropic Provider Adapter
 */
export class AnthropicAdapter extends BaseProviderAdapter {
  get providerId(): string {
    return 'ANTHROPIC';
  }

  get defaultModel(): string {
    return this.defaultModelOverride || 'claude-sonnet-4-6';
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutput: false, // Anthropic uses tool-based structured output
      supportsBatch: true,
      supportsJsonMode: false,
    };
  }

  private client: Anthropic;

  /** Default per-request timeout for agent prompts. */
  private readonly defaultAgentTimeoutMs = 10 * 60 * 1000; // 10 minutes

  constructor(logger: Logger, apiKey: string, defaultModelOverride?: string) {
    super(logger, apiKey, defaultModelOverride);
    this.validateApiKey();

    this.client = new Anthropic({
      apiKey: this.apiKey,
      maxRetries: 3, // Retry on 429 (rate limit), 500, 503 with exponential backoff
      timeout: this.defaultAgentTimeoutMs,
    });
  }

  /**
   * Convert AgentToolDefinition[] to Anthropic tool format
   */
  convertTools(tools: AgentToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  /**
   * Convert AgentMessage[] to Anthropic message format
   */
  convertMessages(messages: AgentMessage[], _systemPrompt?: string): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Assistant message with tool calls
          const content: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content } as Anthropic.TextBlock);
          }
          for (const toolCall of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.toolId,
              input: toolCall.input,
            } as Anthropic.ToolUseBlock);
          }
          result.push({ role: 'assistant', content });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool' && msg.toolCallId) {
        // Tool result message - Anthropic expects this as a user message with tool_result content
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        });
      }
    }

    return result;
  }

  /**
   * Build tool_choice parameter for Anthropic
   */
  buildToolChoice(
    choice: 'auto' | 'none' | { type: 'tool'; name: string } | undefined,
    hasTools: boolean,
  ): Anthropic.ToolChoice | undefined {
    if (!hasTools) {
      return undefined;
    }

    if (choice === 'none') {
      // Anthropic doesn't have a "none" option - just don't include tools
      return undefined;
    } else if (choice && typeof choice === 'object') {
      return { type: 'tool', name: choice.name };
    }
    return { type: 'auto' };
  }

  /**
   * Execute agent prompt with tools (streaming)
   */
  async executeAgentPrompt(request: AgentPromptRequest): Promise<AgentPromptResult> {
    this.logger.debug('Running Anthropic agent prompt with tools', {
      model: request.model,
      toolCount: request.tools.length,
      messageCount: request.messages.length,
    });

    try {
      const anthropicMessages = this.convertMessages(request.messages);
      const tools = this.convertTools(request.tools);

      const contract = this.thinkingContract(request.model);
      const thinkingEnabled = request.thinking?.enabled === true && contract !== 'none';
      const budgetTokens = this.resolveThinkingBudget(request.thinking);
      // Extended thinking requires max_tokens > budget_tokens; adaptive has no budget.
      const baseMaxTokens = request.maxTokens || 4096;
      const maxTokens =
        thinkingEnabled && contract === 'budget'
          ? Math.max(baseMaxTokens, budgetTokens + 4096)
          : baseMaxTokens;

      const params: Anthropic.MessageCreateParams = {
        model: request.model,
        max_tokens: maxTokens,
        system: request.systemPrompt,
        messages: anthropicMessages,
        tools: tools.length > 0 ? tools : undefined,
        // Automatic prompt caching. The agent loop resends the whole
        // conversation on every iteration, so each tool round-trip re-pays for
        // the tool defs + system prompt + all prior turns. Top-level
        // `cache_control` puts the breakpoint on the last cacheable block and
        // moves it forward as the conversation grows, so iteration N+1 reads
        // back everything iteration N wrote.
        //
        // Safe when it doesn't pay off: prompts under the model's minimum
        // (1024 tokens for most, 4096 for Opus 4.5/4.6 and Haiku 4.5) are
        // silently not cached rather than erroring. The one cost is a
        // single-iteration run with a large prefix, which takes a 1.25x write
        // it never reads back.
        cache_control: { type: 'ephemeral' },
      };

      if (this.modelAcceptsSampling(request.model)) {
        // Extended thinking requires temperature === 1 on the models that take it.
        params.temperature = thinkingEnabled ? 1 : request.temperature;
      }

      if (thinkingEnabled && contract === 'adaptive') {
        params.thinking = { type: 'adaptive' };
        params.output_config = { effort: request.thinking?.effort ?? 'medium' };
      } else if (thinkingEnabled) {
        params.thinking = { type: 'enabled', budget_tokens: budgetTokens };
      }

      // Set tool_choice
      if (tools.length > 0) {
        const toolChoice = this.buildToolChoice(request.toolChoice, true);
        if (toolChoice) {
          params.tool_choice = toolChoice;
        }
      }

      // Use streaming for agent prompts
      const stream = await this.client.messages.create(
        {
          ...params,
          stream: true,
        },
        {
          signal: request.signal,
          timeout: request.timeoutMs ?? this.defaultAgentTimeoutMs,
        },
      );

      return await this.parseStreamingResponse(stream, request);
    } catch (error) {
      this.logger.error('Anthropic agent prompt failed:', error);
      throw error;
    }
  }

  /**
   * How a model wants reasoning configured. Anthropic changed the contract
   * mid-generation, and the two forms are mutually exclusive:
   *
   *  - `adaptive` — `thinking: { type: 'adaptive' }` + `output_config.effort`.
   *    The model decides depth per request. Opus 4.6+ and Sonnet 5 / Fable 5.
   *    These reject `budget_tokens` with a 400.
   *  - `budget`   — `thinking: { type: 'enabled', budget_tokens: N }`.
   *    Opus 4.0/4.1/4.5, Sonnet 4.0/4.5, Haiku 4.5, 3.7 Sonnet.
   *  - `none`     — no reasoning support; sending `thinking` is a 400.
   *
   * Ordering matters: `claude-sonnet-4-6` also matches a bare
   * `claude-sonnet-4` prefix, so the adaptive checks run first.
   */
  private thinkingContract(model: string): 'adaptive' | 'budget' | 'none' {
    const m = model.toLowerCase();
    if (
      m.startsWith('claude-fable-') ||
      m.startsWith('claude-mythos-') ||
      m.startsWith('claude-sonnet-5') ||
      m.startsWith('claude-opus-4-6') ||
      m.startsWith('claude-opus-4-7') ||
      m.startsWith('claude-opus-4-8') ||
      m.startsWith('claude-sonnet-4-6')
    ) {
      return 'adaptive';
    }
    if (
      m.startsWith('claude-opus-4') ||
      m.startsWith('claude-sonnet-4') ||
      m.startsWith('claude-haiku-4') ||
      m.startsWith('claude-3-7-sonnet')
    ) {
      return 'budget';
    }
    return 'none';
  }

  /**
   * `temperature` / `top_p` / `top_k` were removed on the newest models — they
   * 400 rather than being ignored, so the parameter must be omitted entirely.
   * Opus 4.6 and Sonnet 4.6 still accept sampling despite being adaptive.
   */
  private modelAcceptsSampling(model: string): boolean {
    const m = model.toLowerCase();
    return !(
      m.startsWith('claude-fable-') ||
      m.startsWith('claude-mythos-') ||
      m.startsWith('claude-sonnet-5') ||
      m.startsWith('claude-opus-4-7') ||
      m.startsWith('claude-opus-4-8')
    );
  }

  /** Translate `effort` levels to a concrete budget for `budget`-contract models. */
  private resolveThinkingBudget(thinking?: AgentPromptRequest['thinking']): number {
    if (thinking?.budgetTokens && thinking.budgetTokens > 0) {
      return Math.max(1024, Math.floor(thinking.budgetTokens));
    }
    switch (thinking?.effort) {
      case 'low':
        return 2048;
      case 'high':
        return 12000;
      case 'medium':
      default:
        return 6000;
    }
  }

  /**
   * Parse streaming response into AgentPromptResult.
   *
   * Emits incremental text and thinking deltas via the request callbacks
   * as they arrive, and returns the aggregated final shape once the stream
   * completes.
   */
  private async parseStreamingResponse(
    stream: AsyncIterable<Anthropic.MessageStreamEvent>,
    request: AgentPromptRequest,
  ): Promise<AgentPromptResult> {
    let fullContent = '';
    let reasoningContent = '';
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    let cacheCreationTokens: number | undefined;
    const toolCalls: AgentToolCall[] = [];

    for await (const chunk of stream) {
      // Usage capture. Anthropic emits `message_start` with `message.usage.input_tokens`
      // (final input total) and `output_tokens` set to a small initial value, then
      // `message_delta` events whose `usage.output_tokens` is the running cumulative
      // total. Last-write-wins on output, first-non-zero wins on input.
      const evt = chunk as
        | { type: 'message_start'; message: { usage?: AnthropicUsageShape } }
        | { type: 'message_delta'; usage?: AnthropicUsageShape }
        | typeof chunk;
      if (evt.type === 'message_start') {
        const u = (evt as { message: { usage?: AnthropicUsageShape } }).message.usage;
        if (u) {
          inputTokens = u.input_tokens ?? inputTokens;
          outputTokens = u.output_tokens ?? outputTokens;
          cacheReadTokens = u.cache_read_input_tokens ?? cacheReadTokens;
          cacheCreationTokens = u.cache_creation_input_tokens ?? cacheCreationTokens;
        }
      } else if (evt.type === 'message_delta') {
        const u = (evt as { usage?: AnthropicUsageShape }).usage;
        if (u) {
          if (u.input_tokens !== undefined) {
            inputTokens = u.input_tokens;
          }
          if (u.output_tokens !== undefined) {
            outputTokens = u.output_tokens;
          }
          // `??` rather than an explicit-undefined check: the API types these
          // as `number | null`, and a null means "no cache activity" — same as
          // absent, so both should leave any earlier value alone.
          cacheReadTokens = u.cache_read_input_tokens ?? cacheReadTokens;
          cacheCreationTokens = u.cache_creation_input_tokens ?? cacheCreationTokens;
        }
      }

      if (chunk.type === 'content_block_start') {
        if (chunk.content_block.type === 'tool_use') {
          currentToolUse = {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            input: '',
          };
        }
      } else if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta as
          | Anthropic.RawContentBlockDeltaEvent['delta']
          | { type: 'thinking_delta'; thinking: string }
          | { type: 'signature_delta'; signature: string };
        if (delta.type === 'text_delta') {
          fullContent += delta.text;
          request.onTextDelta?.(delta.text);
        } else if (delta.type === 'thinking_delta') {
          reasoningContent += delta.thinking;
          request.onReasoningDelta?.(delta.thinking);
        } else if (delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.input += delta.partial_json;
        }
        // signature_delta is an opaque cryptographic signature — ignored.
      } else if (chunk.type === 'content_block_stop' && currentToolUse) {
        // Finalize tool call
        try {
          const parsedInput = JSON.parse(currentToolUse.input || '{}');
          toolCalls.push({
            id: currentToolUse.id,
            toolId: currentToolUse.name,
            input: parsedInput,
          });
        } catch (error) {
          this.logger.warn('Failed to parse tool input', { error, input: currentToolUse.input });
          // Signal the parse failure so the agent can see it and retry
          toolCalls.push({
            id: currentToolUse.id,
            toolId: currentToolUse.name,
            input: {
              _parseError:
                'The tool arguments you provided were malformed JSON. Please retry with valid JSON.',
              _rawArguments: (currentToolUse.input || '').substring(0, 500),
            },
          });
        }
        currentToolUse = null;
      }
    }

    const reasoning = reasoningContent ? reasoningContent : undefined;

    if (cacheReadTokens || cacheCreationTokens) {
      this.logger.debug('Anthropic prompt cache', {
        cacheReadTokens: cacheReadTokens ?? 0,
        cacheCreationTokens: cacheCreationTokens ?? 0,
        uncachedInputTokens: inputTokens ?? 0,
      });
    }

    // With caching on, `input_tokens` counts only what follows the last cache
    // breakpoint — the cached prefix is reported separately. Sum the three so
    // `inputTokens` keeps meaning "total input processed", which is what the
    // metering hooks downstream of this (flow-run-coordinator) record as
    // `tokensIn`. Without this, turning caching on would silently collapse
    // reported input usage to near-zero.
    const totalInputTokens =
      inputTokens === undefined &&
      cacheReadTokens === undefined &&
      cacheCreationTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0);

    const usage =
      totalInputTokens !== undefined || outputTokens !== undefined
        ? { inputTokens: totalInputTokens ?? 0, outputTokens: outputTokens ?? 0 }
        : undefined;

    if (toolCalls.length > 0) {
      return { ...this.createToolUseResponse(fullContent, toolCalls), reasoning, usage };
    }
    return { ...this.createTextResponse(fullContent), reasoning, usage };
  }

  /**
   * Execute a simple prompt (streaming)
   */
  async executePrompt(request: PromptRequest): Promise<PromptResult> {
    const messageRequest = this.buildPromptRequest(request, { cache: true });

    this.logger.debug(`Submitting prompt to Anthropic`);

    try {
      const stream = await this.client.messages.create(
        {
          ...messageRequest,
          stream: true,
        },
        {
          signal: request.signal,
          ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
          // Flow-node callers own their own retry budget — see openai-adapter.
          maxRetries: 0,
        },
      );

      let fullContent = '';
      let toolUse: string | null = null;

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            fullContent += chunk.delta.text;
          } else if (chunk.delta.type === 'input_json_delta') {
            toolUse = toolUse || '';
            toolUse += chunk.delta.partial_json;
          }
        } else if (
          chunk.type === 'content_block_start' &&
          chunk.content_block.type === 'tool_use'
        ) {
          toolUse = '';
        }
      }

      if (toolUse) {
        try {
          return { value: JSON.parse(toolUse) as object, type: 'object' };
        } catch (parseErr) {
          // Hard-fail — same reasoning as openai-adapter's schema-parse branch.
          const err = Object.assign(
            new Error('Model returned non-JSON tool_use despite outputJsonSchema'),
            {
              name: 'SchemaParseError',
              schemaParse: true as const,
              rawContent: toolUse,
              cause: parseErr,
            },
          );
          throw err;
        }
      }

      return { value: fullContent, type: 'string' };
    } catch (error) {
      this.logger.error('Anthropic API call failed:', error);
      throw error;
    }
  }

  /**
   * Build request params for prompt execution
   */
  private buildPromptRequest(
    request: PromptRequest | BatchRequest,
    options: { cache?: boolean } = {},
  ): Anthropic.MessageCreateParamsNonStreaming {
    // Anthropic enforces strict max_tokens limits per model (e.g., 4096 for Haiku,
    // 8192 for Sonnet). The user-provided maxTokens is typically the *model context*
    // size (e.g., 200000), not the output token budget. Using it directly causes
    // "max_tokens exceeds model limit" errors. Cap at a safe default for prompt
    // (non-agent) requests; agent requests set max_tokens independently.
    const maxOutputTokens = request.maxTokens ? Math.min(request.maxTokens, 8192) : 4096;

    // Cache breakpoint on the system prompt rather than top-level automatic
    // caching. A single-shot prompt's last block is the user prompt, which
    // differs every call — a breakpoint there would write a new entry each
    // request and never read one back. The cached prefix is `tools` then
    // `system` (that order, regardless of how this object is built), both of
    // which are fixed by node config, so a node run repeatedly reads them back.
    const cacheSystemPrompt = options.cache === true && Boolean(request.systemPrompt);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: maxOutputTokens,
      temperature: request.temperature,
      system: cacheSystemPrompt
        ? [
            {
              type: 'text',
              text: request.systemPrompt as string,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : request.systemPrompt,
      messages: [{ role: 'user', content: request.prompt }],
    };

    if (request.outputJsonSchema) {
      try {
        const parsedSchema = JSON.parse(request.outputJsonSchema);
        params.tools = [
          {
            name: 'structured_output',
            description: 'Output data in the specified JSON format',
            input_schema: parsedSchema,
          },
        ];
        params.tool_choice = { type: 'tool', name: 'structured_output' };
      } catch (error) {
        this.logger.warn(`Invalid JSON schema, proceeding without tools: ${error}`);
      }
    }

    return params;
  }

  /**
   * Submit batch to Anthropic Batch API
   */
  async submitBatch(batchJobId: string, requestData: BatchRequest): Promise<BatchSubmissionResult> {
    // Deliberately uncached: each batch carries a single request, so a
    // breakpoint would buy a 1.25x cache write that nothing ever reads back.
    const messageRequest = this.buildPromptRequest(requestData);

    try {
      const result = await this.client.messages.batches.create({
        requests: [
          {
            custom_id: batchJobId,
            params: messageRequest,
          },
        ],
      });

      return { externalBatchId: result.id };
    } catch (error) {
      this.logger.error('Anthropic batch submission failed:', error);
      throw error;
    }
  }

  /**
   * Poll Anthropic batch status
   */
  async pollBatch(externalBatchId: string): Promise<BatchPollResult> {
    try {
      const batchStatus = await this.client.messages.batches.retrieve(externalBatchId);

      this.logger.debug(`Anthropic batch ${externalBatchId} status:`, {
        processing_status: batchStatus.processing_status,
        request_counts: batchStatus.request_counts,
      });

      switch (batchStatus.processing_status) {
        case 'ended': {
          const results = await this.downloadResults(externalBatchId);
          return { status: BatchStatus.COMPLETED, result: results };
        }
        case 'canceling':
          return { status: BatchStatus.FAILED, error: 'Batch is being canceled' };
        case 'in_progress': {
          const createdAt = new Date(batchStatus.created_at);
          const now = new Date();
          const processingTimeHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

          if (processingTimeHours > 20) {
            return {
              status: BatchStatus.FAILED,
              error: `Batch processing timeout: ${processingTimeHours.toFixed(1)} hours`,
            };
          }

          return { status: BatchStatus.PROCESSING };
        }
        default:
          if (
            batchStatus.processing_status &&
            !['in_progress', 'ended'].includes(batchStatus.processing_status)
          ) {
            return {
              status: BatchStatus.FAILED,
              error: `Batch in unexpected status: ${batchStatus.processing_status}`,
            };
          }
          return { status: BatchStatus.PROCESSING };
      }
    } catch (error) {
      this.logger.error('Failed to poll Anthropic batch status:', error);
      throw error;
    }
  }

  /**
   * Download batch results
   */
  private async downloadResults(batchId: string): Promise<BatchResult[]> {
    try {
      const batchResults: BatchResult[] = [];

      for await (const batchResult of await this.client.messages.batches.results(batchId)) {
        const resultBatchId = batchResult.custom_id;

        let result: BatchResult;
        switch (batchResult.result.type) {
          case 'succeeded': {
            // Capture provider-reported token usage. Anthropic's batch
            // success result mirrors a normal Message response, so
            // `message.usage.{input,output}_tokens` is present.
            const rawUsage = (
              batchResult.result.message as {
                usage?: { input_tokens?: number; output_tokens?: number };
              }
            ).usage;
            const usage = rawUsage
              ? {
                  inputTokens: rawUsage.input_tokens ?? 0,
                  outputTokens: rawUsage.output_tokens ?? 0,
                }
              : undefined;
            result = {
              batchId: resultBatchId,
              status: BatchStatus.COMPLETED,
              content: this.handleMessageResponse(batchResult.result.message),
              ...(usage ? { usage } : {}),
            };
            break;
          }
          case 'errored':
            result = {
              batchId: resultBatchId,
              status: BatchStatus.FAILED,
              error: batchResult.result.error.error.message,
            };
            break;
          case 'canceled':
            result = {
              batchId: resultBatchId,
              status: BatchStatus.CANCELLED,
              error: 'Batch was canceled',
            };
            break;
          case 'expired':
            result = { batchId: resultBatchId, status: BatchStatus.FAILED, error: 'Batch expired' };
            break;
          default:
            result = {
              batchId: resultBatchId,
              status: BatchStatus.FAILED,
              error: `Unknown batch result type: ${batchResult.result}`,
            };
            break;
        }

        batchResults.push(result);
      }

      return batchResults;
    } catch (error) {
      this.logger.error('Failed to download Anthropic batch results:', error);
      throw error;
    }
  }

  /**
   * Handle non-streaming message response
   */
  private handleMessageResponse(message: Anthropic.Message): PromptResult {
    const content = message.content[0];

    if (!content) {
      throw new Error('No content returned from Anthropic API');
    }

    if (content.type === 'text') {
      return { value: content.text, type: 'string' };
    }

    if (content.type === 'tool_use') {
      try {
        return { value: JSON.parse(JSON.stringify(content.input)) as object, type: 'object' };
      } catch (error) {
        this.logger.warn(`Failed to parse tool output: ${error}`);
        return { value: String(content.input), type: 'string' };
      }
    }

    throw new Error(`Unexpected content type: ${content.type}`);
  }

  /**
   * List available models
   */
  async listModels(): Promise<Model[]> {
    try {
      const anthropicModels = await this.client.models.list();

      return anthropicModels.data.map((model) => ({
        id: model.id,
        name: model.display_name || model.id,
        provider: 'anthropic' as const,
        supportsStructuredOutput: false,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch Anthropic models:', error);
      throw error;
    }
  }

  /**
   * Anthropic uses tool-based structured output, not native
   */
  modelSupportsStructuredOutput(_modelId: string): boolean {
    return false;
  }

  /**
   * Anthropic doesn't support JSON mode
   */
  modelSupportsJsonMode(_modelId: string): boolean {
    return false;
  }
}
