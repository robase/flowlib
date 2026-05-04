/**
 * OpenAI Provider Adapter
 *
 * Handles OpenAI-specific message formats, tool schemas, and API calls.
 * Also serves as the base for OpenAI-compatible providers (e.g., OpenRouter).
 */

import OpenAI from 'openai';
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
 * OpenAI Provider Adapter
 */
export class OpenAIAdapter extends BaseProviderAdapter {
  // Use getters to allow override in subclasses
  get providerId(): string {
    return 'OPENAI';
  }

  get defaultModel(): string {
    return this.defaultModelOverride || 'gpt-4o-mini';
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutput: true,
      supportsBatch: true,
      supportsJsonMode: true,
    };
  }

  // Protected so OpenRouterAdapter can override it
  protected client: OpenAI;

  /**
   * Default request timeout for agent prompts in milliseconds.
   * Long-running tool-calling responses (large flow builders) can legitimately
   * take several minutes. Subclasses may override.
   */
  protected get defaultAgentTimeoutMs(): number {
    return 10 * 60 * 1000; // 10 minutes
  }

  constructor(logger: Logger, apiKey: string, defaultModelOverride?: string, baseURL?: string) {
    super(logger, apiKey, defaultModelOverride);
    this.validateApiKey();

    this.client = new OpenAI({
      apiKey: this.apiKey,
      maxRetries: 3, // Retry on 429 (rate limit), 500, 503 with exponential backoff
      timeout: this.defaultAgentTimeoutMs,
      ...(baseURL && { baseURL }),
    });
  }

  /**
   * Convert AgentToolDefinition[] to OpenAI tool format
   */
  convertTools(tools: AgentToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.id,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Convert AgentMessage[] to OpenAI message format
   */
  convertMessages(
    messages: AgentMessage[],
    systemPrompt?: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Assistant message with tool calls
          const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
            msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.toolId,
                arguments: JSON.stringify(tc.input),
              },
            }));

          result.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: toolCalls,
          });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Tool result message
        result.push({
          role: 'tool',
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- tool messages always have toolCallId
          tool_call_id: msg.toolCallId!,
          content: msg.content,
        });
      }
    }

    return result;
  }

  /**
   * Build tool_choice parameter for OpenAI
   */
  buildToolChoice(
    choice: 'auto' | 'none' | { type: 'tool'; name: string } | undefined,
    hasTools: boolean,
  ): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
    if (!hasTools) {
      return undefined;
    }

    if (choice === 'none') {
      return 'none';
    } else if (choice && typeof choice === 'object') {
      return {
        type: 'function',
        function: { name: choice.name },
      };
    }
    return 'auto';
  }

  /**
   * Execute agent prompt with tools.
   *
   * Uses streaming to keep the HTTP socket active during long tool-calling
   * responses — buffered (non-streaming) requests are prone to `TypeError:
   * terminated` from undici when the upstream or a CDN closes an idle socket
   * before the full response arrives.
   */
  async executeAgentPrompt(request: AgentPromptRequest): Promise<AgentPromptResult> {
    this.logger.debug(`Running ${this.providerId} agent prompt with tools (streaming)`, {
      model: request.model,
      toolCount: request.tools.length,
      messageCount: request.messages.length,
    });

    try {
      const messages = this.convertMessages(request.messages, request.systemPrompt);
      const tools = this.convertTools(request.tools);
      const toolChoice = this.buildToolChoice(request.toolChoice, tools.length > 0);

      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: request.model,
        messages,
        temperature: request.temperature,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: toolChoice,
        parallel_tool_calls: request.parallelToolCalls !== false,
        stream: true,
        stream_options: { include_usage: true },
      };

      if (request.maxTokens) {
        params.max_completion_tokens = request.maxTokens;
      }

      this.applyThinkingParams(params, request);

      const stream = await this.client.chat.completions.create(params, {
        signal: request.signal,
        timeout: request.timeoutMs ?? this.defaultAgentTimeoutMs,
        // Disable SDK retries for flow-node callers — the action-level retry
        // loop owns retry semantics and needs predictable request counts.
        maxRetries: 0,
      });

      return await this.parseStreamingAgentResponse(stream, request);
    } catch (error) {
      this.logger.error(`${this.providerId} agent prompt failed:`, error);
      throw error;
    }
  }

  /**
   * Attach reasoning / thinking params to a streaming chat-completion request.
   *
   * OpenAI accepts `reasoning_effort` only on reasoning-capable models (o-series,
   * gpt-5). Unknown models ignore it, so we gate on a heuristic model-name check
   * to avoid 400s on non-reasoning models. Subclasses may override for providers
   * that accept a richer reasoning param (e.g. OpenRouter).
   */
  protected applyThinkingParams(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    request: AgentPromptRequest,
  ): void {
    if (!request.thinking?.enabled) {
      return;
    }
    if (!this.modelSupportsReasoningEffort(request.model)) {
      return;
    }

    const effort =
      request.thinking.effort ??
      (request.thinking.budgetTokens && request.thinking.budgetTokens >= 8000
        ? 'high'
        : request.thinking.budgetTokens && request.thinking.budgetTokens <= 2048
          ? 'low'
          : 'medium');
    (
      params as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
        reasoning_effort?: 'low' | 'medium' | 'high';
      }
    ).reasoning_effort = effort;
    // Reasoning models reject temperature overrides — drop it.
    delete (params as { temperature?: number }).temperature;
  }

  /** True for OpenAI models that accept `reasoning_effort`. */
  protected modelSupportsReasoningEffort(model: string): boolean {
    const m = model.toLowerCase();
    return m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('gpt-5');
  }

  /**
   * Aggregate an OpenAI chat-completion stream into a normalized AgentPromptResult.
   *
   * Tool-call arguments arrive as partial JSON chunks keyed by `index` — we
   * concatenate and parse once the stream ends so the result shape matches the
   * non-streaming path exactly.
   *
   * Emits incremental deltas via `request.onTextDelta` / `onReasoningDelta`
   * as chunks arrive. OpenAI does not surface reasoning text on standard
   * Chat Completions today, but OpenRouter and some OpenAI-compatible proxies
   * populate a non-standard `delta.reasoning` field — we forward it when
   * present so thinking UIs light up automatically.
   */
  protected async parseStreamingAgentResponse(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
    request: AgentPromptRequest,
  ): Promise<AgentPromptResult> {
    let content = '';
    let reasoning = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream) {
      // Usage chunks arrive at the end of the stream when `include_usage: true`
      // is set. They have an empty `choices` array; we capture the totals here
      // and surface them in the AgentPromptResult so callers can meter cost.
      const chunkUsage = (
        chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
      ).usage;
      if (chunkUsage) {
        usage = {
          inputTokens: chunkUsage.prompt_tokens ?? 0,
          outputTokens: chunkUsage.completion_tokens ?? 0,
        };
      }

      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }

      const delta = choice.delta as
        | (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
            reasoning?: string;
            reasoning_content?: string;
          })
        | undefined;
      if (delta?.content) {
        content += delta.content;
        request.onTextDelta?.(delta.content);
      }

      // Non-standard reasoning fields: `reasoning` is used by OpenRouter and
      // some OpenAI-compatible proxies; `reasoning_content` by certain self-
      // hosted o-series deployments. Treat both as opaque streamed text.
      const reasoningChunk = delta?.reasoning ?? delta?.reasoning_content;
      if (reasoningChunk) {
        reasoning += reasoningChunk;
        request.onReasoningDelta?.(reasoningChunk);
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const acc = toolCallAcc.get(idx) ?? { id: '', name: '', arguments: '' };
          if (tc.id) {
            acc.id = tc.id;
          }
          if (tc.function?.name) {
            acc.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            acc.arguments += tc.function.arguments;
          }
          toolCallAcc.set(idx, acc);
        }
      }
    }

    const finalReasoning = reasoning ? reasoning : undefined;

    if (toolCallAcc.size > 0) {
      const toolCalls: AgentToolCall[] = [...toolCallAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(acc.arguments || '{}');
          } catch {
            this.logger.warn('Failed to parse streamed tool arguments', {
              arguments: acc.arguments,
            });
            parsedInput = {
              _parseError:
                'The tool arguments you provided were malformed JSON. Please retry with valid JSON.',
              _rawArguments: (acc.arguments || '').substring(0, 500),
            };
          }
          return { id: acc.id, toolId: acc.name, input: parsedInput };
        });

      return {
        ...this.createToolUseResponse(content, toolCalls),
        reasoning: finalReasoning,
        usage,
      };
    }

    return { ...this.createTextResponse(content), reasoning: finalReasoning, usage };
  }

  /**
   * Execute a simple prompt (non-agent)
   */
  async executePrompt(request: PromptRequest): Promise<PromptResult> {
    const model = request.model || this.getEffectiveDefaultModel();
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'user', content: request.prompt },
    ];

    const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature: 0,
    };

    // Add structured output format if schema is provided and model supports it
    if (request.outputJsonSchema && this.modelSupportsStructuredOutput(model)) {
      try {
        const parsedSchema = JSON.parse(request.outputJsonSchema);

        if (parsedSchema.type === 'object' && parsedSchema.additionalProperties === undefined) {
          parsedSchema.additionalProperties = false;
        }

        requestOptions.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'structured_output',
            strict: true,
            schema: parsedSchema,
          },
        };
      } catch (error) {
        this.logger.warn(`Invalid JSON schema, proceeding without schema: ${error}`);
      }
    } else if (request.outputJsonSchema && this.modelSupportsJsonMode(model)) {
      requestOptions.response_format = { type: 'json_object' };
      messages.unshift({
        role: 'system',
        content: `Please respond with valid JSON that matches this schema: ${request.outputJsonSchema}`,
      });
    } else if (request.outputJsonSchema) {
      messages.unshift({
        role: 'system',
        content: `Please respond with valid JSON that matches this schema: ${request.outputJsonSchema}`,
      });
    }

    if (request.maxTokens !== undefined) {
      requestOptions.max_completion_tokens = request.maxTokens;
    }

    try {
      const response = await this.client.chat.completions.create(requestOptions, {
        signal: request.signal,
        // OpenAI SDK rejects `timeout: undefined`; only pass when positive.
        ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
        // See executeAgentPrompt: flow-node callers own their own retry budget.
        maxRetries: 0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content returned from OpenAI API');
      }

      if (request.outputJsonSchema) {
        try {
          return { value: JSON.parse(content), type: 'object' };
        } catch (parseErr) {
          // Hard-fail rather than silently downgrading to a string — downstream
          // nodes that typed against the schema would otherwise receive the
          // wrong shape with no visible failure. The classifier maps
          // `schemaParse === true` to NodeErrorCode SCHEMA_PARSE.
          const err = Object.assign(new Error('Model returned non-JSON despite outputJsonSchema'), {
            name: 'SchemaParseError',
            schemaParse: true as const,
            rawContent: content,
            cause: parseErr,
          });
          throw err;
        }
      }
      return { value: content, type: 'string' };
    } catch (error) {
      this.logger.error(`${this.providerId} API call failed:`, error);
      throw error;
    }
  }

  /**
   * Submit batch to OpenAI Batch API
   */
  async submitBatch(batchJobId: string, requestData: BatchRequest): Promise<BatchSubmissionResult> {
    this.logger.info(`Submitting batch ${batchJobId}`);

    const batchRequestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: requestData.model,
      messages: [{ role: 'user', content: requestData.prompt }],
      max_tokens: requestData.maxTokens,
    };

    if (requestData.temperature !== undefined) {
      batchRequestBody.temperature = requestData.temperature;
    }

    // Handle response format
    if (requestData.outputJsonSchema) {
      this.addResponseFormat(batchRequestBody, requestData.outputJsonSchema, requestData.model);
    }

    const batchRequest = {
      custom_id: batchJobId,
      method: 'POST' as const,
      url: '/v1/chat/completions' as const,
      body: batchRequestBody,
    };

    const jsonlContent = JSON.stringify(batchRequest);

    try {
      const file = await OpenAI.toFile(Buffer.from(jsonlContent), 'batch_requests.jsonl', {
        type: 'application/jsonl',
      });

      const uploadResponse = await this.client.files.create({
        file,
        purpose: 'batch',
      });

      const batch = await this.client.batches.create({
        input_file_id: uploadResponse.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
      });

      return { externalBatchId: batch.id };
    } catch (error) {
      this.logger.error(`Failed to submit batch ${batchJobId}:`, error);
      throw error;
    }
  }

  /**
   * Add response format to batch request
   */
  private addResponseFormat(
    requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    outputJsonSchema: string,
    model: string,
  ): void {
    try {
      const parsedSchema = JSON.parse(outputJsonSchema);

      if (this.modelSupportsStructuredOutput(model)) {
        if (parsedSchema.type === 'object' && parsedSchema.additionalProperties === undefined) {
          parsedSchema.additionalProperties = false;
        }

        requestBody.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'structured_output',
            strict: true,
            schema: parsedSchema,
          },
        };
      } else if (this.modelSupportsJsonMode(model)) {
        requestBody.response_format = { type: 'json_object' };
        const systemMessage = `Please respond with valid JSON that matches this schema: ${outputJsonSchema}`;
        if (requestBody.messages[0]?.role === 'system') {
          requestBody.messages[0].content = `${systemMessage}\n\n${requestBody.messages[0].content}`;
        } else {
          requestBody.messages.unshift({ role: 'system', content: systemMessage });
        }
      } else {
        const systemMessage = `Please respond with valid JSON that matches this schema: ${outputJsonSchema}`;
        if (requestBody.messages[0]?.role === 'system') {
          requestBody.messages[0].content = `${systemMessage}\n\n${requestBody.messages[0].content}`;
        } else {
          requestBody.messages.unshift({ role: 'system', content: systemMessage });
        }
      }
    } catch (error) {
      this.logger.warn(`Invalid JSON schema for batch, proceeding without: ${error}`);
    }
  }

  /**
   * Poll OpenAI batch status
   */
  async pollBatch(externalBatchId: string): Promise<BatchPollResult> {
    const batch = await this.client.batches.retrieve(externalBatchId);

    switch (batch.status) {
      case 'completed': {
        if (
          batch.request_counts?.failed &&
          batch.request_counts.failed > 0 &&
          batch.error_file_id
        ) {
          const errorMessage = await this.logBatchErrors(batch.error_file_id, externalBatchId);
          if (batch.request_counts.completed === 0) {
            return { status: BatchStatus.FAILED, error: errorMessage };
          }
        }

        if (!batch.output_file_id) {
          return { status: BatchStatus.PROCESSING };
        }

        const results = await this.downloadResults(batch);
        return { status: BatchStatus.COMPLETED, result: results };
      }
      case 'failed':
      case 'expired':
      case 'cancelled':
        return { status: BatchStatus.FAILED, error: `Batch ${batch.status}` };
      default: {
        // Client-side timeout: OpenAI's completion_window is 24h.
        // If a batch is still processing after 25h, fail it.
        if (batch.created_at) {
          const createdAt = new Date(batch.created_at * 1000); // Unix timestamp
          const processingTimeHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
          if (processingTimeHours > 25) {
            return {
              status: BatchStatus.FAILED,
              error: `Batch processing timeout: ${processingTimeHours.toFixed(
                1,
              )} hours (exceeds 24h completion window)`,
            };
          }
        }
        return { status: BatchStatus.PROCESSING };
      }
    }
  }

  /**
   * Log batch errors
   */
  private async logBatchErrors(errorFileId: string, batchId: string): Promise<string> {
    try {
      const errorFileContent = await this.client.files.content(errorFileId);
      const errorsText = await errorFileContent.text();

      const errors = errorsText
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch {
            this.logger.error(`Failed to parse error line ${index + 1}: ${line}`);
            return null;
          }
        })
        .filter(Boolean);

      this.logger.error(`Batch ${batchId} errors:`, JSON.stringify(errors, null, 2));

      if (errors.length > 0 && errors[0].error) {
        return `Request failed: ${JSON.stringify(errors[0].error)}`;
      }

      return 'No error details found in error file';
    } catch (error) {
      return `Failed to retrieve error file: ${(error as Error).message}`;
    }
  }

  /**
   * Download batch results
   */
  private async downloadResults(batch: OpenAI.Batches.Batch): Promise<BatchResult[]> {
    if (!batch.output_file_id) {
      throw new Error('Batch output file ID not available');
    }

    const fileContent = await this.client.files.content(batch.output_file_id);
    const resultsText = await fileContent.text();

    const jsonlLines = resultsText
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    const batchResults: BatchResult[] = [];

    for (const line of jsonlLines) {
      try {
        const result = JSON.parse(line);
        const batchId = result.custom_id;

        if (result.error) {
          batchResults.push({
            batchId,
            status: BatchStatus.FAILED,
            error: typeof result.error === 'string' ? result.error : JSON.stringify(result.error),
          });
        } else if (result.response?.body?.choices?.[0]?.message?.content) {
          const content = result.response.body.choices[0].message.content;
          let promptResult: PromptResult;
          try {
            promptResult = { value: JSON.parse(content), type: 'object' };
          } catch {
            promptResult = { value: content, type: 'string' };
          }
          // Capture provider-reported token usage. OpenAI's batch JSONL
          // mirrors the chat-completion shape, so `usage.{prompt,completion}_tokens`
          // are present on success. Host metering reads these via the
          // resumed node's output metadata.
          const rawUsage = result.response.body.usage as
            | { prompt_tokens?: number; completion_tokens?: number }
            | undefined;
          const usage = rawUsage
            ? {
                inputTokens: rawUsage.prompt_tokens ?? 0,
                outputTokens: rawUsage.completion_tokens ?? 0,
              }
            : undefined;
          batchResults.push({
            batchId,
            status: BatchStatus.COMPLETED,
            content: promptResult,
            ...(usage ? { usage } : {}),
          });
        } else {
          batchResults.push({
            batchId,
            status: BatchStatus.FAILED,
            error: 'Unexpected response format: no content found',
          });
        }
      } catch (parseError) {
        batchResults.push({
          batchId: 'unknown',
          status: BatchStatus.FAILED,
          error: `Failed to parse result: ${(parseError as Error).message}`,
        });
      }
    }

    return batchResults;
  }

  /**
   * List available models
   */
  async listModels(): Promise<Model[]> {
    try {
      const openAIModels = await this.client.models.list();

      return openAIModels.data
        .filter(
          (model) =>
            model.id.includes('gpt') &&
            [
              'image',
              'audio',
              'transcribe',
              'search',
              'instruct',
              'realtime',
              '3.5',
              '2024',
              '2025',
              'tts',
            ].every((term) => !model.id.includes(term)) &&
            !model.id.match(/gpt-4-\d{4}-preview/) &&
            !model.id.match(/-\d{4}$/),
        )
        .map((model) => ({
          id: model.id,
          name: model.id,
          provider: 'openai' as const,
          supportsStructuredOutput: this.modelSupportsStructuredOutput(model.id),
        }));
    } catch (error) {
      this.logger.error('Failed to fetch OpenAI models:', error);
      throw error;
    }
  }

  /**
   * Check if model supports structured output
   */
  modelSupportsStructuredOutput(modelId: string): boolean {
    const supportedModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4o-2024-08-06',
      'gpt-4o-mini-2024-07-18',
    ];
    return supportedModels.some((supported) => modelId.includes(supported));
  }

  /**
   * Check if model supports JSON mode
   */
  modelSupportsJsonMode(modelId: string): boolean {
    const supportedModels = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'];
    return supportedModels.some((supported) => modelId.includes(supported));
  }
}
