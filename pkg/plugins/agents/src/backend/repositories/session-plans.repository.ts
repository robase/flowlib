/**
 * Persistence for `agent_session_plans` — the agent's working task list
 * for a session (TodoWrite-style). One plan per session (`session_id` is
 * unique); the agent replaces the whole checkpoint list each time it
 * calls `update_plan`. The plan is rendered back into the system prompt
 * ("## Session plan") so the agent stays oriented across a multi-step
 * task, and surfaced to the UI.
 *
 * Tenant scoped — every query is bounded by `orgId`.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { generateId, nowFor, parseJson, toIso } from './util';

export type CheckpointStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface PlanCheckpoint {
  id: string;
  label: string;
  status: CheckpointStatus;
}

export interface AgentSessionPlan {
  sessionId: string;
  orgId: string | null;
  checkpoints: PlanCheckpoint[];
  updatedAt: string;
}

interface AgentSessionPlanRow {
  id: string;
  org_id: string | null;
  session_id: string;
  checkpoints: string | unknown;
  updated_at: string | Date;
}

const STATUSES: ReadonlySet<string> = new Set(['todo', 'doing', 'done', 'blocked']);

function coerceStatus(value: unknown): CheckpointStatus {
  return typeof value === 'string' && STATUSES.has(value) ? (value as CheckpointStatus) : 'todo';
}

function mapRow(row: AgentSessionPlanRow): AgentSessionPlan {
  const raw = parseJson<Array<Partial<PlanCheckpoint>>>(row.checkpoints, []);
  return {
    sessionId: row.session_id,
    orgId: row.org_id,
    checkpoints: raw.map((c) => ({
      id: typeof c.id === 'string' ? c.id : generateId(),
      label: typeof c.label === 'string' ? c.label : '',
      status: coerceStatus(c.status),
    })),
    updatedAt: toIso(row.updated_at),
  };
}

export class SessionPlansRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async get(sessionId: string, orgId?: string | null): Promise<AgentSessionPlan | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_session_plans')
      .selectAll()
      .where('session_id', '=', sessionId);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentSessionPlanRow) : null;
  }

  /**
   * Replace the session's plan with `checkpoints` (the whole list). Creates
   * the row on first call, updates it thereafter. Missing checkpoint ids are
   * generated; statuses are coerced to the known set.
   */
  async upsert(
    sessionId: string,
    orgId: string | null,
    checkpoints: ReadonlyArray<{ id?: string; label: string; status?: string }>,
  ): Promise<AgentSessionPlan> {
    const normalised: PlanCheckpoint[] = checkpoints.map((c) => ({
      id: c.id && c.id.length > 0 ? c.id : generateId(),
      label: c.label,
      status: coerceStatus(c.status),
    }));
    const now = nowFor(this.database);
    const existing = await this.get(sessionId, orgId);
    const k = this.database.kysely<AgentsDB>();

    if (existing) {
      let query = k
        .updateTable('agent_session_plans')
        .set({ checkpoints: JSON.stringify(normalised), updated_at: now } as never)
        .where('session_id', '=', sessionId);
      if (orgId !== undefined) {
        query =
          orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
      }
      await query.execute();
    } else {
      await k
        .insertInto('agent_session_plans')
        .values({
          id: generateId(),
          org_id: orgId,
          session_id: sessionId,
          checkpoints: JSON.stringify(normalised),
          updated_at: now,
        } as never)
        .execute();
    }

    return { sessionId, orgId, checkpoints: normalised, updatedAt: toIso(now) };
  }
}
