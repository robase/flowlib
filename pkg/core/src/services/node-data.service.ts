// Node Data Service - Framework-agnostic node testing and data helpers
import { DatabaseService } from './database/database.service';
import { Logger, InvectConfig } from 'src/schemas';
import { DatabaseError, ValidationError } from 'src/types/common/errors.types';
import { Model, BaseAIClient, BatchProvider } from './ai/base-client';

export type { PromptRequest, BatchRequest, SubmitPromptRequest } from '@flowlib/action-kit';

/**
 * Node Data Service implementation
 * Provides testing and validation utilities for different node types
 */
export class NodeDataService {
  private initialized = false;
  private cachedListModels: {
    models: Model[];
    defaultModel: string;
  } | null = null;
  private cachedProviderModels = new Map<
    BatchProvider,
    {
      models: Model[];
      defaultModel: string;
      fetchedAt: number;
    }
  >();
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 60 minutes in milliseconds

  constructor(
    private readonly config: InvectConfig,
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
    private readonly aiClient: BaseAIClient,
  ) {}

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('NodeDataService already initialized');
      return;
    }

    this.logger.info('Initializing NodeDataService');

    try {
      // The database service should already be initialized by the service factory
      if (!this.databaseService) {
        throw new DatabaseError('Database service is required for NodeDataService');
      }

      this.initialized = true;
      this.logger.info('NodeDataService initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize NodeDataService', error);
      throw error;
    }
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      this.logger.debug('NodeDataService not initialized, nothing to close');
      return;
    }

    this.logger.info('Closing NodeDataService');
    this.initialized = false;
    this.cachedListModels = null;
    this.logger.info('NodeDataService closed successfully');
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<{
    models: Model[];
    defaultModel: string;
  }> {
    this.ensureInitialized();

    const now = Date.now();
    if (this.cachedListModels && now - this.lastFetchTime < this.CACHE_DURATION) {
      return this.cachedListModels;
    }

    try {
      const configuredProviders = this.getConfiguredProviders();
      const aggregatedModels: Model[] = [];
      let defaultModel: string | undefined;

      if (configuredProviders.length === 0) {
        this.logger.warn('No AI providers configured. Returning empty model list');
      }

      for (const provider of configuredProviders) {
        try {
          const providerResult = await this.getModelsForProvider(provider);
          aggregatedModels.push(...providerResult.models);
          if (!defaultModel) {
            defaultModel = providerResult.defaultModel;
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch models for provider ${provider}`, error);
        }
      }

      if (!defaultModel) {
        defaultModel = aggregatedModels[0]?.id || 'No model available';
      }

      const result = {
        models: aggregatedModels,
        defaultModel,
      };

      this.cachedListModels = result;
      this.lastFetchTime = now;

      this.logger.debug('Retrieved available models', { count: result.models.length });

      return result;
    } catch (error) {
      this.logger.error('Failed to get available models', error);
      return this.cachedListModels || { models: [], defaultModel: 'No model available' };
    }
  }

  async getModelsForProvider(provider: BatchProvider): Promise<{
    models: Model[];
    defaultModel: string;
  }> {
    this.ensureInitialized();

    const cached = this.cachedProviderModels.get(provider);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.CACHE_DURATION) {
      return { models: cached.models, defaultModel: cached.defaultModel };
    }

    const providerResult = await this.aiClient.listModelsForProvider(provider);
    const filteredModels = this.filterChatCompletionModels(provider, providerResult.models);

    this.cachedProviderModels.set(provider, {
      models: filteredModels,
      defaultModel: providerResult.defaultModel,
      fetchedAt: now,
    });

    return { models: filteredModels, defaultModel: providerResult.defaultModel };
  }

  private filterChatCompletionModels(provider: BatchProvider, models: Model[]): Model[] {
    if (models.length === 0) {
      return models;
    }

    if (provider === BatchProvider.OPENAI) {
      return models.filter((model) => {
        const id = model.id.toLowerCase();
        if (!id.startsWith('gpt')) {
          return false;
        }
        return !/(audio|embedding|search|tts|vision)/.test(id);
      });
    }

    if (provider === BatchProvider.ANTHROPIC) {
      return models.filter((model) => model.id.toLowerCase().startsWith('claude'));
    }

    return models;
  }

  private getConfiguredProviders(): BatchProvider[] {
    // Providers are now configured via credentials in the UI.
    // Return all known providers so model listing can attempt each.
    return [BatchProvider.OPENAI, BatchProvider.ANTHROPIC, BatchProvider.OPENROUTER];
  }

  /**
   * Ensure the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ValidationError('NodeDataService not initialized. Call initialize() first.');
    }
  }
}
