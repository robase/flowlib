/**
 * Chat Messages Model — adapter-based implementation
 *
 * CRUD operations for persisted chat messages, scoped to flows.
 */

import type { FlowlibAdapter } from '../../database/adapter';
import type { Logger } from 'src/schemas';
import { randomUUID } from 'crypto';

// =====================================
// Entity types
// =====================================

export interface ChatMessageRecord {
  id: string;
  flowId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolMeta?: Record<string, unknown> | null;
  createdAt: string | Date;
}

export interface CreateChatMessageInput {
  flowId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolMeta?: Record<string, unknown> | null;
}

// =====================================
// Model
// =====================================

const TABLE = 'flowlib_chat_messages';

export class ChatMessagesModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Get all messages for a flow, ordered by creation time (oldest first).
   */
  async getByFlowId(
    flowId: string,
    options?: { limit?: number; page?: number },
  ): Promise<{
    data: ChatMessageRecord[];
    pagination: { page: number; limit: number; totalPages: number };
  }> {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 100);
    const page = Math.max(options?.page ?? 1, 1);
    const offset = (page - 1) * limit;

    try {
      const where = [{ field: 'flow_id' as const, value: flowId }];
      const [results, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where,
          sortBy: { field: 'created_at', direction: 'asc' },
          limit,
          offset,
        }),
        this.adapter.count({ model: TABLE, where }),
      ]);
      const totalPages = Math.ceil(totalCount / limit);
      return {
        data: results.map((r) => this.normalize(r)),
        pagination: { page, limit, totalPages },
      };
    } catch (error) {
      this.logger.error('Failed to get chat messages by flowId', { flowId, error });
      throw error;
    }
  }

  /**
   * Create a single chat message.
   */
  async create(input: CreateChatMessageInput): Promise<ChatMessageRecord> {
    const id = randomUUID();
    const now = new Date();
    try {
      await this.adapter.create({
        model: TABLE,
        data: {
          id,
          flow_id: input.flowId,
          role: input.role,
          content: input.content,
          tool_meta: input.toolMeta ?? null,
          created_at: now,
        },
      });

      return {
        id,
        flowId: input.flowId,
        role: input.role,
        content: input.content,
        toolMeta: input.toolMeta ?? null,
        createdAt: now.toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to create chat message', { input, error });
      throw error;
    }
  }

  /**
   * Create multiple chat messages in bulk (for saving an entire conversation).
   */
  async createMany(inputs: CreateChatMessageInput[]): Promise<ChatMessageRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    try {
      return this.insertAll(this.adapter, inputs);
    } catch (error) {
      this.logger.error('Failed to create chat messages in bulk', { count: inputs.length, error });
      throw error;
    }
  }

  /**
   * Replace the entire message list for a flow atomically: delete + insert in
   * a single transaction so a mid-save failure can't leave the table empty.
   */
  async replaceForFlow(
    flowId: string,
    inputs: CreateChatMessageInput[],
  ): Promise<ChatMessageRecord[]> {
    try {
      return await this.adapter.transaction(async (trx) => {
        await trx.delete({ model: TABLE, where: [{ field: 'flow_id', value: flowId }] });
        if (inputs.length === 0) {
          return [];
        }
        return this.insertAll(trx, inputs);
      });
    } catch (error) {
      this.logger.error('Failed to replace chat messages for flow', {
        flowId,
        count: inputs.length,
        error,
      });
      throw error;
    }
  }

  /**
   * Delete all chat messages for a flow.
   */
  async deleteByFlowId(flowId: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'flow_id', value: flowId }],
      });
    } catch (error) {
      this.logger.error('Failed to delete chat messages by flowId', { flowId, error });
      throw error;
    }
  }

  private async insertAll(
    target: FlowlibAdapter,
    inputs: CreateChatMessageInput[],
  ): Promise<ChatMessageRecord[]> {
    const records: ChatMessageRecord[] = [];
    const now = new Date();
    const nowIso = now.toISOString();
    for (const input of inputs) {
      const id = randomUUID();
      await target.create({
        model: TABLE,
        data: {
          id,
          flow_id: input.flowId,
          role: input.role,
          content: input.content,
          tool_meta: input.toolMeta ?? null,
          created_at: now,
        },
      });
      records.push({
        id,
        flowId: input.flowId,
        role: input.role,
        content: input.content,
        toolMeta: input.toolMeta ?? null,
        createdAt: nowIso,
      });
    }
    return records;
  }

  // =====================================
  // Normalize
  // =====================================

  private normalize(raw: Record<string, unknown>): ChatMessageRecord {
    const toolMetaRaw = raw.tool_meta ?? raw.toolMeta;
    let toolMeta: Record<string, unknown> | null = null;
    if (toolMetaRaw) {
      toolMeta =
        typeof toolMetaRaw === 'string'
          ? JSON.parse(toolMetaRaw)
          : (toolMetaRaw as Record<string, unknown>);
    }

    return {
      id: String(raw.id),
      flowId: String(raw.flow_id ?? raw.flowId),
      role: String(raw.role) as ChatMessageRecord['role'],
      content: String(raw.content ?? ''),
      toolMeta,
      createdAt: (raw.created_at ?? raw.createdAt ?? new Date()) as string | Date,
    };
  }
}
