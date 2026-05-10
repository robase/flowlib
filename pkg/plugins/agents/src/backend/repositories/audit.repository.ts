/**
 * Persistence for `agent_audit_events`.
 *
 * Append-only — audit records are immutable. Provides `create`, `findById`,
 * and `list`. No `update` or `delete` (compliance / forensics).
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { encodeJson, generateId, nowFor, parseJson, toIso } from './util';

export type AgentAuditEventType =
  | 'tool_blocked'
  | 'secret_redacted'
  | 'secret_terminated'
  | 'sanitizer_warning'
  | 'mcp_rejected';

export interface AgentAuditEvent {
  id: string;
  orgId: string | null;
  sessionId: string;
  userId: string;
  eventType: AgentAuditEventType;
  toolName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AgentAuditEventRow {
  id: string;
  org_id: string | null;
  session_id: string;
  user_id: string;
  event_type: string;
  tool_name: string | null;
  payload: unknown;
  created_at: string | Date;
}

export interface CreateAuditEventInput {
  id?: string;
  orgId: string | null;
  sessionId: string;
  userId: string;
  eventType: AgentAuditEventType;
  toolName?: string | null;
  payload?: Record<string, unknown>;
}

export interface ListAuditEventsFilter {
  orgId?: string | null;
  sessionId?: string;
  userId?: string;
  eventType?: AgentAuditEventType;
  toolName?: string;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentAuditEventRow): AgentAuditEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    sessionId: row.session_id,
    userId: row.user_id,
    eventType: row.event_type as AgentAuditEventType,
    toolName: row.tool_name,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    createdAt: toIso(row.created_at),
  };
}

export class AuditRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentAuditEvent | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_audit_events')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentAuditEventRow) : null;
  }

  async list(filter: ListAuditEventsFilter = {}): Promise<AgentAuditEvent[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_audit_events').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    if (filter.sessionId !== undefined) {
      query = query.where('session_id', '=', filter.sessionId);
    }
    if (filter.userId !== undefined) {
      query = query.where('user_id', '=', filter.userId);
    }
    if (filter.eventType !== undefined) {
      query = query.where('event_type', '=', filter.eventType);
    }
    if (filter.toolName !== undefined) {
      query = query.where('tool_name', '=', filter.toolName);
    }
    query = query.orderBy('created_at', 'desc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentAuditEventRow));
  }

  async create(input: CreateAuditEventInput): Promise<AgentAuditEvent> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_audit_events')
      .values({
        id,
        org_id: input.orgId,
        session_id: input.sessionId,
        user_id: input.userId,
        event_type: input.eventType,
        tool_name: input.toolName ?? null,
        payload: encodeJson(input.payload ?? {}),
        created_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created audit event');
    }
    return created;
  }
}
