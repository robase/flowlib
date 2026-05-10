/**
 * Audit log writer — Stream J implementation.
 *
 * Append-only writer for `agent_audit_events`. Used by every guard
 * layer that hard-blocks or modifies a tool call:
 *
 *   - Stream A's hook pipeline (PreToolUse / PostToolUse denies)
 *   - Stream G's MCP bridge (rejected tool calls, tools removed from
 *     the catalogue at session start)
 *   - Stream H/A's secret redactor (SOFT redactions and HARD
 *     terminations)
 *   - Stream A's input sanitizer (when injection patterns trigger a
 *     wrapper warning)
 *
 * Schema (`pkg/plugins/agents/src/backend/schema/tables.ts`):
 *
 *   agent_audit_events:
 *     id          uuid PK
 *     orgId       string  (nullable, indexed)
 *     sessionId   uuid    (indexed)
 *     userId      string  (indexed)
 *     eventType   enum    (indexed)  — see `AGENT_AUDIT_EVENT_TYPES`
 *     toolName    string? (indexed)
 *     payload     json    (default '{}')
 *     createdAt   date
 *
 * Event-type enum is defined alongside the schema; we mirror it
 * here as a string literal union so callers get a tight surface.
 */

/**
 * The five audit event types the v1 plugin records. Mirrors the
 * `AUDIT_EVENT_TYPE_VALUES` array in `schema/tables.ts`. Kept in
 * sync by hand — the schema array is `as const` so a future test
 * could assert structural equality if drift becomes a concern.
 */
export type AgentAuditEventType =
  | 'tool_blocked'
  | 'secret_redacted'
  | 'secret_terminated'
  | 'sanitizer_warning'
  | 'mcp_rejected';

/**
 * Caller-supplied event payload. `toolName` is optional because the
 * sanitizer-warning event isn't always tied to a single tool, and
 * the payload bag is freeform JSON for the consumer to interpret.
 */
export interface AuditEventInput {
  sessionId: string;
  userId: string;
  eventType: AgentAuditEventType;
  toolName?: string;
  payload?: Record<string, unknown>;
  /**
   * Tenant id. When omitted, the writer leaves `orgId` `null` —
   * single-tenant deployments do this; multi-tenant callers should
   * pass `auth.orgId`.
   */
  orgId?: string | null;
}

/**
 * Persisted row shape, useful for callers that want the inserted
 * row back (e.g. to surface in a response). `id` and `createdAt`
 * are populated by the underlying repository.
 */
export interface AgentAuditEventRecord {
  id: string;
  orgId: string | null;
  sessionId: string;
  userId: string;
  eventType: AgentAuditEventType;
  toolName: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Minimal repository surface the writer needs. Stream F owns the
 * concrete implementation on `ctx.registries.repositories.audit`;
 * tests mock this interface directly.
 *
 * `create` is fire-and-forget at the call site (callers should not
 * block on it for tool-rejection paths) but the underlying
 * implementation may persist synchronously. The writer surfaces
 * write errors via the logger but never throws — audit failures
 * must not break the request path.
 */
export interface AuditRepository {
  create(input: {
    sessionId: string;
    userId: string;
    eventType: AgentAuditEventType;
    toolName: string | null;
    payload: Record<string, unknown>;
    orgId: string | null;
  }): Promise<AgentAuditEventRecord>;
}

/**
 * Logger surface — matches `FlowlibPluginContext['logger']` minimally.
 * The real plugin context supplies a richer scoped logger; the
 * writer only needs `error` for audit-write failures and `debug`
 * for visibility.
 */
export interface AuditWriterLogger {
  debug(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/**
 * Public writer surface. Stream A / G / H call `.write()` on every
 * blocked tool call, redaction, sanitizer trigger, or MCP rejection.
 */
export interface AuditWriter {
  write(input: AuditEventInput): Promise<AgentAuditEventRecord | null>;
}

export interface AuditWriterDeps {
  audit: AuditRepository;
  logger: AuditWriterLogger;
}

/**
 * Build an `AuditWriter` from explicit dependencies.
 *
 * The writer normalises optional fields (defaults `payload` to `{}`,
 * `toolName` to `null`, `orgId` to `null`) and swallows persistence
 * errors after logging them. `write()` returns the inserted record
 * on success, or `null` when persistence failed — callers that need
 * the record (admin UI replays) check the return; callers that just
 * want fire-and-forget audit (hook pipeline) ignore it.
 */
export function createWriter(deps: AuditWriterDeps): AuditWriter {
  return {
    async write(input: AuditEventInput): Promise<AgentAuditEventRecord | null> {
      const row = {
        sessionId: input.sessionId,
        userId: input.userId,
        eventType: input.eventType,
        toolName: input.toolName ?? null,
        payload: input.payload ?? {},
        orgId: input.orgId ?? null,
      };

      try {
        const record = await deps.audit.create(row);
        deps.logger.debug('[agents] audit event written', {
          eventType: row.eventType,
          sessionId: row.sessionId,
          toolName: row.toolName,
        });
        return record;
      } catch (err) {
        // Audit failures must not break the request path. Log loudly
        // so ops can spot persistence regressions, then swallow.
        deps.logger.error('[agents] audit event write failed', {
          eventType: row.eventType,
          sessionId: row.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  };
}
