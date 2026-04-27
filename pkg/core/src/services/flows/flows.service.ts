// Framework-agnostic Flow Service for Flowlib core
// Updated to delegate all database operations to DatabaseService for better separation of concerns

import type { DatabaseService } from '../database/database.service';
import { CreateFlowInput, Flow, UpdateFlowInput } from './flows.model';
import { FlowRun } from '../flow-runs/flow-runs.model';
import { Logger, QueryOptions, PaginatedResponse } from 'src/schemas';
import { ValidationError, FlowNotFoundError, DatabaseError } from 'src/types/common/errors.types';
import { FlowVersion } from 'src/database';

/**
 * Flow Service implementation that delegates to DatabaseService
 * This service provides a clean interface for flow operations while delegating
 * all database operations to the DatabaseService for consistency and reusability.
 */
export class FlowsService {
  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
  ) {
    if (!databaseService) {
      throw new Error(
        'DatabaseService is required for FlowService operation. Please update your code to pass a DatabaseService instance.',
      );
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing flow service with database service delegation');
    // Initialize the database service if not already done
    await this.databaseService.initialize();
    this.logger.info('Flow service initialized successfully');
  }

  /**
   * Create a new flow
   */
  async createFlow(createFlowRequest: CreateFlowInput) {
    this.logger.info('Creating new flow', { name: createFlowRequest.name });

    try {
      // Validate request structure
      if (!createFlowRequest.name || createFlowRequest.name.trim() === '') {
        throw new ValidationError('Flow name is required', 'name');
      }

      const flow = await this.databaseService.flows.create(createFlowRequest);
      const flowVersion = await this.databaseService.flowVersions.create(flow.id, {
        flowlibDefinition: {
          nodes: [],
          edges: [],
          metadata: {},
        },
      });
      return { ...flow, version: flowVersion };
    } catch (error) {
      this.logger.error('Failed to create flow', { name: createFlowRequest.name, error });
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new DatabaseError('Failed to create flow', { error });
    }
  }

  /**
   * Update flow
   */
  async updateFlow(id: string, updateFlowRequest: UpdateFlowInput) {
    this.logger.info('Updating flow', { flowId: id });

    try {
      // First check if flow exists
      await this.getFlowById(id);

      return await this.databaseService.flows.update(id, updateFlowRequest);
    } catch (error) {
      if (error instanceof FlowNotFoundError) {
        throw error;
      }
      this.logger.error('Failed to update flow', { flowId: id, error });
      throw new DatabaseError('Failed to update flow', { error });
    }
  }

  /**
   * Delete flow
   */
  async deleteFlow(id: string): Promise<void> {
    this.logger.info('Deleting flow', { flowId: id });

    try {
      await this.databaseService.flows.delete(id);
      this.logger.info('Flow deleted successfully', { flowId: id });
    } catch (error) {
      if (error instanceof FlowNotFoundError) {
        throw error;
      }
      this.logger.error('Failed to delete flow', { flowId: id, error });
      throw new DatabaseError('Failed to delete flow', { error });
    }
  }

  /**
   * Get flow by ID with optional version
   * Only supports flow IDs now
   */
  async getFlowById(
    flowId: string,
    options: { flowVersion?: { version?: number | 'latest'; flowRunId?: string } } = {
      flowVersion: {
        version: 'latest',
        flowRunId: 'latest', // the latest execution that occurred for the version provided
      },
    },
  ): Promise<Flow & { flowVersion: FlowVersion & { latestFlowRun?: FlowRun | null } }> {
    this.logger.debug('Retrieving flow by ID', { flowId, options });

    try {
      const flow = await this.databaseService.flows.findById(flowId);
      if (!flow) {
        throw new FlowNotFoundError(`Flow with ID ${flowId} not found`);
      }

      const flowVersion = await this.databaseService.flowVersions.findByKey(
        flowId,
        options.flowVersion?.version || 'latest',
      );

      if (!flowVersion) {
        throw new FlowNotFoundError(`Flow version for ID ${flowId} not found`);
      }

      const latestFlowRun = await this.databaseService.flowRuns.findByFlowIdVersion(
        flowId,
        flowVersion.version,
      );

      return {
        ...flow,
        flowVersion: {
          ...flowVersion,
          latestFlowRun,
        },
      };
    } catch (error) {
      if (error instanceof FlowNotFoundError) {
        throw error;
      }
      this.logger.error('Failed to retrieve flow by ID', { flowId, error });
      throw new DatabaseError('Failed to retrieve flow by ID', { error });
    }
  }

  /**
   * List all flows
   */
  async listFlows(options?: QueryOptions<Flow>): Promise<PaginatedResponse<Flow>> {
    return this.databaseService.flows.listFlows(options);
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    this.logger.debug('Closing flow service');
    await this.databaseService.close();
  }
}
