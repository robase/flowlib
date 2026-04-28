/**
 * Base AI Client
 *
 * Central orchestration layer for AI provider interactions.
 * Uses the adapter pattern to delegate provider-specific logic.
 *
 * Responsibilities:
 * - Provider adapter management
 * - Batch job orchestration and polling
 * - Common error handling and validation
 * - Unified API for all AI operations
 */

import { Logger } from 'src/schemas';
import { BatchJobsService } from '../batch-jobs/batch-jobs.service';
import { BatchJob } from '../batch-jobs/batch-jobs.model';
import { BatchRequest, PromptRequest, SubmitPromptRequest } from '../node-data.service';
import {
  AgentPromptResult,
  AgentToolCall,
  AgentMessage,
  AgentToolDefinition,
} from 'src/types/agent-tool.types';
import type { SubmitAgentPromptRequest } from 'src/types.internal';
import { ProviderAdapter } from './provider-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { OpenRouterAdapter } from './openrouter-adapter';

// Re-export enums (runtime values) from ai-types
export { BatchProvider, AIProvider, BatchStatus } from './ai-types';

// Re-export types from ai-types
export type {
  Model,
  PromptResult,
  AgentPromptRequest,
  BatchSubmissionResult,
  BatchPollResult,
  BatchResult,
} from './ai-types';

import { BatchProvider, AIProvider, BatchStatus } from './ai-types';

import type {
  BatchResult,
  Model,
  PromptResult,
  AgentPromptRequest,
  BatchSubmissionResult,
  BatchPollResult,
} from './ai-types';

export interface BatchPollingRunResult {
  providersChecked: number;
  providersWithPendingJobs: number;
  jobsPolled: number;
}

/**
 * Base AI Client - Central orchestration layer.
 *
 * Adapters are registered dynamically at runtime via `registerAdapter()`.
 * Credentials from the UI/API are resolved into adapters by the caller
 * (e.g. the node-execution-coordinator or flowlib-core) before invoking
 * prompt/batch/model-listing operations.
 */
export class BaseAIClient {
  /** Map of available provider adapters by BatchProvider (for batch-capable providers) */
  private readonly batchAdapters = new Map<BatchProvider, ProviderAdapter>();

  /** Map of all provider adapters by AIProvider (for all operations) */
  private readonly allAdapters = new Map<AIProvider, ProviderAdapter>();

