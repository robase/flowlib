/**
 * Kysely DB shape for the agents plugin's queries.
 *
 * The abstract schema in `../schema/tables.ts` is the source of truth for
 * migrations (consumed by `flowlib-cli generate`); this file mirrors the
 * resulting columns for Kysely's typed query builder.
 *
 * See `pkg/db/src/kysely-types.ts` for type conventions (date columns are
 * typed as ISO strings; booleans accept `boolean | 0 | 1`; JSON columns
 * are stored as text on SQLite/MySQL, jsonb on Postgres — repositories
 * normalise via JSON.parse defensively).
 */

import type { DialectBoolean, TimestampColumn } from '@flowlib/db/kysely';

// ─── agent_definitions ─────────────────────────────────────────────────

export interface AgentDefinitionsTable {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  provider_id: string;
  /** JSON-encoded `Record<string, unknown>`. */
  provider_config: string | unknown;
  workspace_id: string | null;
  persona_id: string | null;
  persona_text: string | null;
  default_model: string | null;
  /** JSON-encoded `Record<string, unknown>`. */
  mcp_servers: string | unknown;
  /** JSON-encoded `string[]`. */
  enabled_tools: string | string[] | null;
  /** JSON-encoded `string[]`. */
  deny_list: string | string[] | null;
  expose_flowlib_actions: DialectBoolean;
  /** JSON-encoded `{ lines: number; bytes: number }`. */
  tool_output_budget: string | unknown;
  created_by: string;
  visibility: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

// ─── agent_workspaces ──────────────────────────────────────────────────

export interface AgentWorkspacesTable {
  id: string;
  org_id: string | null;
  name: string;
  workspace_provider_id: string;
  root_path: string | null;
  git_remote: string | null;
  git_branch: string | null;
  /** JSON-encoded `Record<string, unknown>`. */
  sandbox_config: string | unknown | null;
  project_id: string | null;
  created_by: string;
  visibility: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

// ─── agent_sessions ────────────────────────────────────────────────────

export interface AgentSessionsTable {
  id: string;
  org_id: string | null;
  agent_id: string;
  provider_session_id: string;
  title: string;
  model: string | null;
  permission_mode: string | null;
  workspace_id: string | null;
  /** JSON-encoded `string[]`. */
  enabled_tools: string | string[] | null;
  /** JSON-encoded `string[]`. */
  extra_denied: string | string[] | null;
  created_by: string;
  visibility: string;
  status: string;
  last_message_at: TimestampColumn | null;
  message_count: number;
  input_tokens_total: number;
  output_tokens_total: number;
  cost_usd: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

// ─── agent_messages ────────────────────────────────────────────────────

export interface AgentMessagesTable {
  id: string;
  org_id: string | null;
  session_id: string;
  sequence: number;
  parent_message_id: string | null;
  role: string;
  /** JSON-encoded `unknown[]`. */
  parts: string | unknown[];
  /** JSON-encoded `Record<string, number>`. */
  usage: string | unknown | null;
  cost_usd: string;
  created_at: TimestampColumn;
  user_id: string | null;
}

// ─── agent_projects ────────────────────────────────────────────────────

export interface AgentProjectsTable {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  git_remote: string | null;
  created_by: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

// ─── agent_audit_events ────────────────────────────────────────────────

export interface AgentAuditEventsTable {
  id: string;
  org_id: string | null;
  session_id: string;
  user_id: string;
  event_type: string;
  tool_name: string | null;
  /** JSON-encoded `Record<string, unknown>`. */
  payload: string | unknown;
  created_at: TimestampColumn;
}

// ─── agent_role_permissions ────────────────────────────────────────────

export interface AgentRolePermissionsTable {
  role_id: string;
  tool_name: string;
  enabled: DialectBoolean;
  reason: string | null;
  updated_at: TimestampColumn;
}

// ─── Aggregate DB interface ────────────────────────────────────────────

export interface AgentsDB {
  agent_definitions: AgentDefinitionsTable;
  agent_workspaces: AgentWorkspacesTable;
  agent_sessions: AgentSessionsTable;
  agent_messages: AgentMessagesTable;
  agent_projects: AgentProjectsTable;
  agent_audit_events: AgentAuditEventsTable;
  agent_role_permissions: AgentRolePermissionsTable;
}
