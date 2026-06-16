/**
 * Browser-safe DTOs for the agents plugin.
 *
 * Pure type definitions — no runtime imports — so this module is safe to
 * pull into Vite/Webpack bundles via `@flowlib/agents/types`.
 *
 * The schema source-of-truth lives in `backend/schema/tables.ts`; this file
 * is the API surface mirror, intentionally narrower (no `created_at_unix`
 * leakage, etc.).
 */

export type { AgentEvent } from './events';
export type { AgentsAuthContext } from './auth-context';

// ─── Provider / capability surface ──────────────────────────────────────

export type AgentProviderId = 'claude-code' | 'opencode' | 'raw-llm' | (string & {});

export type AgentVisibility = 'private' | 'shared' | 'public';

export type AgentSessionStatus = 'active' | 'archived';

export type WorkspaceProviderId =
  | 'local-fs'
  | 'git-clone'
  | 'cloudflare-sandbox'
  | 'cloudflare-sandbox-claude'
  | 'computesdk'
  | 'local-docker'
  | 'remote-sandbox'
  | 'none';

// ─── Public DTOs (returned by REST endpoints) ──────────────────────────

/** Tool-output truncation budget (see `plans/agents/tools-and-mcp.md`). */
export interface ToolOutputBudget {
  /** Max lines surfaced inline before truncation. */
  lines: number;
  /** Max bytes surfaced inline before truncation. */
  bytes: number;
}

/** Wire shape for an MCP transport (stdio / http / sse). */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** Org-scoped MCP server registration — toggled per session by id. */
export interface AgentMcpServer {
  id: string;
  orgId: string | null;
  name: string;
  description: string | null;
  transport: McpTransport;
  /**
   * Transport-specific config. For `stdio`: `{ command, args, env }`.
   * For `http` / `sse`: `{ url, headers }`.
   */
  config: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Skill scope — `personal` is owner-visible, `global` is org-wide. */
export type SkillScope = 'personal' | 'global';

/**
 * An authored skill — a Markdown body the agent's system prompt can pull
 * in (progressive disclosure: summary in the prompt, body on demand via
 * `skills.read`). Org + scope + owner scoped on every read.
 */
export interface AgentSkill {
  id: string;
  orgId: string | null;
  name: string;
  description: string;
  body: string;
  scope: SkillScope;
  ownerId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** A workspace — provider-agnostic shape. */
export interface AgentWorkspace {
  id: string;
  orgId: string | null;
  name: string;
  workspaceProviderId: WorkspaceProviderId;
  rootPath: string | null;
  gitRemote: string | null;
  gitBranch: string | null;
  sandboxConfig: Record<string, unknown> | null;
  projectId: string | null;
  createdBy: string;
  visibility: AgentVisibility;
  createdAt: string;
  updatedAt: string;
}

/**
 * A chat session — the unit of interaction. Carries its own provider /
 * model / MCP / tool config inline; there is no separate agent
 * definition to indirect through.
 */
export interface AgentSession {
  id: string;
  orgId: string | null;
  providerSessionId: string;
  title: string;
  // Provider / model
  providerId: AgentProviderId;
  providerConfig: Record<string, unknown>;
  /**
   * Optional FK to the Flowlib credential whose API key the LLM provider
   * should use. When null, providers fall back to their factory-default
   * credential. Set per-session via `POST /sessions { credentialId }`.
   */
  credentialId: string | null;
  model: string | null;
  permissionMode: string | null;
  // System prompt (free-form preamble for the LLM)
  systemPrompt: string | null;
  // Workspace
  workspaceId: string | null;
  // MCP / tools
  enabledMcpServerIds: string[];
  enabledTools: string[] | null;
  denyList: string[] | null;
  exposeFlowlibActions: boolean;
  toolOutputBudget: ToolOutputBudget;
  // Ownership / lifecycle
  createdBy: string;
  visibility: AgentVisibility;
  status: AgentSessionStatus;
  lastMessageAt: string | null;
  messageCount: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  costUsd: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Tenant-scoped Durable Object name the frontend should pass to
   * `useAgent({ agent: 'AgentChatDO', name: doAgentName })`. Computed
   * server-side so the naming scheme stays on the backend.
   */
  doAgentName?: string;
  /**
   * Which chat transport the frontend should use for this session,
   * decided server-side by whether a Cloudflare Durable Object is wired
   * into the deployment:
   *   - `'durable-object'` — connect a WebSocket to `AgentChatDO` (Cloudflare).
   *   - `'http'` — POST to `/sessions/:id/stream` (SSE) + `/sessions/:id/control`
   *     (Express/Node and any non-CF host).
   */
  transportMode?: 'durable-object' | 'http';
}

/** An assistant or user message — message parts encode rich content. */
export interface AgentMessage {
  id: string;
  orgId: string | null;
  sessionId: string;
  sequence: number;
  parentMessageId: string | null;
  role: 'user' | 'assistant' | 'system';
  parts: AgentMessagePart[];
  usage: AgentMessageUsage | null;
  costUsd: string;
  createdAt: string;
  userId: string | null;
}

export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | {
      type: 'tool-result';
      id: string;
      output: unknown;
      truncated?: boolean;
      fullOutputRef?: string;
    }
  | { type: 'image'; mediaType: string; data: string };

export interface AgentMessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ─── Plugin options surface ────────────────────────────────────────────

/**
 * Mode for tenant scoping enforcement. Controls how aggressively the
 * plugin pre-flight checks the auth wiring.
 */
export type OrgScope =
  /** No org id required — single-tenant fallback always wins. */
  | 'optional'
  /**
   * `orgId` must come from a real auth context. The plugin still boots
   * if it doesn't; it just logs a warning. Structural isolation degrades
   * to "everything is `default-org`" but the plugin is functional.
   */
  | 'required';

/** Public option shape exposed to plugin consumers. */
export interface AgentsPluginPublicOptions {
  /**
   * Static org id used when the host's auth plugin doesn't populate
   * `identity.metadata.orgId`. Defaults to `'default-org'`.
   */
  staticOrgId?: string;
  /**
   * Tenancy enforcement mode. See {@link OrgScope}.
   * @default 'optional'
   */
  orgScope?: OrgScope;
  /**
   * Provider id used when `POST /sessions` is called with no
   * `providerId`. Must match one of the registered provider ids.
   * @default 'opencode'
   */
  defaultProviderId?: string;
  /**
   * Model id used when `POST /sessions` omits `model`. Format depends
   * on the provider — opencode uses `'<vendor>/<model>'`, claude-code
   * uses Anthropic's bare model id.
   * @default 'anthropic/claude-sonnet-4-5'
   */
  defaultModel?: string;
}
