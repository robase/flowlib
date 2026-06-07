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

// ─── agent_mcp_servers ─────────────────────────────────────────────────

export interface AgentMcpServersTable {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  transport: string;
  /** JSON-encoded `Record<string, unknown>`. */
  config: string | unknown;
  created_by: string;
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
  provider_session_id: string;
  title: string;
  // ── Provider / model ──
  provider_id: string;
  /** JSON-encoded `Record<string, unknown>`. */
  provider_config: string | unknown;
  credential_id: string | null;
  model: string | null;
  permission_mode: string | null;
  // ── System prompt ──
  system_prompt: string | null;
  // ── Workspace ──
  workspace_id: string | null;
  // ── MCP / tools ──
  /** JSON-encoded `string[]` — ids of org-scoped MCP servers opted in. */
  enabled_mcp_server_ids: string | string[];
  /** JSON-encoded `string[]`. */
  enabled_tools: string | string[] | null;
  /** JSON-encoded `string[]`. */
  deny_list: string | string[] | null;
  expose_flowlib_actions: DialectBoolean;
  /** JSON-encoded `{ lines: number; bytes: number }`. */
  tool_output_budget: string | unknown;
  // ── Ownership / lifecycle ──
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

// ─── agent_skills ──────────────────────────────────────────────────────

export interface AgentSkillsTable {
  id: string;
  org_id: string | null;
  name: string;
  description: string;
  body: string;
  scope: string;
  owner_id: string | null;
  /** JSON-encoded `string[]`. */
  tags: string | string[] | null;
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
  agent_mcp_servers: AgentMcpServersTable;
  agent_workspaces: AgentWorkspacesTable;
  agent_sessions: AgentSessionsTable;
  agent_messages: AgentMessagesTable;
  agent_projects: AgentProjectsTable;
  agent_skills: AgentSkillsTable;
  agent_audit_events: AgentAuditEventsTable;
  agent_role_permissions: AgentRolePermissionsTable;
}
