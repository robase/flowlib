/**
 * Plugin factory smoke tests.
 *
 * Verifies `agents()` returns a valid `FlowlibPluginDefinition` and
 * that running the stub `init()` doesn't throw.
 */
import { describe, it, expect, vi } from 'vitest';
import { agents } from '../plugin';

function makeFlowlibCtx(overrides: Record<string, unknown> = {}) {
  const logs: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) =>
    (msg: string, meta?: unknown) => {
      logs.push({ level, msg, meta });
    };
  return {
    config: {},
    logger: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    },
    hasPlugin: vi.fn().mockReturnValue(false),
    getPlugin: vi.fn().mockReturnValue(null),
    registerAction: vi.fn(),
    store: new Map(),
    getFlowlib: vi.fn(),
    ...overrides,
    logs,
  } as never;
}

describe('agents() plugin factory', () => {
  it('returns a FlowlibPluginDefinition with id "agents"', () => {
    const def = agents();
    expect(def.id).toBe('agents');
    expect(def.name).toBe('Agents');
    expect(def.backend).toBeDefined();
    expect(def.frontend).toBeUndefined();
  });

  it('attaches the agent_* schema to backend.schema', () => {
    const def = agents();
    const schema = (def.backend as { schema: Record<string, unknown> }).schema;
    expect(schema).toBeDefined();
    expect(schema).toHaveProperty('agent_definitions');
    expect(schema).toHaveProperty('agent_workspaces');
    expect(schema).toHaveProperty('agent_sessions');
    expect(schema).toHaveProperty('agent_messages');
    expect(schema).toHaveProperty('agent_audit_events');
    expect(schema).toHaveProperty('agent_role_permissions');
  });

  it('runs init without throwing using stub register* calls', async () => {
    const def = agents();
    const ctx = makeFlowlibCtx();
    const init = (def.backend as { init?: (c: unknown) => Promise<void> }).init;
    expect(init).toBeTypeOf('function');
    await expect(init!(ctx)).resolves.toBeUndefined();
  });

  it('logs a warning when orgScope: required has no auth + no staticOrgId', async () => {
    const def = agents({ orgScope: 'required' });
    const ctx = makeFlowlibCtx();
    const init = (def.backend as { init?: (c: unknown) => Promise<void> }).init;
    await init!(ctx);
    const warnings = (ctx as unknown as { logs: Array<{ level: string; msg: string }> }).logs.filter(
      (l) => l.level === 'warn',
    );
    expect(warnings.some((w) => /default-org/.test(w.msg))).toBe(true);
  });

  it('does not warn about org tenancy when staticOrgId is configured', async () => {
    const def = agents({ orgScope: 'required', staticOrgId: 'acme' });
    const ctx = makeFlowlibCtx();
    const init = (def.backend as { init?: (c: unknown) => Promise<void> }).init;
    await init!(ctx);
    const warnings = (ctx as unknown as { logs: Array<{ level: string; msg: string }> }).logs.filter(
      (l) => l.level === 'warn',
    );
    // Subsystem registrars (permissions, audit) emit fallback warnings at
    // plugin init time because the repositories slot holds a per-request
    // factory, not a built bag — that's by design (Stream F's contract).
    // Those are scope-unrelated. Assert no org-tenancy warning is present.
    const orgWarnings = warnings.filter((w) => /default-org|orgScope/.test(w.msg));
    expect(orgWarnings).toHaveLength(0);
  });

  it('passes through frontend option', () => {
    const fakeFrontend = { sidebar: [{ label: 'Agents', path: '/agents' }] };
    const def = agents({ frontend: fakeFrontend });
    expect(def.frontend).toBe(fakeFrontend);
  });
});
