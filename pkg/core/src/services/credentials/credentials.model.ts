// Credentials Model for Flowlib core — adapter-based implementation
import { randomUUID } from 'crypto';
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { DatabaseError } from 'src/types/common/errors.types';
import { Logger, PaginatedResponse, PaginationQuery, QueryOptions } from 'src/schemas';
import type {
  CredentialAuthType,
  CredentialConfig,
  CredentialType,
} from '../../database/schema-sqlite';

/**
 * Credential entity
 */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  authType: CredentialAuthType;
  config: CredentialConfig;
  description?: string | null;
  isActive: boolean;
  workspaceId?: string | null;
  isShared: boolean;
  metadata?: Record<string, unknown> | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * Input for creating a new credential
 */
export interface CreateCredentialInput {
  name: string;
  type: CredentialType;
  authType: CredentialAuthType;
  config: CredentialConfig;
  description?: string;
  workspaceId?: string;
  isShared?: boolean;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

/**
 * Input for updating a credential
 */
export interface UpdateCredentialInput {
  name?: string;
  type?: CredentialType;
  authType?: CredentialAuthType;
  config?: CredentialConfig;
  description?: string;
  isActive?: boolean;
  isShared?: boolean;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
  lastUsedAt?: string;
}

/**
 * Credential query parameters
 */
interface _CredentialQuery {
  userId: string;
  type?: CredentialType;
  authType?: CredentialAuthType;
  isActive?: boolean;
  workspaceId?: string;
  includeShared?: boolean;
  pagination?: PaginationQuery;
}

const TABLE = 'flowlib_credentials';

/**
 * Credentials CRUD operations class — uses FlowlibAdapter.
 */
export class CredentialsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new credential
   */
  async create(input: CreateCredentialInput): Promise<Credential> {
    try {
      const now = new Date();
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          id: randomUUID(),
          name: input.name,
          type: input.type,
          auth_type: input.authType,
          config: input.config,
          description: input.description ?? null,
          workspace_id: input.workspaceId ?? null,
          is_shared: input.isShared ?? false,
          metadata: input.metadata ?? null,
          expires_at: input.expiresAt ?? null,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      });
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to create credential', { input, error });
      throw new DatabaseError('Failed to create credential', { error });
    }
  }

  /**
   * Get all credentials with optional filtering
   */
  async findAll(options?: QueryOptions<Credential>): Promise<PaginatedResponse<Credential>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const offset = (pagination.page - 1) * pagination.limit;

    try {
      const [data, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          limit: pagination.limit,
          offset,
          sortBy: { field: 'created_at', direction: 'desc' },
        }),
        this.adapter.count({ model: TABLE }),
      ]);

      return this.processPaginatedResults(data, totalCount, pagination);
    } catch (error) {
      this.logger.error('Failed to retrieve credentials', { options, error });
      throw new DatabaseError('Failed to retrieve credentials', { error });
    }
  }

  /**
   * Get credential by ID
   */
  async findById(id: string): Promise<Credential | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get credential by ID', { credentialId: id, error });
      throw new DatabaseError('Failed to get credential by ID', { error });
    }
  }

  /**
   * Update credential
   */
  async update(id: string, input: UpdateCredentialInput): Promise<Credential> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.type !== undefined) {
        updateData.type = input.type;
      }
      if (input.authType !== undefined) {
        updateData.auth_type = input.authType;
      }
      if (input.config !== undefined) {
        updateData.config = input.config;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.isActive !== undefined) {
        updateData.is_active = input.isActive;
      }
      if (input.isShared !== undefined) {
        updateData.is_shared = input.isShared;
      }
      if (input.metadata !== undefined) {
        updateData.metadata = input.metadata;
      }
      if (input.expiresAt !== undefined) {
        updateData.expires_at = input.expiresAt;
      }
      if (input.lastUsedAt !== undefined) {
        updateData.last_used_at = input.lastUsedAt;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Credential not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update credential', { credentialId: id, error });
      throw new DatabaseError('Failed to update credential', { error });
    }
  }

  /**
   * Delete credential
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete credential', { credentialId: id, error });
      throw new DatabaseError('Failed to delete credential', { error });
    }
  }

  /**
   * Check if credential name exists
   */
  async existsByName(name: string, excludeId?: string): Promise<boolean> {
    try {
      const where: WhereClause[] = [{ field: 'name', value: name }];
      if (excludeId) {
        where.push({ field: 'id', operator: 'ne', value: excludeId });
      }

      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where,
      });
      return !!result;
    } catch (error) {
      this.logger.error('Failed to check credential name existence', { name, error });
      throw new DatabaseError('Failed to check credential name existence', { error });
    }
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    try {
      const now = new Date();
      await this.adapter.update({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: { last_used_at: now, updated_at: now },
        returning: false,
      });
    } catch (error) {
      this.logger.error('Failed to update credential last used time', { credentialId: id, error });
      throw new DatabaseError('Failed to update credential last used time', { error });
    }
  }

  /**
   * Get expired credentials
   */
  async getExpiredCredentials(daysUntilExpiry: number = 7): Promise<Credential[]> {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);
      const expiryDateStr = expiryDate.toISOString();

      // Get all active credentials, then filter by expiry in application code
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'is_active', value: true }],
      });

      return results
        .filter((cred) => {
          const expiresAt = cred.expires_at ?? cred.expiresAt;
          return expiresAt && String(expiresAt) <= expiryDateStr;
        })
        .map((cred) => this.normalize(cred));
    } catch (error) {
      this.logger.error('Failed to get expired credentials', { daysUntilExpiry, error });
      throw new DatabaseError('Failed to get expired credentials', { error });
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

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
  ): PaginatedResponse<Credential> {
    const data = result.map((r) => this.normalize(r));
    return { data, pagination: this.calculatePaginationMetadata(totalCount, pagination) };
  }

  private normalize(raw: Record<string, unknown>): Credential {
    return {
      id: String(raw.id),
      name: String(raw.name),
      type: String(raw.type) as CredentialType,
      authType: (raw.auth_type ?? raw.authType) as CredentialAuthType,
      config: (raw.config || {}) as CredentialConfig,
      description: raw.description ? String(raw.description) : null,
      isActive: Boolean(raw.is_active ?? raw.isActive ?? true),
      workspaceId: (raw.workspace_id ?? raw.workspaceId ?? null) as string | null,
      isShared: Boolean(raw.is_shared ?? raw.isShared ?? false),
      metadata: (raw.metadata || null) as Record<string, unknown> | null,
      lastUsedAt: (raw.last_used_at ?? raw.lastUsedAt ?? null) as string | null,
      expiresAt: (raw.expires_at ?? raw.expiresAt ?? null) as string | null,
      createdAt: (raw.created_at ?? raw.createdAt) as string | Date,
      updatedAt: (raw.updated_at ?? raw.updatedAt) as string | Date,
    };
  }
}
