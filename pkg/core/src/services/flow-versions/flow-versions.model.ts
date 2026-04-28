// Flow Versions Model for Flowlib core — adapter-based implementation
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { DatabaseError } from 'src/types/common/errors.types';
import { Logger, PaginatedResponse, QueryOptions } from 'src/schemas';
import { CreateFlowVersionRequest, FlowlibDefinitionRuntime } from './schemas-fresh';
import { FlowVersion } from '../../database';

/**
 * Input for updating a flow version (limited fields)
 */
interface UpdateFlowVersionInput {
  flowlibDefinition?: FlowlibDefinitionRuntime;
}

/**
 * Flow version with optional composite key for database operations
 */
interface _FlowVersionKey {
  version: number;
  flowId: string;
}

/**
 * Flow version query parameters
 */
interface _FlowVersionQuery {
  flowId: string;
  version?: number | 'latest';
  limit?: number;
  offset?: number;
}

const TABLE = 'flowlib_flow_versions';

/**
 * Flow Versions CRUD operations class — uses FlowlibAdapter.
 */
export class FlowVersionsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new flow version
   */
  async create(flowId: string, input: CreateFlowVersionRequest): Promise<FlowVersion> {
    // Retry loop handles the race condition where concurrent requests read the
    // same MAX(version) and collide on the [version, flowId] primary key.
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const nextVersionNumber = await this.getNextVersionNumber(flowId);

        const result = await this.adapter.create({
          model: TABLE,
          data: {
            flow_id: flowId,
            version: nextVersionNumber,
            flowlib_definition: input.flowlibDefinition,
            created_at: new Date(),
          },
        });
        return this.normalize(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isPkConflict =
          msg.includes('UNIQUE constraint failed') ||
          msg.includes('duplicate key') ||
          msg.includes('unique_violation') ||
          msg.includes('Duplicate entry');

        if (isPkConflict && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `Version creation conflict for flow ${flowId}, retrying (attempt ${attempt + 1})`,
          );
          continue;
        }

        this.logger.error('Failed to create flow version', { flowId, error });
        throw new DatabaseError('Failed to create flow version', { error });
      }
    }

    // Unreachable, but TypeScript needs it
    throw new DatabaseError('Failed to create flow version after retries');
  }

  /**
   * Create a new flow version and optionally set it as live
   */
  async createAndSetLive(
    flowId: string,
    input: CreateFlowVersionRequest,
    setAsLive: boolean = false,
  ): Promise<FlowVersion> {
    const newVersion = await this.create(flowId, input);

    if (setAsLive) {
      const { FlowsModel } = await import('../flows/flows.model');
      const flowsModel = new FlowsModel(this.adapter, this.logger);
      await flowsModel.setLiveVersion(flowId, newVersion.version);
    }

    return newVersion;
  }

  /**
   * Get all versions for a flow with optional filtering
   */
  async listByFlowId(
    flowId: string,
    options?: QueryOptions<FlowVersion>,
  ): Promise<PaginatedResponse<FlowVersion>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const sort = options?.sort;
    const offset = (pagination.page - 1) * pagination.limit;

    const where: WhereClause[] = [{ field: 'flow_id', value: flowId }];

    try {
      const [data, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where,
          limit: pagination.limit,
          offset,
          sortBy: sort
            ? { field: this.mapSortField(sort.sortBy as string), direction: sort.sortOrder }
            : { field: 'version', direction: 'desc' },
        }),
        this.adapter.count({ model: TABLE, where }),
      ]);

      return this.processPaginatedResults(data, totalCount, pagination);
    } catch (error) {
      this.logger.error('Failed to retrieve flow versions', { flowId, options, error });
      throw new DatabaseError('Failed to retrieve flow versions', { error });
    }
  }

  /**
   * Get specific flow version by composite key
   */
  async findByKey(flowId: string, version: number | 'latest'): Promise<FlowVersion | null> {
    try {
      if (version === 'latest') {
        const versions = await this.listByFlowId(flowId);
        return versions.data.length > 0 ? versions.data[0] : null;
      }

      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_id', value: flowId },
          { field: 'version', value: version },
        ],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get flow version', { flowId, version, error });
      throw new DatabaseError('Failed to get flow version', { error });
    }
  }

  /**
   * Update flow version
   */
  async update(
    flowId: string,
    version: number,
    input: UpdateFlowVersionInput,
  ): Promise<FlowVersion> {
    try {
      const updateData: Record<string, unknown> = {};
      if (input.flowlibDefinition !== undefined) {
        updateData.flowlib_definition = input.flowlibDefinition;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_id', value: flowId },
          { field: 'version', value: version },
        ],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Flow version not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update flow version', { flowId, version, error });
      throw new DatabaseError('Failed to update flow version', { error });
    }
  }

  /**
   * Delete flow version
   */
  async delete(flowId: string, version: number): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [
          { field: 'flow_id', value: flowId },
          { field: 'version', value: version },
        ],
      });
    } catch (error) {
      this.logger.error('Failed to delete flow version', { flowId, version, error });
      throw new DatabaseError('Failed to delete flow version', { error });
    }
  }

  /**
   * Get next version number for a flow
   */
  private async getNextVersionNumber(flowId: string): Promise<number> {
    try {
      // Get current max version by fetching the first record sorted by version desc
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'flow_id', value: flowId }],
        sortBy: { field: 'version', direction: 'desc' },
        limit: 1,
        select: ['version'],
      });

      const maxVersion = results.length > 0 ? Number(results[0].version) : 0;
      return maxVersion + 1;
    } catch (error) {
      this.logger.error('Failed to get next version number', { flowId, error });
      return 1;
    }
  }

  private calculatePaginationMetadata(
    totalCount: number,
    pagination: { page: number; limit: number },
  ) {
    const totalPages = Math.ceil(totalCount / pagination.limit);
    return { page: pagination.page, limit: pagination.limit, totalPages };
  }

  private processPaginatedResults(
    result: Record<string, unknown>[],
    totalCount: number,
    pagination: { page: number; limit: number },
  ): PaginatedResponse<FlowVersion> {
    const data = result.map((v) => this.normalize(v));
    return { data, pagination: this.calculatePaginationMetadata(totalCount, pagination) };
  }

  private normalize(raw: Record<string, unknown>): FlowVersion {
    return {
      version: Number(raw.version),
      flowId: String(raw.flow_id ?? raw.flowId),
      flowlibDefinition: (raw.flowlib_definition ??
        raw.flowlibDefinition) as FlowlibDefinitionRuntime,
      createdAt: new Date(String(raw.created_at ?? raw.createdAt)).toISOString(),
      createdBy: raw.created_by ? String(raw.created_by) : null,
    };
  }

  private mapSortField(field: string): string {
    const map: Record<string, string> = {
      version: 'version',
      createdAt: 'created_at',
      flowId: 'flow_id',
    };
    return map[field] ?? field;
  }
}
