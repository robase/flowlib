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

      const thinkingEnabled =
        request.thinking?.enabled === true && this.modelSupportsThinking(request.model);
      const budgetTokens = this.resolveThinkingBudget(request.thinking);
      // Anthropic requires max_tokens > budget_tokens when thinking is enabled.
      const baseMaxTokens = request.maxTokens || 4096;
      const maxTokens = thinkingEnabled
        ? Math.max(baseMaxTokens, budgetTokens + 4096)
        : baseMaxTokens;

      const params: Anthropic.MessageCreateParams = {
        model: request.model,
        max_tokens: maxTokens,
        // Anthropic requires temperature === 1 when extended thinking is enabled.
        temperature: thinkingEnabled ? 1 : request.temperature,
        system: request.systemPrompt,
        messages: anthropicMessages,
        tools: tools.length > 0 ? tools : undefined,
      };

      if (thinkingEnabled) {
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
   * Models that accept the `thinking` parameter. Claude 4.x and 3.7 Sonnet
   * support extended thinking; earlier models reject it with a 400.
   */
  private modelSupportsThinking(model: string): boolean {
    const m = model.toLowerCase();
    return (
      m.startsWith('claude-opus-4') ||
      m.startsWith('claude-sonnet-4') ||
      m.startsWith('claude-haiku-4') ||
      m.startsWith('claude-3-7-sonnet')
    );
  }

  /** Translate `effort` levels to a concrete budget when explicit budget not provided. */
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
    const toolCalls: AgentToolCall[] = [];

    for await (const chunk of stream) {
      // Usage capture. Anthropic emits `message_start` with `message.usage.input_tokens`
      // (final input total) and `output_tokens` set to a small initial value, then
      // `message_delta` events whose `usage.output_tokens` is the running cumulative
      // total. Last-write-wins on output, first-non-zero wins on input.
      const evt = chunk as
        | {
            type: 'message_start';
            message: { usage?: { input_tokens?: number; output_tokens?: number } };
          }
        | { type: 'message_delta'; usage?: { input_tokens?: number; output_tokens?: number } }
        | typeof chunk;
      if (evt.type === 'message_start') {
        const u = (
          evt as { message: { usage?: { input_tokens?: number; output_tokens?: number } } }
        ).message.usage;
        if (u) {
          inputTokens = u.input_tokens ?? inputTokens;
          outputTokens = u.output_tokens ?? outputTokens;
        }
      } else if (evt.type === 'message_delta') {
        const u = (evt as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (u) {
          if (u.input_tokens !== undefined) {
            inputTokens = u.input_tokens;
          }
          if (u.output_tokens !== undefined) {
            outputTokens = u.output_tokens;
          }
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
    const usage =
      inputTokens !== undefined || outputTokens !== undefined
        ? { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 }
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
    const messageRequest = this.buildPromptRequest(request);

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
  ): Anthropic.MessageCreateParamsNonStreaming {
    // Anthropic enforces strict max_tokens limits per model (e.g., 4096 for Haiku,
    // 8192 for Sonnet). The user-provided maxTokens is typically the *model context*
    // size (e.g., 200000), not the output token budget. Using it directly causes
    // "max_tokens exceeds model limit" errors. Cap at a safe default for prompt
    // (non-agent) requests; agent requests set max_tokens independently.
    const maxOutputTokens = request.maxTokens ? Math.min(request.maxTokens, 8192) : 4096;
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: maxOutputTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
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
