/**
 * Abstract `FlowlibPluginSchema` declaration for `@flowlib/agents`.
 *
 * Single source of truth for the plugin's tables. The CLI
 * (`npx flowlib-cli generate`) consumes this object, merges it with
 * `@flowlib/core`'s schema, and emits dialect-specific Drizzle files.
 *
 * See `plans/agents/data-model.md` for the column-by-column rationale.
 *
 * Tenant scoping: every table here gets a nullable `orgId` column
 * indexed for query performance. In single-tenant deployments the
 * column is `null` everywhere; in multi-tenant deployments every
 * row carries the resolved tenant id (`AgentsAuthContext.orgId`).
 *
 * `agent_role_permissions` is the lone exception — it stores
 * platform-defined role names (with org-scoped roles namespaced as
 * `org:${orgId}:${role}`) and stays flat without `orgId`.
 */

import type { FlowlibPluginSchema } from '@flowlib/db';

const VISIBILITY_VALUES = ['private', 'shared', 'public'] as const;
const SESSION_STATUS_VALUES = ['active', 'archived'] as const;
const MESSAGE_ROLE_VALUES = ['user', 'assistant', 'system'] as const;
const FILE_EDIT_KIND_VALUES = ['create', 'edit', 'delete'] as const;
const SHARE_ROLE_VALUES = ['viewer', 'editor'] as const;
const SKILL_SCOPE_VALUES = ['personal', 'global'] as const;
const MEMORY_SCOPE_VALUES = ['personal', 'project', 'global'] as const;
const MCP_TRANSPORT_VALUES = ['stdio', 'http', 'sse'] as const;
const HIL_STATE_VALUES = ['pending', 'resolved', 'timed_out', 'cancelled'] as const;
const AUDIT_EVENT_TYPE_VALUES = [
  'tool_blocked',
  'secret_redacted',
  'secret_terminated',
  'sanitizer_warning',
  'mcp_rejected',
] as const;
const WORKSPACE_PROVIDER_VALUES = [
  'local-fs',
  'git-clone',
  'cloudflare-sandbox',
  'remote-sandbox',
  'none',
] as const;

