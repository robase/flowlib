/**
 * Persistence for `agent_messages`.
 *
 * Append-mostly. Messages are immutable once written; mutation happens
 * indirectly through the parent session (cascade-delete only).
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentMessage, AgentMessagePart, AgentMessageUsage } from '../../shared/types';
import type { AgentsDB } from './db-types';
import {
  encodeJson,
  encodeJsonOrNull,
  generateId,
  nowFor,
  parseJson,
  parseJsonOrNull,
  toIso,
} from './util';

interface AgentMessageRow {
  id: string;
  org_id: string | null;
  session_id: string;
  sequence: number;
  parent_message_id: string | null;
  role: string;
  parts: unknown;
  usage: unknown;
  cost_usd: string;
  created_at: string | Date;
  user_id: string | null;
}

export interface CreateMessageInput {
  id?: string;
  orgId: string | null;
  sessionId: string;
  sequence: number;
  parentMessageId?: string | null;
  role: 'user' | 'assistant' | 'system';
  parts: AgentMessagePart[];
  usage?: AgentMessageUsage | null;
  costUsd?: string;
  userId?: string | null;
}

export interface ListMessagesFilter {
  orgId?: string | null;
  sessionId?: string;
  /** Pagination — returns messages with sequence > this. */
  afterSequence?: number;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    orgId: row.org_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    parentMessageId: row.parent_message_id,
    role: row.role as 'user' | 'assistant' | 'system',
    parts: parseJson<AgentMessagePart[]>(row.parts, []),
    usage: parseJsonOrNull<AgentMessageUsage>(row.usage),
    costUsd: row.cost_usd,
    createdAt: toIso(row.created_at),
    userId: row.user_id,
  };
}

export class MessagesRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentMessage | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_messages')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentMessageRow) : null;
  }

  async list(filter: ListMessagesFilter = {}): Promise<AgentMessage[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_messages').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    if (filter.sessionId !== undefined) {
      query = query.where('session_id', '=', filter.sessionId);
    }
    if (filter.afterSequence !== undefined) {
      query = query.where('sequence', '>', filter.afterSequence);
    }
    query = query.orderBy('sequence', 'asc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentMessageRow));
  }

  async create(input: CreateMessageInput): Promise<AgentMessage> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_messages')
      .values({
        id,
        org_id: input.orgId,
        session_id: input.sessionId,
        sequence: input.sequence,
        parent_message_id: input.parentMessageId ?? null,
        role: input.role,
        parts: encodeJson(input.parts),
        usage: encodeJsonOrNull(input.usage ?? null),
        cost_usd: input.costUsd ?? '0',
        created_at: now,
        user_id: input.userId ?? null,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created message');
    }
    return created;
  }
}
