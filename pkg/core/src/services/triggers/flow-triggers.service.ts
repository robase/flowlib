/**
 * Flow Triggers Service
 *
 * Business-logic layer for trigger registration and syncing trigger
 * registrations from flow definitions.
 *
 * This service wraps the FlowTriggersModel (CRUD) and adds:
 *  - syncTriggersForFlow(): upserts trigger registrations whenever a flow version is published
 *  - CRUD helpers for API routes
 *
 * Webhook dispatch has been moved to the @flowlib/webhooks plugin.
 */

import { Cron } from 'croner';
import type { Logger } from 'src/schemas';
import { DatabaseError, ValidationError } from 'src/types/common/errors.types';
import type { DatabaseService } from '../database/database.service';
import type { FlowOrchestrationService } from '../flow-orchestration.service';
import type { FlowsService } from '../flows/flows.service';
import type { FlowVersionsService } from '../flow-versions/flow-versions.service';
import type {
  TriggerType,
  FlowTriggerRegistration,
  CreateTriggerInput,
  UpdateTriggerInput,
  TriggerExecutionOptions,
  ExecuteDueCronTriggersOptions,
  ExecuteDueCronTriggersResult,
} from './trigger.types';

// ─── Helpers ────────────────────────────────────────────────────────

/** Generate a unique webhook path slug. */
function generateWebhookPath(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

/** Generate a random webhook secret. */
function generateWebhookSecret(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Return the trigger type from an action id, e.g. "trigger.cron" → "cron". */
function triggerTypeFromActionId(actionId: string): TriggerType | null {
  if (!actionId.startsWith('trigger.')) {
    return null;
  }
  const suffix = actionId.slice('trigger.'.length) as TriggerType;
  if (['manual', 'webhook', 'cron'].includes(suffix)) {
    return suffix;
  }
  return null;
}

// ─── Service ────────────────────────────────────────────────────────

export class FlowTriggersService {
  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
    private readonly flowsService: FlowsService,
    private readonly flowVersionsService: FlowVersionsService,
    private readonly orchestrationService: FlowOrchestrationService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async initialize(): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async close(): Promise<void> {}

  // =====================================
  // CRUD
  // =====================================

  /**
   * List all trigger registrations for a flow.
   */
  async listTriggersForFlow(flowId: string): Promise<FlowTriggerRegistration[]> {
    return this.databaseService.flowTriggers.findByFlowId(flowId);
  }

  /**
   * Get a single trigger by ID.
   */
  async getTrigger(triggerId: string): Promise<FlowTriggerRegistration | null> {
    return this.databaseService.flowTriggers.findById(triggerId);
  }

  /**
   * Create a trigger registration manually.
   */
  async createTrigger(input: CreateTriggerInput): Promise<FlowTriggerRegistration> {
    // Auto-generate webhook path/secret for webhook triggers
    if (input.type === 'webhook') {
      input.webhookPath = input.webhookPath || generateWebhookPath();
      input.webhookSecret = input.webhookSecret || generateWebhookSecret();
    }

    this.logger.info('Creating trigger registration', {
      flowId: input.flowId,
      nodeId: input.nodeId,
      type: input.type,
    });

    return this.databaseService.flowTriggers.create(input);
  }

  /**
   * Update a trigger registration.
   */
  async updateTrigger(
    triggerId: string,
    input: UpdateTriggerInput,
  ): Promise<FlowTriggerRegistration | null> {
    this.logger.debug('Updating trigger', { triggerId });
    return this.databaseService.flowTriggers.update(triggerId, input);
  }

  /**
   * Delete a trigger registration.
   */
  async deleteTrigger(triggerId: string): Promise<void> {
    this.logger.info('Deleting trigger', { triggerId });
    return this.databaseService.flowTriggers.delete(triggerId);
  }

  // =====================================
  // SYNC (publish flow → upsert triggers)
  // =====================================

  /**
   * Synchronise trigger registrations for a flow based on its latest
   * published definition.
   *
   * For every trigger node in the definition:
   *  - If a registration already exists for (flowId, nodeId): update type-specific fields
   *  - Otherwise: create a new registration
   *
   * Registrations whose nodeId no longer appears in the definition are deleted.
   */
  async syncTriggersForFlow(
    flowId: string,
    definition: { nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }> },
  ): Promise<FlowTriggerRegistration[]> {
    const triggerNodes = definition.nodes.filter((n) => triggerTypeFromActionId(n.type) !== null);

    // Fetch existing registrations
    const existing = await this.databaseService.flowTriggers.findByFlowId(flowId);
    const existingByNodeId = new Map(existing.map((t) => [t.nodeId, t]));

    const results: FlowTriggerRegistration[] = [];

    for (const node of triggerNodes) {
      const type = triggerTypeFromActionId(node.type);
      if (!type) {
        continue; // Skip unrecognised trigger action ids
      }
      const prev = existingByNodeId.get(node.id);

      if (prev) {
        // Update
        const update: UpdateTriggerInput = {};

        if (type === 'cron') {
          if (node.params?.expression) {
            update.cronExpression = node.params.expression as string;
          }
          if (node.params?.timezone) {
            update.cronTimezone = node.params.timezone as string;
          }
        }

        // Skip DB call when there's nothing to update (e.g. manual triggers)
        if (Object.keys(update).length > 0) {
          const updated = await this.databaseService.flowTriggers.update(prev.id, update);
          if (updated) {
            results.push(updated);
          }
        } else {
          results.push(prev);
        }

        existingByNodeId.delete(node.id);
      } else {
        // Create
        const input: CreateTriggerInput = {
          flowId,
          nodeId: node.id,
          type,
          isEnabled: true,
        };

        if (type === 'webhook') {
          input.webhookPath = generateWebhookPath();
          input.webhookSecret = generateWebhookSecret();
        }

        if (type === 'cron') {
          input.cronExpression = (node.params?.expression as string) || undefined;
          input.cronTimezone = (node.params?.timezone as string) || 'UTC';
        }

        const created = await this.databaseService.flowTriggers.create(input);
        results.push(created);
      }
    }

    // Delete orphan registrations (nodeId no longer in definition)
    for (const orphan of existingByNodeId.values()) {
      this.logger.info('Removing orphan trigger registration', {
        triggerId: orphan.id,
        nodeId: orphan.nodeId,
      });
      await this.databaseService.flowTriggers.delete(orphan.id);
    }

    return results;
  }

  // =====================================
  // CRON HELPERS
  // =====================================

  /**
   * Get all enabled cron triggers (for the cron scheduler to enumerate on startup).
   */
  async getEnabledCronTriggers(): Promise<FlowTriggerRegistration[]> {
    return this.databaseService.flowTriggers.findEnabledCronTriggers();
  }

  /**
   * Execute a cron trigger (called by the cron scheduler).
   */
  async executeCronTrigger(triggerId: string): Promise<{ flowRunId: string; flowId: string }> {
    const trigger = await this.databaseService.flowTriggers.findById(triggerId);

    if (!trigger) {
      throw new ValidationError('Cron trigger not found', 'triggerId', triggerId);
    }

    if (!trigger.isEnabled) {
      throw new ValidationError('Cron trigger is disabled', 'triggerId', triggerId);
    }

    // Check flow-level active flag — inactive flows skip cron execution
    const flow = await this.flowsService.getFlowById(trigger.flowId);
    if (!flow.isActive) {
      this.logger.info('Cron trigger skipped — flow is inactive', {
        triggerId: trigger.id,
        flowId: trigger.flowId,
      });
      throw new ValidationError('Flow is inactive', 'flowId', trigger.flowId);
    }

    this.logger.info('Executing cron trigger', {
      triggerId: trigger.id,
      flowId: trigger.flowId,
      expression: trigger.cronExpression,
    });

    const triggerData: Record<string, unknown> = {
      scheduledTime: new Date().toISOString(),
      expression: trigger.cronExpression,
      timezone: trigger.cronTimezone ?? 'UTC',
    };

    const result = await this.executeTrigger(
      {
        triggerType: 'cron',
        triggerNodeId: trigger.nodeId,
        triggerId: trigger.id,
        triggerData,
      },
      trigger.flowId,
    );

    // Update last triggered timestamp (fire-and-forget)
    this.databaseService.flowTriggers
      .update(trigger.id, { lastTriggeredAt: new Date().toISOString() })
      .catch((err) => this.logger.error('Failed to update lastTriggeredAt', { error: err }));

    return result;
  }

  /**
   * Execute all enabled cron triggers that are due for the provided time.
   * Used by serverless runtimes where an in-process scheduler is not available.
   */
  async executeDueCronTriggers(
    options: ExecuteDueCronTriggersOptions = {},
  ): Promise<ExecuteDueCronTriggersResult> {
    const now = this.normalizeNow(options.now);
    const claimedAt = now.toISOString();
    const triggers = await this.getEnabledCronTriggers();
    const result: ExecuteDueCronTriggersResult = {
      timestamp: claimedAt,
      checkedCount: triggers.length,
      dueCount: 0,
      claimedCount: 0,
      executedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };

    for (const trigger of triggers) {
      if (!trigger.cronExpression) {
        result.skippedCount += 1;
        continue;
      }

      let isDue = false;
      try {
        isDue = this.isCronTriggerDue(trigger, now);
      } catch (error) {
        this.logger.error('Failed to evaluate cron trigger schedule', {
          triggerId: trigger.id,
          expression: trigger.cronExpression,
          timezone: trigger.cronTimezone,
          error: error instanceof Error ? error.message : String(error),
        });
        result.failedCount += 1;
        continue;
      }

      if (!isDue) {
        continue;
      }

      result.dueCount += 1;

      const claimed = await this.databaseService.flowTriggers.claimDueCronExecution(
        trigger.id,
        trigger.lastTriggeredAt,
        claimedAt,
      );

      if (!claimed) {
        result.skippedCount += 1;
        this.logger.debug(
          'Skipping cron trigger execution because another worker already claimed it',
          {
            triggerId: trigger.id,
          },
        );
        continue;
      }

      result.claimedCount += 1;

      try {
        await this.executeCronTrigger(trigger.id);
        result.executedCount += 1;
      } catch (error) {
        result.failedCount += 1;
        this.logger.error('Failed to execute due cron trigger', {
          triggerId: trigger.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  // =====================================
  // PRIVATE
  // =====================================

  /**
   * Execute a flow via a trigger.
   *
   * Injects trigger metadata into flowInputs so that the trigger action node
   * can read it via `context.flowInputs.__triggerData`. Also passes trigger
   * provenance via options so it's recorded on the FlowRun record.
   */
  private async executeTrigger(
    options: TriggerExecutionOptions,
    flowId: string,
  ): Promise<{ flowRunId: string; flowId: string }> {
    // Inject trigger data into flowInputs for the trigger action to read.
    // Since FlowRunContext.flowInputs is Record<string, unknown>, objects are fine.
    const flowInputs: Record<string, unknown> = {
      __triggerData: options.triggerData,
      __triggerNodeId: options.triggerNodeId,
    };

    if (options.triggerId) {
      flowInputs.__triggerId = options.triggerId;
    }

    try {
      const result = await this.orchestrationService.executeFlowAsync(flowId, flowInputs, {
        triggerType: options.triggerType,
        triggerId: options.triggerId,
        triggerNodeId: options.triggerNodeId,
        triggerData: options.triggerData,
      });

      return {
        flowRunId: result.flowRunId,
        flowId,
      };
    } catch (error) {
      this.logger.error('Trigger execution failed', {
        triggerId: options.triggerId,
        flowId,
        error,
      });
      throw new DatabaseError('Failed to execute trigger', { error });
    }
  }

  private normalizeNow(now?: Date | string): Date {
    if (!now) {
      return new Date();
    }

    if (now instanceof Date) {
      return now;
    }

    const parsed = new Date(now);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError('Invalid maintenance timestamp', 'now', now);
    }

    return parsed;
  }

  private isCronTriggerDue(trigger: FlowTriggerRegistration, now: Date): boolean {
    if (!trigger.cronExpression) {
      return false;
    }

    const cron = new Cron(trigger.cronExpression, {
      timezone: trigger.cronTimezone ?? 'UTC',
      paused: true,
    });

    if (!cron.match(now)) {
      return false;
    }

    if (!trigger.lastTriggeredAt) {
      return true;
    }

    const lastTriggeredAt = new Date(trigger.lastTriggeredAt);
    if (Number.isNaN(lastTriggeredAt.getTime())) {
      return true;
    }

    return this.toMinuteBucket(lastTriggeredAt) !== this.toMinuteBucket(now);
  }

  private toMinuteBucket(value: Date): number {
    return Math.floor(value.getTime() / 60_000);
  }
}