/** All `agent_*` tables, keyed by their logical names. */
export const agentSchema: FlowlibPluginSchema = {
  // ─── MCP servers (org-scoped catalogue) ─────────────────────────────
  // MCP servers are configured once at the org level and toggled per
  // session via `agent_sessions.enabledMcpServerIds`. Mirrors how
  // credentials are scoped — define once, opt in per chat.
  agent_mcp_servers: {
    tableName: 'agent_mcp_servers',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      name: { type: 'string', required: true },
      description: { type: 'text', required: false },
      transport: {
        type: MCP_TRANSPORT_VALUES as unknown as string[],
        required: true,
      },
      // Transport-specific. For `stdio`: `{ command, args, env }`.
      // For `http` / `sse`: `{ url, headers }`.
      config: {
        type: 'json',
        required: true,
        defaultValue: '{}',
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      createdBy: { type: 'string', required: true, index: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 50,
  },

  // ─── Workspaces ─────────────────────────────────────────────────────
  agent_workspaces: {
    tableName: 'agent_workspaces',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      name: { type: 'string', required: true },
      workspaceProviderId: {
        type: WORKSPACE_PROVIDER_VALUES as unknown as string[],
        required: true,
      },
      rootPath: { type: 'string', required: false },
      gitRemote: { type: 'string', required: false },
      gitBranch: { type: 'string', required: false },
      sandboxConfig: {
        type: 'json',
        required: false,
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      projectId: { type: 'uuid', required: false, index: true },
      createdBy: { type: 'string', required: true, index: true },
      visibility: {
        type: VISIBILITY_VALUES as unknown as string[],
        required: true,
        defaultValue: 'private',
      },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 40,
  },

  // ─── Workspace shares ───────────────────────────────────────────────
  agent_workspace_shares: {
    tableName: 'agent_workspace_shares',
    fields: {
      orgId: { type: 'string', required: false, index: true },
      workspaceId: {
        type: 'uuid',
        required: true,
        references: { table: 'agent_workspaces', field: 'id', onDelete: 'cascade' },
      },
      userId: { type: 'string', required: true, index: true },
      role: { type: SHARE_ROLE_VALUES as unknown as string[], required: true },
      grantedBy: { type: 'string', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    compositePrimaryKey: ['workspaceId', 'userId'],
    order: 60,
  },

  // ─── Sessions ───────────────────────────────────────────────────────
  // A session is a chat. It holds its own provider/model/MCP/tool config
  // — there is no separate "agent definition" preset. Sensible defaults
  // are filled in at create time so `POST /sessions { }` is enough to
  // start chatting.
  agent_sessions: {
    tableName: 'agent_sessions',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      providerSessionId: { type: 'string', required: true, index: true },
      title: { type: 'string', required: true, defaultValue: 'New chat' },
      // ── Provider / model ──
      providerId: { type: 'string', required: true, index: true },
      providerConfig: {
        type: 'json',
        required: true,
        defaultValue: '{}',
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      // Optional FK to the credential whose API key the LLM provider
      // should use. When null, providers fall back to their factory-
      // default credential (or fail if none is configured). Set per
      // session via POST /sessions { credentialId }.
      credentialId: { type: 'string', required: false, index: true },
      model: { type: 'string', required: false },
      permissionMode: { type: 'string', required: false },
      // ── System prompt (free-form preamble for the LLM) ──
      systemPrompt: { type: 'text', required: false },
      // ── Workspace ──
      workspaceId: {
        type: 'uuid',
        required: false,
        references: { table: 'agent_workspaces', field: 'id' },
      },
      // ── MCP / tools ──
      // Org-defined MCP servers opted in for this chat.
      enabledMcpServerIds: {
        type: 'json',
        required: true,
        defaultValue: '[]',
        typeAnnotation: 'string[]',
        jsonMode: true,
      },
      enabledTools: {
        type: 'json',
        required: false,
        typeAnnotation: 'string[]',
        jsonMode: true,
      },
      denyList: {
        type: 'json',
        required: false,
        typeAnnotation: 'string[]',
        jsonMode: true,
      },
      exposeFlowlibActions: { type: 'boolean', required: true, defaultValue: false },
      toolOutputBudget: {
        type: 'json',
        required: true,
        defaultValue: '{"lines":100,"bytes":4096}',
        typeAnnotation: '{ lines: number; bytes: number }',
        jsonMode: true,
      },
      // ── Ownership / lifecycle ──
      createdBy: { type: 'string', required: true, index: true },
      visibility: {
        type: VISIBILITY_VALUES as unknown as string[],
        required: true,
        defaultValue: 'private',
      },
      status: {
        type: SESSION_STATUS_VALUES as unknown as string[],
        required: true,
        defaultValue: 'active',
        index: true,
      },
      lastMessageAt: { type: 'date', required: false, index: true },
      messageCount: { type: 'number', required: true, defaultValue: 0 },
      inputTokensTotal: { type: 'number', required: true, defaultValue: 0 },
      outputTokensTotal: { type: 'number', required: true, defaultValue: 0 },
      costUsd: { type: 'string', required: true, defaultValue: '0' },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 70,
  },

  // ─── Session shares ─────────────────────────────────────────────────
  agent_session_shares: {
    tableName: 'agent_session_shares',
    fields: {
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      userId: { type: 'string', required: true, index: true },
      role: { type: SHARE_ROLE_VALUES as unknown as string[], required: true },
      grantedBy: { type: 'string', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    compositePrimaryKey: ['sessionId', 'userId'],
    order: 80,
  },

  // ─── Messages ───────────────────────────────────────────────────────
  agent_messages: {
    tableName: 'agent_messages',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        index: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      sequence: { type: 'number', required: true },
      parentMessageId: { type: 'uuid', required: false, index: true },
      role: { type: MESSAGE_ROLE_VALUES as unknown as string[], required: true },
      parts: {
        type: 'json',
        required: true,
        defaultValue: '[]',
        typeAnnotation: 'unknown[]',
        jsonMode: true,
      },
      usage: {
        type: 'json',
        required: false,
        typeAnnotation: 'Record<string, number>',
        jsonMode: true,
      },
      costUsd: { type: 'string', required: true, defaultValue: '0' },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      userId: { type: 'string', required: false, index: true },
    },
    order: 90,
  },

  // ─── Attachments ────────────────────────────────────────────────────
  agent_attachments: {
    tableName: 'agent_attachments',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        index: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      messageId: {
        type: 'uuid',
        required: true,
        references: { table: 'agent_messages', field: 'id', onDelete: 'cascade' },
      },
      name: { type: 'string', required: true },
      mediaType: { type: 'string', required: true },
      sizeBytes: { type: 'number', required: true },
      storageKey: { type: 'string', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 100,
  },

  // ─── File edits ─────────────────────────────────────────────────────
  agent_file_edits: {
    tableName: 'agent_file_edits',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        index: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      messageId: {
        type: 'uuid',
        required: true,
        references: { table: 'agent_messages', field: 'id', onDelete: 'cascade' },
      },
      path: { type: 'string', required: true },
      beforeSha: { type: 'string', required: false },
      afterSha: { type: 'string', required: false },
      kind: { type: FILE_EDIT_KIND_VALUES as unknown as string[], required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 110,
  },

  // ─── Session plans ──────────────────────────────────────────────────
  agent_session_plans: {
    tableName: 'agent_session_plans',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        unique: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      checkpoints: {
        type: 'json',
        required: true,
        defaultValue: '[]',
        typeAnnotation: 'Array<{ id: string; label: string; status: string }>',
        jsonMode: true,
      },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 120,
  },

  // ─── Skills ─────────────────────────────────────────────────────────
  agent_skills: {
    tableName: 'agent_skills',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      name: { type: 'string', required: true, index: true },
      description: { type: 'string', required: true },
      body: { type: 'text', required: true },
      scope: {
        type: SKILL_SCOPE_VALUES as unknown as string[],
        required: true,
        defaultValue: 'personal',
      },
      ownerId: { type: 'string', required: false, index: true },
      tags: {
        type: 'json',
        required: false,
        typeAnnotation: 'string[]',
        jsonMode: true,
      },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 130,
  },

  // ─── Memories ──────────────────────────────────────────────────────
  // Memories are scoped to a user, project, or org-globally. There's no
  // per-agent scope because there's no agent_definitions table.
  agent_memories: {
    tableName: 'agent_memories',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      scope: {
        type: MEMORY_SCOPE_VALUES as unknown as string[],
        required: true,
        index: true,
      },
      userId: { type: 'string', required: false, index: true },
      projectId: {
        type: 'uuid',
        required: false,
        index: true,
      },
      content: { type: 'text', required: true },
      // Stored as a serialised buffer on SQLite (manual cosine search) and
      // via pgvector on Postgres. The abstract field type maps to text/blob
      // per dialect; concrete vector types are dialect-specific so we keep
      // the abstract column flexible here.
      embedding: { type: 'text', required: false },
      tags: {
        type: 'json',
        required: false,
        typeAnnotation: 'string[]',
        jsonMode: true,
      },
      createdBy: { type: 'string', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      lastUsedAt: { type: 'date', required: false },
    },
    order: 150,
  },

  // ─── Projects ───────────────────────────────────────────────────────
  agent_projects: {
    tableName: 'agent_projects',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      name: { type: 'string', required: true },
      description: { type: 'text', required: false },
      gitRemote: { type: 'string', required: false, index: true },
      createdBy: { type: 'string', required: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 30,
  },

  // ─── Pending human actions (HIL) ────────────────────────────────────
  agent_pending_human_actions: {
    tableName: 'agent_pending_human_actions',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        index: true,
        references: { table: 'agent_sessions', field: 'id', onDelete: 'cascade' },
      },
      description: { type: 'text', required: true },
      link: { type: 'string', required: false },
      pollerConfig: {
        type: 'json',
        required: false,
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      state: {
        type: HIL_STATE_VALUES as unknown as string[],
        required: true,
        defaultValue: 'pending',
        index: true,
      },
      resolution: {
        type: 'json',
        required: false,
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      timeoutAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      resolvedAt: { type: 'date', required: false },
    },
    order: 160,
  },

  // ─── Audit events ───────────────────────────────────────────────────
  agent_audit_events: {
    tableName: 'agent_audit_events',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      orgId: { type: 'string', required: false, index: true },
      sessionId: {
        type: 'uuid',
        required: true,
        index: true,
      },
      userId: { type: 'string', required: true, index: true },
      eventType: {
        type: AUDIT_EVENT_TYPE_VALUES as unknown as string[],
        required: true,
        index: true,
      },
      toolName: { type: 'string', required: false, index: true },
      payload: {
        type: 'json',
        required: true,
        defaultValue: '{}',
        typeAnnotation: 'Record<string, unknown>',
        jsonMode: true,
      },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    order: 170,
  },

  // ─── Role permissions (placeholder shape — see open-questions Q42) ─
  agent_role_permissions: {
    tableName: 'agent_role_permissions',
    fields: {
      roleId: { type: 'string', required: true },
      toolName: { type: 'string', required: true },
      enabled: { type: 'boolean', required: true, defaultValue: true },
      reason: { type: 'text', required: false },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
    compositePrimaryKey: ['roleId', 'toolName'],
    order: 20,
  },
};
