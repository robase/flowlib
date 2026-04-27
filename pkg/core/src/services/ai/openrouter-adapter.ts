/**
 * OpenRouter Provider Adapter
 *
 * OpenRouter provides access to multiple AI models through a unified OpenAI-compatible API.
 * This adapter extends the OpenAI adapter since OpenRouter uses the same API format.
 *
 * Key differences from OpenAI:
 * - Does NOT support batch processing
 * - Has its own model listing endpoint
 * - Supports additional headers (HTTP-Referer, X-Title)
 * - Can route to multiple underlying providers
 */

import OpenAI from 'openai';
import { Logger } from 'src/schemas';
import { AgentPromptRequest, Model, BatchPollResult, BatchSubmissionResult } from './ai-types';
import { BatchRequest } from '../node-data.service';
import { OpenAIAdapter } from './openai-adapter';
import { ProviderCapabilities } from './provider-adapter';

/**
 * OpenRouter model info from their API
 */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length?: number;
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
  supported_parameters?: string[];
}

/**
 * OpenRouter Provider Adapter
 *
 * Extends OpenAI adapter since OpenRouter uses an OpenAI-compatible API.
 * Overrides specific methods for OpenRouter-specific behavior.
 */
export class OpenRouterAdapter extends OpenAIAdapter {
  private readonly _defaultModel: string;
  private readonly appName: string;
  private readonly siteUrl: string;

  // Override getters from parent class
  override get providerId(): string {
    return 'OPENROUTER';
  }

  override get defaultModel(): string {
    return this._defaultModel;
  }

  override get capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutput: true,
      supportsBatch: false, // OpenRouter does NOT support batch
      supportsJsonMode: true,
    };
  }

  /**
   * OpenRouter fans out to many upstream providers (Anthropic, OpenAI, Google, …)
   * and can be noticeably slower than talking to OpenAI directly. Give agent
   * prompts a longer default timeout to survive big tool-calling responses.
   */
  protected override get defaultAgentTimeoutMs(): number {
    return 15 * 60 * 1000; // 15 minutes
  }

  constructor(
    logger: Logger,
    apiKey: string,
    defaultModelOverride?: string,
    options?: {
      appName?: string;
      siteUrl?: string;
    },
  ) {
    // Initialize with OpenRouter's base URL
    super(logger, apiKey, defaultModelOverride, 'https://openrouter.ai/api/v1');

    this._defaultModel = defaultModelOverride || 'openai/gpt-4o-mini';
    this.appName = options?.appName || 'Invect';
    this.siteUrl = options?.siteUrl || 'https://flowlib.dev';

    // Recreate client with OpenRouter-specific headers + timeout
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      maxRetries: 3,
      timeout: this.defaultAgentTimeoutMs,
      defaultHeaders: {
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.appName,
      },
    });
  }

  /**
   * OpenRouter accepts a richer `reasoning` param that maps to the underlying
   * provider's native knob (Anthropic extended thinking, OpenAI o-series
   * `reasoning_effort`, DeepSeek-R1 traces, etc.). Override the OpenAI
   * implementation to send `reasoning` instead of `reasoning_effort`.
   *
   * See: https://openrouter.ai/docs/use-cases/reasoning-tokens
   */
  protected override applyThinkingParams(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    request: AgentPromptRequest,
  ): void {
    if (!request.thinking?.enabled) {
      return;
    }

    const reasoning: { effort?: 'low' | 'medium' | 'high'; max_tokens?: number } = {};
    if (request.thinking.budgetTokens && request.thinking.budgetTokens > 0) {
      reasoning.max_tokens = Math.floor(request.thinking.budgetTokens);
    }
    if (request.thinking.effort) {
      reasoning.effort = request.thinking.effort;
    } else if (!reasoning.max_tokens) {
      reasoning.effort = 'medium';
    }

    (
      params as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
        reasoning?: typeof reasoning;
      }
    ).reasoning = reasoning;
  }

  /**
   * OpenRouter does NOT support batch processing
   */
  override async submitBatch(
    _batchJobId: string,
    _requestData: BatchRequest,
  ): Promise<BatchSubmissionResult> {
    throw new Error('OpenRouter does not support batch processing. Use direct API calls instead.');
  }

  /**
   * OpenRouter does NOT support batch processing
   */
  override async pollBatch(_externalBatchId: string): Promise<BatchPollResult> {
    throw new Error('OpenRouter does not support batch processing.');
  }

  /**
   * List available models from OpenRouter
   * OpenRouter has its own model listing endpoint
   */
  override async listModels(): Promise<Model[]> {
    try {
      // OpenRouter has a dedicated models endpoint
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.siteUrl || 'https://flowlib.dev',
          'X-Title': this.appName || 'Invect',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch OpenRouter models: ${response.statusText}`);
      }

      const data = (await response.json()) as { data: OpenRouterModel[] };

      // Filter to text-output chat models that support tool calling
      const models: Model[] = data.data
        .filter((model) => {
          const modality = model.architecture?.modality;
          const outputsText = modality?.endsWith('->text');
          const supportsTools = model.supported_parameters?.includes('tools');
          return outputsText && supportsTools;
        })
        .map((model) => ({
          id: model.id,
          name: model.name || model.id,
          provider: 'openrouter' as const,
          supportsStructuredOutput: this.modelSupportsStructuredOutput(model.id),
        }));

      return models;
    } catch (error) {
      this.logger.error('Failed to fetch OpenRouter models:', error);
      throw error;
    }
  }

  /**
   * Check if a model supports structured output
   * For OpenRouter, this depends on the underlying model
   */
  override modelSupportsStructuredOutput(modelId: string): boolean {
    // Models known to support structured output
    const supportedPrefixes = [
      'openai/gpt-4o',
      'openai/gpt-4-turbo',
      'anthropic/claude-3',
      'google/gemini',
      'meta-llama/llama-3',
    ];
    return supportedPrefixes.some((prefix) =>
      modelId.toLowerCase().startsWith(prefix.toLowerCase()),
    );
  }

  /**
   * Check if a model supports JSON mode
   */
  override modelSupportsJsonMode(modelId: string): boolean {
    // Most modern models support JSON mode through OpenRouter
    const supportedPrefixes = [
      'openai/',
      'anthropic/',
      'google/',
      'meta-llama/llama-3',
      'mistralai/',
    ];
    return supportedPrefixes.some((prefix) =>
      modelId.toLowerCase().startsWith(prefix.toLowerCase()),
    );
  }
}
