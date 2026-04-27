/**
 * Flow Triggers Model — adapter-based implementation
 *
 * CRUD operations for the flow_triggers registration table.
 */

import type { FlowlibAdapter } from '../../database/adapter';
import type { Logger } from 'src/schemas';
import { DatabaseError } from 'src/types/common/errors.types';
import type {
  FlowTriggerRegistration,
  CreateTriggerInput,
  TriggerType,
  UpdateTriggerInput,
} from './trigger.types';

const TABLE = 'flowlib_flow_triggers';

/**
 * Model for flow_triggers table CRUD operations.
 */
export class FlowTriggersModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new trigger registration.
   */
  async create(input: CreateTriggerInput): Promise<FlowTriggerRegistration> {
    try {
      const now = new Date();
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          flow_id: input.flowId,
          node_id: input.nodeId,
          type: input.type,
          is_enabled: input.isEnabled ?? true,
          webhook_path: input.webhookPath ?? null,
          webhook_secret: input.webhookSecret ?? null,
          cron_expression: input.cronExpression ?? null,
          cron_timezone: input.cronTimezone ?? null,
          created_at: now,
          updated_at: now,
        },
      });
      return this.normalize(result);
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      this.logger.error('Failed to create trigger', { input, error });
      throw new DatabaseError('Failed to create trigger', { error });
    }
  }

  /**
   * Find a trigger by its ID.
   */
  async findById(id: string): Promise<FlowTriggerRegistration | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to find trigger by id', { id, error });
      throw new DatabaseError('Failed to find trigger', { error });
    }
  }

  /**
   * Find a trigger by its webhook path.
   */
  async findByWebhookPath(path: string): Promise<FlowTriggerRegistration | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'webhook_path', value: path }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to find trigger by webhook path', { path, error });
      throw new DatabaseError('Failed to find trigger by webhook path', { error });
    }
  }

  /**
   * Find all triggers for a flow.
   */
  async findByFlowId(flowId: string): Promise<FlowTriggerRegistration[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'flow_id', value: flowId }],
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to find triggers for flow', { flowId, error });
      throw new DatabaseError('Failed to find triggers for flow', { error });
    }
  }

  /**
   * Find a trigger for a specific node in a flow.
   */
  async findByFlowAndNode(flowId: string, nodeId: string): Promise<FlowTriggerRegistration | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_id', value: flowId },
          { field: 'node_id', value: nodeId },
        ],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to find trigger by flow and node', { flowId, nodeId, error });
      throw new DatabaseError('Failed to find trigger', { error });
    }
  }

  /**
   * Find all enabled cron triggers (for scheduler initialization).
   */
  async findEnabledCronTriggers(): Promise<FlowTriggerRegistration[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'type', value: 'cron' },
          { field: 'is_enabled', value: true },
        ],
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to find enabled cron triggers', { error });
      throw new DatabaseError('Failed to find cron triggers', { error });
    }
  }

  /**
   * Attempt to claim a due cron trigger execution by updating last_triggered_at.
   * Returns true only if the row still has the expected lastTriggeredAt value.
   */
  async claimDueCronExecution(
    id: string,
    expectedLastTriggeredAt: Date | string | null | undefined,
    claimedAt: Date | string,
  ): Promise<boolean> {
    try {
      const where = [{ field: 'id', value: id }] as Array<{
        field: string;
        value: unknown;
        operator?: 'eq' | 'is_null';
      }>;

      if (expectedLastTriggeredAt === null) {
        where.push({ field: 'last_triggered_at', operator: 'is_null', value: null });
      } else {
        where.push({ field: 'last_triggered_at', value: expectedLastTriggeredAt });
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where,
        update: {
          last_triggered_at: claimedAt,
          updated_at: claimedAt,
        },
      });

      return !!result;
    } catch (error) {
      this.logger.error('Failed to claim due cron trigger execution', {
        id,
        expectedLastTriggeredAt,
        error,
      });
      throw new DatabaseError('Failed to claim due cron trigger execution', { error });
    }
  }

  /**
   * Update a trigger registration.
   */
  async update(id: string, input: UpdateTriggerInput): Promise<FlowTriggerRegistration | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.isEnabled !== undefined) {
        updateData.is_enabled = input.isEnabled;
      }
      if (input.webhookPath !== undefined) {
        updateData.webhook_path = input.webhookPath;
      }
      if (input.webhookSecret !== undefined) {
        updateData.webhook_secret = input.webhookSecret;
      }
      if (input.cronExpression !== undefined) {
        updateData.cron_expression = input.cronExpression;
      }
      if (input.cronTimezone !== undefined) {
        updateData.cron_timezone = input.cronTimezone;
      }
      if (input.lastTriggeredAt !== undefined) {
        updateData.last_triggered_at =
          input.lastTriggeredAt instanceof Date ? input.lastTriggeredAt : input.lastTriggeredAt;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      this.logger.error('Failed to update trigger', { id, input, error });
      throw new DatabaseError('Failed to update trigger', { error });
    }
  }

  /**
   * Delete a trigger registration by ID.
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete trigger', { id, error });
      throw new DatabaseError('Failed to delete trigger', { error });
    }
  }

  /**
   * Delete all triggers for a flow (used on unpublish).
   */
  async deleteByFlowId(flowId: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'flow_id', value: flowId }],
      });
    } catch (error) {
      this.logger.error('Failed to delete triggers for flow', { flowId, error });
      throw new DatabaseError('Failed to delete triggers for flow', { error });
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private normalize(row: Record<string, unknown>): FlowTriggerRegistration {
    return {
      id: row.id as string,
      flowId: (row.flow_id ?? row.flowId ?? '') as string,
      nodeId: (row.node_id ?? row.nodeId ?? '') as string,
      type: row.type as TriggerType,
      isEnabled: Boolean(row.is_enabled ?? row.isEnabled ?? true),
      webhookPath: (row.webhook_path ?? row.webhookPath ?? null) as string | null,
      webhookSecret: (row.webhook_secret ?? row.webhookSecret ?? null) as string | null,
      cronExpression: (row.cron_expression ?? row.cronExpression ?? null) as string | null,
      cronTimezone: (row.cron_timezone ?? row.cronTimezone ?? null) as string | null,
      lastTriggeredAt: (row.last_triggered_at ?? row.lastTriggeredAt ?? null) as
        | Date
        | string
        | null,
      createdAt: (row.created_at ?? row.createdAt ?? new Date(0)) as Date | string,
      updatedAt: (row.updated_at ?? row.updatedAt ?? new Date(0)) as Date | string,
    };
  }
}
