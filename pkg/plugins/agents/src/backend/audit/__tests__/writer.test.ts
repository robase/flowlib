/**
 * Tests for the audit log writer.
 *
 * Covers:
 *  - Insert with all five `eventType` values
 *  - Default normalisation (`payload`, `toolName`, `orgId`)
 *  - Persistence-error swallowing (logs but doesn't throw)
 *  - The no-op writer installed by `registerAudit` when no audit
 *    repository is on the registries bag
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWriter,
  type AgentAuditEventRecord,
  type AgentAuditEventType,
  type AuditRepository,
  type AuditWriterLogger,
} from '../writer';
import { registerAudit } from '../register';
import type { PluginContext } from '../../plugin-context';

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeLogger(): AuditWriterLogger & {
  debugCalls: Array<{ msg: string; meta?: unknown }>;
  errorCalls: Array<{ msg: string; meta?: unknown }>;
} {
  const debugCalls: Array<{ msg: string; meta?: unknown }> = [];
  const errorCalls: Array<{ msg: string; meta?: unknown }> = [];
  return {
    debug: (msg, meta) => debugCalls.push({ msg, meta }),
    error: (msg, meta) => errorCalls.push({ msg, meta }),
    debugCalls,
    errorCalls,
  };
}

function makeRepo(
  override?: Partial<AuditRepository> & {
    nextId?: () => string;
    nextDate?: () => Date;
  },
): AuditRepository & { calls: Array<Parameters<AuditRepository['create']>[0]> } {
  const calls: Array<Parameters<AuditRepository['create']>[0]> = [];
  const nextId = override?.nextId ?? (() => 'audit-id-1');
  const nextDate = override?.nextDate ?? (() => new Date('2026-05-09T00:00:00Z'));
  return {
    calls,
    create: vi.fn(async (input): Promise<AgentAuditEventRecord> => {
      calls.push(input);
      return {
        id: nextId(),
        ...input,
        createdAt: nextDate(),
      };
    }),
    ...override,
  };
}

const ALL_EVENT_TYPES: ReadonlyArray<AgentAuditEventType> = [
  'tool_blocked',
  'secret_redacted',
  'secret_terminated',
  'sanitizer_warning',
  'mcp_rejected',
];

// ─── Tests ─────────────────────────────────────────────────────────────

describe('createWriter — write()', () => {
  it.each(ALL_EVENT_TYPES)('inserts an audit row for eventType=%s', async (eventType) => {
    const audit = makeRepo();
    const logger = makeLogger();
    const writer = createWriter({ audit, logger });

    const record = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType,
      toolName: 'Bash',
      payload: { reason: 'blocked by role policy' },
      orgId: 'org-1',
    });

    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toEqual({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType,
      toolName: 'Bash',
      payload: { reason: 'blocked by role policy' },
      orgId: 'org-1',
    });
    expect(record).toMatchObject({
      id: expect.any(String),
      eventType,
      toolName: 'Bash',
      payload: { reason: 'blocked by role policy' },
    });
    expect(logger.debugCalls).toHaveLength(1);
    expect(logger.errorCalls).toHaveLength(0);
  });

  it('defaults toolName to null when omitted', async () => {
    const audit = makeRepo();
    const writer = createWriter({ audit, logger: makeLogger() });

    await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'sanitizer_warning',
      payload: { source: 'tool-result' },
    });

    expect(audit.calls[0].toolName).toBe(null);
  });

  it('defaults payload to {} when omitted', async () => {
    const audit = makeRepo();
    const writer = createWriter({ audit, logger: makeLogger() });

    await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'mcp_rejected',
    });

    expect(audit.calls[0].payload).toEqual({});
  });

  it('defaults orgId to null when omitted (single-tenant)', async () => {
    const audit = makeRepo();
    const writer = createWriter({ audit, logger: makeLogger() });

    await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
    });

    expect(audit.calls[0].orgId).toBe(null);
  });

  it('respects explicit null orgId', async () => {
    const audit = makeRepo();
    const writer = createWriter({ audit, logger: makeLogger() });

    await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
      orgId: null,
    });

    expect(audit.calls[0].orgId).toBe(null);
  });

  it('returns the persisted record on success', async () => {
    const audit = makeRepo({ nextId: () => 'fixed-id-42' });
    const writer = createWriter({ audit, logger: makeLogger() });

    const record = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
    });

    expect(record).not.toBeNull();
    expect(record!.id).toBe('fixed-id-42');
  });

  it('swallows persistence errors and returns null', async () => {
    const failingAudit: AuditRepository = {
      create: vi.fn(async () => {
        throw new Error('db connection lost');
      }),
    };
    const logger = makeLogger();
    const writer = createWriter({ audit: failingAudit, logger });

    const record = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
    });

    expect(record).toBe(null);
    expect(logger.errorCalls).toHaveLength(1);
    expect(logger.errorCalls[0].msg).toMatch(/audit event write failed/);
  });

  it('swallows non-Error throws (e.g. string rejections) without crashing', async () => {
    const failingAudit: AuditRepository = {
      create: vi.fn(async () => {
        throw 'kaboom';
      }),
    };
    const logger = makeLogger();
    const writer = createWriter({ audit: failingAudit, logger });

    const record = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'mcp_rejected',
    });

    expect(record).toBe(null);
    expect(logger.errorCalls).toHaveLength(1);
  });
});

// ─── Registrar tests ───────────────────────────────────────────────────

function makePluginContext(repos?: { audit?: AuditRepository }): PluginContext {
  const logCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) => (msg: string, meta?: unknown) => {
    logCalls.push({ level, msg, meta });
  };
  const ctx = {
    options: {
      staticOrgId: 'default-org',
      orgScope: 'optional' as const,
      providers: [],
      workspaceProviders: [],
      exposeFlowlibActions: false,
      defaultDenyList: [],
      defaultProviderId: 'opencode',
      defaultModel: 'anthropic/claude-sonnet-4-5',
    },
    flowlib: {} as PluginContext['flowlib'],
    actionRegistry: {} as PluginContext['actionRegistry'],
    registries: {
      providers: new Map(),
      workspaces: new Map(),
      repositories: repos,
    } as PluginContext['registries'],
    logger: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    } as PluginContext['logger'],
  } satisfies PluginContext;
  // Stash log calls on the context for assertions.
  (ctx as unknown as { logCalls: typeof logCalls }).logCalls = logCalls;
  return ctx;
}

describe('registerAudit', () => {
  it('installs a real writer when repos.audit is present', async () => {
    const audit = makeRepo();
    const ctx = makePluginContext({ audit });

    const writer = registerAudit(ctx);
    expect(ctx.registries.auditWriter).toBe(writer);

    await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
    });

    expect(audit.calls).toHaveLength(1);
  });

  it('falls back to a no-op writer when repos.audit is missing', async () => {
    const ctx = makePluginContext(undefined);

    const writer = registerAudit(ctx);
    expect(ctx.registries.auditWriter).toBe(writer);

    const result = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
    });
    expect(result).toBe(null);

    const logs = (ctx as unknown as { logCalls: Array<{ level: string; msg: string }> }).logCalls;
    expect(logs.some((l) => l.level === 'warn' && /no audit repository/.test(l.msg))).toBe(true);
  });

  it('falls back to a no-op writer when repos object exists but lacks .audit', async () => {
    const ctx = makePluginContext({});

    const writer = registerAudit(ctx);

    const result = await writer.write({
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'sanitizer_warning',
    });
    expect(result).toBe(null);
  });
});
