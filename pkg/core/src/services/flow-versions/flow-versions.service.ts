import { ValidationError, FlowNotFoundError, DatabaseError } from 'src/types/common/errors.types';
import { CreateFlowVersionRequest } from './schemas-fresh';
import { DatabaseService } from '../database/database.service';
import { Logger, PaginatedResponse, QueryOptions } from 'src/schemas';
import type { FlowVersion } from '@flowlib/db';

export class FlowVersionsService {
  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
  ) {
    if (!databaseService) {
      throw new Error(
        'DatabaseService is required for FlowVersionsService operation. Please update your code to pass a DatabaseService instance.',
      );
    }
  }

  /**
   * Create flow version
   */
  async createFlowVersion(flowId: string, createVersionRequest: CreateFlowVersionRequest) {
    this.logger.info('Creating flow version', { flowId });

    try {
      return await this.databaseService.flowVersions.create(flowId, createVersionRequest);
    } catch (error) {
      if (error instanceof FlowNotFoundError || error instanceof ValidationError) {
        throw error;
      }
      this.logger.error('Failed to create flow version', { flowId, error });
      throw new DatabaseError('Failed to create flow version', { error });
    }
  }

  /**
   * Get flow versions
   */
  async listFlowVersionsByFlowId(
    flowId: string,
    options?: QueryOptions<FlowVersion>,
  ): Promise<PaginatedResponse<FlowVersion>> {
    this.logger.debug('Retrieving flow versions', { flowId });

    try {
      return await this.databaseService.flowVersions.listByFlowId(flowId, options);
    } catch (error) {
      if (error instanceof FlowNotFoundError) {
        throw error;
      }
      this.logger.error('Failed to retrieve flow versions', { flowId, error });
      throw new DatabaseError('Failed to retrieve flow versions', { error });
    }
  }

  /**
   * Get specific flow version by version number or 'latest'
   */
  async getFlowVersion(
    flowId: string,
    version: string | number | 'latest',
  ): Promise<FlowVersion | null> {
    this.logger.debug('Retrieving flow version', { flowId, version });

    try {
      // Convert string numbers to numbers for the database call
      let versionParam: number | 'latest';
      if (version === 'latest') {
        versionParam = 'latest';
      } else {
        const numVersion = typeof version === 'string' ? parseFloat(version) : version;
        if (isNaN(numVersion)) {
          throw new ValidationError(`Invalid version format: ${version}`);
        }
        versionParam = numVersion;
      }

      return await this.databaseService.flowVersions.findByKey(flowId, versionParam);
    } catch (error) {
      if (error instanceof FlowNotFoundError || error instanceof ValidationError) {
        throw error;
      }
      this.logger.error('Failed to retrieve flow version', { flowId, version, error });
      throw new DatabaseError('Failed to retrieve flow version', { error });
    }
  }
}
