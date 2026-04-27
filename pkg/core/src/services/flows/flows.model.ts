// Flows Model for Flowlib core — adapter-based implementation
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { IdGenerator } from '../../utils/id-generator';
import type { FlowVersion } from '../../database';
import { Logger, PaginatedResponse, QueryOptions, FilterQuery } from 'src/schemas';
import { DatabaseError } from 'src/types/common/errors.types';

/**
 * Flow entity
 */
export interface Flow {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  isActive: boolean;
  liveVersionNumber?: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Input for creating a new flow
 */
export interface CreateFlowInput {
  name: string;
  description?: string;
  tags?: string[];
  isActive?: boolean;
  liveVersionNumber?: number;
}

/**
 * Input for updating a flow
 */
export interface UpdateFlowInput {
  name?: string;
  description?: string;
  tags?: string[];
  isActive?: boolean;
  liveVersionNumber?: number;
}

/**
 * Flow query parameters
 */
interface _FlowQuery {
  name?: string;
  tags?: string[];
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

const TABLE = 'flowlib_flows';

/**
 * Flows CRUD operations class — uses FlowlibAdapter for all database operations,
 * eliminating 3-way dialect branching.
 */
export class FlowsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new flow
   */
  async create(input: CreateFlowInput): Promise<Flow> {
    const flowId = IdGenerator.generateFlowId(input.name);
    const now = new Date();

    try {
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          id: flowId,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags || [],
          is_active: input.isActive ?? true,
          live_version_number: input.liveVersionNumber ?? null,
          created_at: now,
          updated_at: now,
        },
      });
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to create flow', { name: input.name, error });
      throw new DatabaseError('Failed to create flow', { error });
    }
  }

  /**
   * Calculate pagination metadata
   */
  private calculatePaginationMetadata(
    totalCount: number,
    pagination: { page: number; limit: number },
  ) {
    const totalPages = Math.ceil(totalCount / pagination.limit);
    return {
      page: pagination.page,
      limit: pagination.limit,
      totalPages,
    };
  }

  /**
   * Process query results into paginated response
   */
  private processPaginatedResults(
    result: Record<string, unknown>[],
    totalCount: number,
    pagination: { page: number; limit: number },
  ): PaginatedResponse<Flow> {
    const data = result.map((flow) => this.normalize(flow));
    return {
      data,
      pagination: this.calculatePaginationMetadata(totalCount, pagination),
    };
  }

  /**
   * Get all flows with optional filtering
   */
  async listFlows(options?: QueryOptions<Flow>): Promise<PaginatedResponse<Flow>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const sort = options?.sort;
    const filter = options?.filter || {};

    const offset = (pagination.page - 1) * pagination.limit;
    const where = this.buildFilterWhere(filter);

    try {
      const [data, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where,
          limit: pagination.limit,
          offset,
          sortBy: sort
            ? { field: this.mapSortField(sort.sortBy as string), direction: sort.sortOrder }
            : { field: 'created_at', direction: 'desc' },
        }),
        this.adapter.count({ model: TABLE, where }),
      ]);

      return this.processPaginatedResults(data, totalCount, pagination);
    } catch (error) {
      this.logger.error('Failed to retrieve flows', { options, error });
      throw new DatabaseError('Failed to retrieve flows', { error });
    }
  }

  /**
   * Get flow by ID
   */
  async findById(id: string): Promise<Flow | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get flow by ID', { flowId: id, error });
      throw new DatabaseError('Failed to get flow by ID', { error });
    }
  }

  /**
   * Get flow with its live version details.
   * Uses two adapter queries (flow + version) instead of Drizzle's relational API.
   */
  async findByIdWithLiveVersion(
    id: string,
  ): Promise<(Flow & { liveVersion?: FlowVersion }) | null> {
    try {
      const flow = await this.findById(id);
      if (!flow) {
        return null;
      }

      if (flow.liveVersionNumber === null || flow.liveVersionNumber === undefined) {
        return flow;
      }

      const version = await this.adapter.findOne<Record<string, unknown>>({
        model: 'flowlib_flow_versions',
        where: [
          { field: 'flow_id', value: id },
          { field: 'version', value: flow.liveVersionNumber },
        ],
      });

      return {
        ...flow,
        liveVersion: version
          ? {
              version: Number(version.version),
              flowId: String(version.flow_id),
              flowlibDefinition: version.flowlib_definition as FlowVersion['flowlibDefinition'],
              createdAt: String(version.created_at),
              createdBy: version.created_by ? String(version.created_by) : null,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to get flow with live version', { flowId: id, error });
      throw new DatabaseError('Failed to get flow with live version', { error });
    }
  }

  /**
   * Update flow
   */
  async update(id: string, input: UpdateFlowInput): Promise<Flow> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.tags !== undefined) {
        updateData.tags = input.tags;
      }
      if (input.isActive !== undefined) {
        updateData.is_active = input.isActive;
      }
      if (input.liveVersionNumber !== undefined) {
        updateData.live_version_number = input.liveVersionNumber;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Flow not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update flow', { flowId: id, error });
      throw new DatabaseError('Failed to update flow', { error });
    }
  }

  /**
   * Delete flow
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete flow', { flowId: id, error });
      throw new DatabaseError('Failed to delete flow', { error });
    }
  }

  /**
   * Set the live version for a flow
   */
  async setLiveVersion(flowId: string, versionNumber: number): Promise<Flow> {
    return this.update(flowId, { liveVersionNumber: versionNumber });
  }

  /**
   * Clear the live version for a flow
   */
  async clearLiveVersion(flowId: string): Promise<Flow> {
    return this.update(flowId, { liveVersionNumber: undefined });
  }

  /**
   * Normalize database results to standard Flow type
   */
  private normalize(raw: Record<string, unknown>): Flow {
    return {
      id: String(raw.id),
      name: String(raw.name),
      description: raw.description ? String(raw.description) : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      isActive: Boolean(raw.is_active ?? raw.isActive),
      liveVersionNumber:
        raw.live_version_number !== null && raw.live_version_number !== undefined
          ? Number(raw.live_version_number)
          : raw.liveVersionNumber !== null && raw.liveVersionNumber !== undefined
            ? Number(raw.liveVersionNumber)
            : undefined,
      createdAt: (raw.created_at ?? raw.createdAt ?? new Date()) as Date | string,
      updatedAt: (raw.updated_at ?? raw.updatedAt ?? new Date()) as Date | string,
    };
  }

  /**
   * Build WhereClause[] from a FilterQuery.
   */
  private buildFilterWhere(filter: FilterQuery<Flow>): WhereClause[] {
    const clauses: WhereClause[] = [];
    for (const [key, values] of Object.entries(filter)) {
      if (!values || !Array.isArray(values) || values.length === 0) {
        continue;
      }
      const dbField = this.mapFilterField(key);
      if (values.length === 1) {
        clauses.push({ field: dbField, operator: 'eq', value: values[0] });
      } else {
        clauses.push({ field: dbField, operator: 'in', value: values });
      }
    }
    return clauses;
  }

  /** Map camelCase entity field to snake_case DB column. */
  private mapFilterField(field: string): string {
    const map: Record<string, string> = {
      isActive: 'is_active',
      liveVersionNumber: 'live_version_number',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    return map[field] ?? field;
  }

  /** Map camelCase sort field to snake_case DB column. */
  private mapSortField(field: string): string {
    return this.mapFilterField(field);
  }
}