  /** Batch processing state */
  private pollingActive = false;
  private pollingIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly batchJobsService: BatchJobsService,
  ) {}

  // =====================================
  // ADAPTER REGISTRATION
  // =====================================

  /**
   * Register (or replace) a provider adapter.
   *
   * Call this when a credential is resolved so the adapter is available
   * for subsequent prompt, batch, and model-listing operations.
   */
  registerAdapter(
    provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER',
    apiKey: string,
    defaultModel?: string,
  ): ProviderAdapter {
    let adapter: ProviderAdapter;

    switch (provider) {
      case 'OPENAI':
        adapter = new OpenAIAdapter(this.logger, apiKey, defaultModel);
        this.batchAdapters.set(BatchProvider.OPENAI, adapter);
        this.allAdapters.set(AIProvider.OPENAI, adapter);
        break;
      case 'ANTHROPIC':
        adapter = new AnthropicAdapter(this.logger, apiKey, defaultModel);
        this.batchAdapters.set(BatchProvider.ANTHROPIC, adapter);
        this.allAdapters.set(AIProvider.ANTHROPIC, adapter);
        break;
      case 'OPENROUTER':
        adapter = new OpenRouterAdapter(this.logger, apiKey, defaultModel);
        // OpenRouter does NOT support batch processing
        this.allAdapters.set(AIProvider.OPENROUTER, adapter);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    this.logger.debug(`Adapter registered for ${provider}`);
    return adapter;
  }

  /**
   * Check whether an adapter is available for a given provider.
   */
  hasAdapter(provider: AIProvider | BatchProvider): boolean {
    return (
      this.allAdapters.has(provider as AIProvider) ||
      this.batchAdapters.has(provider as BatchProvider)
    );
  }

  /**
   * Get adapter for a batch-capable provider
   */
  private getBatchAdapter(provider: BatchProvider): ProviderAdapter {
    const adapter = this.batchAdapters.get(provider);
    if (!adapter) {
      throw new Error(`No batch adapter available for provider: ${provider}`);
    }
    return adapter;
  }

  /**
   * Get adapter for any AI provider.
   * Throws if no adapter has been registered for the given provider.
   */
  private getAdapter(provider: AIProvider | BatchProvider): ProviderAdapter {
    const adapter =
      this.allAdapters.get(provider as AIProvider) ??
      this.batchAdapters.get(provider as BatchProvider);

    if (!adapter) {
      throw new Error(
        `No adapter registered for provider "${provider}". ` +
          `Register one via registerAdapter() or ensure the credential is resolved first.`,
      );
    }
    return adapter;
  }

  /**
   * Validate agent prompt request
   */
  private validateAgentPromptRequest(request: AgentPromptRequest): void {
    if (!request.model) {
      throw new Error('Model is required for agent prompt');
    }
    if (!request.messages || request.messages.length === 0) {
      throw new Error('At least one message is required for agent prompt');
    }
  }

  // =====================================
  // PUBLIC API
  // =====================================

  /**
   * Execute agent prompt with tool support.
   * This is the main entry point for agent interactions.
   *
   * When `request.useBatchProcessing` is true the initial prompt is submitted
   * through the Batch API and a `batch_submitted` result is returned instead
   * of an `AgentPromptResult`.
   */
  async runAgentPrompt(
    request: AgentPromptRequest | SubmitAgentPromptRequest,
    provider: BatchProvider,
  ): Promise<
    | AgentPromptResult
    | { type: 'batch_submitted'; batchJobId: string; nodeId: string; flowRunId: string }
  > {
    this.validateAgentPromptRequest(request);

    // ── Batch path ──────────────────────────────────────────────────
    const batchReq = request as SubmitAgentPromptRequest;
    if (batchReq.useBatchProcessing && batchReq.nodeId && batchReq.flowRunId) {
      this.logger.debug('Submitting agent prompt via batch', {
        model: request.model,
        provider,
        nodeId: batchReq.nodeId,
      });

      // Flatten the messages into a single prompt for the batch API.
      // The system prompt + all user/assistant messages are concatenated.
      const flatPrompt = request.messages
        .map((m) => {
          const role = m.role.toUpperCase();
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return `[${role}]\n${text}`;
        })
        .join('\n\n');

      const batchRequest: BatchRequest = {
        prompt: flatPrompt,
        model: request.model,
        provider,
        systemPrompt: request.systemPrompt,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        useBatchProcessing: true,
        nodeId: batchReq.nodeId,
        flowRunId: batchReq.flowRunId,
      };

      return this.submitBatchRequest(batchRequest);
    }

    // ── Direct path ─────────────────────────────────────────────────
    const adapter = this.getAdapter(provider);

    this.logger.debug('Running agent prompt', {
      provider: adapter.providerId,
      model: request.model,
      toolCount: request.tools.length,
      messageCount: request.messages.length,
    });

    try {
      return await adapter.executeAgentPrompt(request);
    } catch (error) {
      // Use the adapter's own providerId so OpenRouter (which extends the
      // OpenAI adapter) doesn't get mislabeled as OPENAI in error logs.
      this.logger.error(`Agent prompt failed for ${adapter.providerId}:`, error);
      throw error;
    }
  }

  /**
   * Submit batch to AI provider's Batch API
   */
  async submitBatch(batchJobId: string, requestData: BatchRequest): Promise<BatchSubmissionResult> {
    const adapter = this.getBatchAdapter(requestData.provider);
    return await adapter.submitBatch(batchJobId, requestData);
  }

  /**
   * Poll batch status from AI provider's Batch API
   */
  async pollBatch(externalBatchId: string, provider: BatchProvider): Promise<BatchPollResult> {
    const adapter = this.getBatchAdapter(provider);
    return await adapter.pollBatch(externalBatchId);
  }

  /**
   * Direct API call for immediate execution
   */
  private async submitDirectRequest(req: PromptRequest): Promise<PromptResult> {
    const adapter = this.getAdapter(req.provider);
    return await adapter.executePrompt(req);
  }

  /**
   * List all available models from all providers
   */
  async listModels(): Promise<{ models: Model[]; defaultModel: string }> {
    const allModels: Model[] = [];
    let defaultModel: string | undefined;

    for (const [provider, adapter] of this.allAdapters.entries()) {
      try {
        const models = await adapter.listModels();
        if (!defaultModel) {
          defaultModel = adapter.defaultModel;
        }
        allModels.push(...models);
      } catch (error) {
        this.logger.warn(`Failed to fetch models from ${provider}:`, (error as Error).message);
      }
    }

    if (!defaultModel) {
      throw new Error('A default model must be set for at least one provider');
    }

    return { models: allModels, defaultModel };
  }

  /**
   * List models for a specific provider
   */
  async listModelsForProvider(
    provider: AIProvider | BatchProvider,
  ): Promise<{ models: Model[]; defaultModel: string }> {
    const adapter = this.getAdapter(provider);
    const models = await adapter.listModels();
    return { models, defaultModel: adapter.defaultModel };
  }

  /**
   * Enhanced executePrompt that supports both batch and direct processing
   * PRIMARY ENTRY POINT for all LLM requests
   */
  async executePrompt(request: SubmitPromptRequest): Promise<
    | PromptResult
    | {
        type: 'batch_submitted';
        batchJobId: string;
        nodeId: string;
        flowRunId: string;
      }
  > {
    if (request.useBatchProcessing) {
      return this.submitBatchRequest(request);
    } else {
      return await this.submitDirectRequest(request);
    }
  }

  /**
   * Submit a batch request.
   * Used by both executePrompt (model nodes) and runAgentPrompt (agent batch).
   */
  private async submitBatchRequest(request: BatchRequest): Promise<{
    type: 'batch_submitted';
    batchJobId: string;
    nodeId: string;
    flowRunId: string;
  }> {
    this.logger.debug('Submitting batch job', request);

    try {
      const batchJob = await this.batchJobsService.createBatchJob(request);
      const submissionResult = await this.submitBatch(batchJob.id, request);

      if (!submissionResult.externalBatchId) {
        this.logger.error(
          `No external batch ID received from ${request.provider} provider for job ${batchJob.id}`,
        );
        throw new Error(`Failed to get external batch ID from ${request.provider} provider`);
      }

      await this.batchJobsService.updateBatchJob(batchJob.id, {
        batchId: submissionResult.externalBatchId,
        status: BatchStatus.SUBMITTED,
      });

      this.logger.debug('Batch job submitted successfully', {
        batchJobId: batchJob.id,
        externalBatchId: submissionResult.externalBatchId,
        provider: batchJob.provider,
      });

      return {
        type: 'batch_submitted' as const,
        batchJobId: batchJob.id,
        nodeId: request.nodeId,
        flowRunId: request.flowRunId,
      };
    } catch (error) {
      this.logger.error(`Failed to submit batch job for node ${request.nodeId}:`, error);

      if (request.nodeId) {
        try {
          await this.batchJobsService.markJobAsFailed(request.nodeId, (error as Error).message);
        } catch (updateError) {
          this.logger.error('Failed to update batch job status:', updateError);
        }
      }

      throw error;
    }
  }

  // =====================================
  // BATCH POLLING
  // =====================================

  /**
   * Start batch polling
   */
  async startBatchPolling(): Promise<void> {
    if (!this.batchJobsService) {
      throw new Error('Batch processing not available - BatchJobsService not configured');
    }

    if (this.pollingActive) {
      this.logger.warn('Batch polling is already active');
      return;
    }

    this.pollingActive = true;
    this.pollingIntervalId = setInterval(async () => {
      try {
        await this.pollBatchJobsForAllProviders();
      } catch (error) {
        this.logger.error('Error during batch polling cycle', error);
      }
    }, 5000);

    this.logger.info('Batch polling started');
  }

  /**
   * Stop batch polling
   */
  async stopBatchPolling(): Promise<void> {
    if (!this.pollingActive) {
      this.logger.debug('Batch polling is not active');
      return;
    }

    this.logger.info('Stopping batch job polling');
    this.pollingActive = false;

    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
  }

  /**
   * Run a single batch-polling tick. External-scheduler entry point that
   * maps onto `pollBatchJobsForAllProviders()` and reports just `{ count }`
   * (the total number of pending batch jobs polled across all providers).
   *
   * Hosts on serverless / edge runtimes invoke this from
   * `flowlib.maintenance.pollPendingBatches()` on a cron tick; the
   * in-process `setInterval` started by `startBatchPolling()` is the
   * long-lived-Node-process equivalent.
   */
  async pollPendingBatches(): Promise<{ count: number }> {
    const report = await this.pollBatchJobsForAllProviders();
    return { count: report.jobsPolled };
  }

  /**
   * Poll batch jobs for all providers
   */
  async pollBatchJobsForAllProviders(): Promise<BatchPollingRunResult> {
    if (!this.batchJobsService) {
      return {
        providersChecked: 0,
        providersWithPendingJobs: 0,
        jobsPolled: 0,
      };
    }

    const report: BatchPollingRunResult = {
      providersChecked: this.batchAdapters.size,
      providersWithPendingJobs: 0,
      jobsPolled: 0,
    };

    // Only poll batch-capable providers
    const pollPromises = Array.from(this.batchAdapters.keys()).map(async (provider) => {
      try {
        const pendingJobs = await this.batchJobsService.getPendingBatchJobs(provider);

        if (pendingJobs.length === 0) {
          this.logger.debug(`No pending batch jobs to poll for ${provider}`);
          return;
        }

        report.providersWithPendingJobs += 1;
        report.jobsPolled += pendingJobs.length;

        this.logger.debug(`Polling ${pendingJobs.length} pending batch jobs for ${provider}`);

        const jobsWithBatchId = pendingJobs.filter((job) => !!job.batchId);
        if (jobsWithBatchId.length > 0) {
          await this.checkBatchJobs(jobsWithBatchId);
        }
      } catch (error) {
        this.logger.error(`Failed to poll ${provider} batches:`, error);
      }
    });

    await Promise.allSettled(pollPromises);

    return report;
  }

  /**
   * Check batch jobs
   */
  private async checkBatchJobs(jobs: BatchJob[]): Promise<void> {
    if (!this.batchJobsService) {
      return;
    }

    const maxConcurrentPolls = 3;
    const chunks = this.chunkArray(jobs, maxConcurrentPolls);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (job) => {
          try {
            await this.checkBatchJob(job);
          } catch (error) {
            this.logger.error(`Failed to poll batch job ${job.id}:`, error);
          }
        }),
      );
    }
  }

  /**
   * Poll and update a single batch job
   */
  private async checkBatchJob(job: {
    id: string;
    batchId?: string;
    provider: BatchProvider;
    status: BatchStatus;
  }): Promise<void> {
    if (!this.batchJobsService || !job.batchId) {
      this.logger.debug(
        `Skipping batch job ${job.id}: ${!this.batchJobsService ? 'no batch service' : 'no batch ID'}`,
      );
      return;
    }

    try {
      const pollResult = await this.pollBatch(job.batchId, job.provider);

      if (pollResult.status !== job.status) {
        await this.batchJobsService.updateBatchJob(job.id, {
          status: pollResult.status,
          responseData: pollResult.result,
          error: pollResult.error,
          completedAt:
            pollResult.status === BatchStatus.COMPLETED || pollResult.status === BatchStatus.FAILED
              ? new Date().toISOString()
              : undefined,
        });

        this.logger.info('Batch job status updated', {
          batchJobId: job.id,
          oldStatus: job.status,
          newStatus: pollResult.status,
          hasResult: !!pollResult.result,
          hasError: !!pollResult.error,
        });
      } else {
        this.logger.debug(`Batch job ${job.id} status unchanged: ${pollResult.status}`);
      }
    } catch (error) {
      this.logger.error(`Error polling batch job ${job.id}:`, error);

      try {
        await this.batchJobsService.markJobAsFailed(
          job.id,
          `Polling failed: ${(error as Error).message}`,
        );
      } catch (updateError) {
        this.logger.error(`Failed to mark batch job ${job.id} as failed:`, updateError);
      }
    }
  }

  /**
   * Cancel batches for execution
   */
  async cancelBatchesForExecution(executionId: string): Promise<void> {
    if (!this.batchJobsService) {
      throw new Error('Batch processing not available - BatchJobsService not configured');
    }
    await this.batchJobsService.markBatchJobAsCancelled(executionId);
  }

  /**
   * Utility: chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Re-export types for convenience
export type { AgentPromptResult, AgentToolCall, AgentMessage, AgentToolDefinition };

// Re-export adapter classes for advanced usage
export { OpenAIAdapter } from './openai-adapter';
export { AnthropicAdapter } from './anthropic-adapter';
export { OpenRouterAdapter } from './openrouter-adapter';
export type { ProviderAdapter, ProviderCapabilities } from './provider-adapter';
