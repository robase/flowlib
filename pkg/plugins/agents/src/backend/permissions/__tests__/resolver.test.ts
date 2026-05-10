/**
 * Tests for the permissions resolver.
 *
 * Covers the resolution-order contract in
 * `plans/agents/rbac-and-visibility.md#tool-rbac`:
 *   1. empty deny set
 *   2. role denies
 *   3. agent denies
 *   4. session extra denies
 *   5. session whitelist subtraction
 *   6. superadmin bypass
 *
 * Also covers the no-permissions fast path and `isToolAllowed()`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createResolver,
  type RolePermissionRow,
  type RolePermissionsRepository,
} from '../resolver';
import { registerPermissions } from '../register';
import { allowAllResolver, type ResolveDenyListInput } from '../types';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { PluginContext } from '../../plugin-context';

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeAuth(overrides: Partial<AgentsAuthContext> = {}): AgentsAuthContext {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    role: 'user',
    teamIds: [],
    ...overrides,
  };
}

function makeRepo(rows: ReadonlyArray<RolePermissionRow>): RolePermissionsRepository {
  return {
    listByRole: vi.fn(async (roleId: string) => rows.filter((r) => r.roleId === roleId)),
  };
}

function makeInput(overrides: Partial<ResolveDenyListInput> = {}): ResolveDenyListInput {
  return {
    auth: makeAuth(),
    sessionId: 'sess-1',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('createResolver — getEffectiveDenyList', () => {
  it('returns empty set when no permissions exist (fast path)', async () => {
    const repo = makeRepo([]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(makeInput());

    expect(deny).toBeInstanceOf(Set);
    expect(deny.size).toBe(0);
  });

  it('adds role-derived denies (rows with enabled=false)', async () => {
    const repo = makeRepo([
      { roleId: 'user', toolName: 'Bash', enabled: false },
      { roleId: 'user', toolName: 'WebFetch', enabled: false },
      { roleId: 'user', toolName: 'Read', enabled: true }, // explicit allow — ignored
      { roleId: 'admin', toolName: 'Bash', enabled: false }, // wrong role — ignored
    ]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(makeInput());

    expect([...deny].sort()).toEqual(['Bash', 'WebFetch']);
  });

  it('combines role denies with per-agent denyList', async () => {
    const repo = makeRepo([{ roleId: 'user', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({ agentDenyList: ['WebFetch', 'Bash'] }),
    );

    // Bash appears in both — should still be a set (no duplicates).
    expect([...deny].sort()).toEqual(['Bash', 'WebFetch']);
  });

  it('combines role denies with session extraDenied', async () => {
    const repo = makeRepo([{ roleId: 'user', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({ sessionExtraDenied: ['DeleteFile'] }),
    );

    expect([...deny].sort()).toEqual(['Bash', 'DeleteFile']);
  });

  it('combines role + agent + session denies in one resolution', async () => {
    const repo = makeRepo([{ roleId: 'user', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({
        agentDenyList: ['WebFetch'],
        sessionExtraDenied: ['DeleteFile'],
      }),
    );

    expect([...deny].sort()).toEqual(['Bash', 'DeleteFile', 'WebFetch']);
  });

  it('whitelist mode denies tools outside the whitelist (intersect)', async () => {
    const repo = makeRepo([
      { roleId: 'user', toolName: 'Bash', enabled: false },
      { roleId: 'user', toolName: 'WebFetch', enabled: true },
    ]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({
        agentEnabledTools: ['Read', 'Write', 'Bash', 'WebFetch', 'Edit'],
        sessionEnabledTools: ['Read', 'Write'],
      }),
    );

    // Whitelist = {Read, Write}. Universe = {Read, Write, Bash, WebFetch, Edit}.
    // Bash is already denied via role row; WebFetch + Edit get added by whitelist subtraction.
    expect(deny.has('Bash')).toBe(true);
    expect(deny.has('WebFetch')).toBe(true);
    expect(deny.has('Edit')).toBe(true);
    expect(deny.has('Read')).toBe(false);
    expect(deny.has('Write')).toBe(false);
  });

  it('empty whitelist is treated as no whitelist (not "deny everything")', async () => {
    // A `[]` whitelist would lock the user out of every tool, which is
    // surprising behaviour. We treat empty as "no whitelist set" — the
    // caller signals "no tools" by passing an actual whitelist with the
    // tools they want, or by leaving `sessionEnabledTools` undefined.
    const repo = makeRepo([]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({
        agentEnabledTools: ['Read', 'Write'],
        sessionEnabledTools: [],
      }),
    );

    expect(deny.size).toBe(0);
  });

  it('superadmin bypass returns empty set even with role + agent + session denies', async () => {
    const repo = makeRepo([{ roleId: 'superadmin', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({
        auth: makeAuth({ role: 'superadmin' }),
        agentDenyList: ['WebFetch'],
        sessionExtraDenied: ['DeleteFile'],
        sessionEnabledTools: ['NoneOfThese'],
      }),
    );

    expect(deny.size).toBe(0);
    // Importantly, the repo is NOT consulted for superadmins (saves a query).
    expect(repo.listByRole).not.toHaveBeenCalled();
  });

  it("queries the repository exactly once with the user's role", async () => {
    const repo = makeRepo([]);
    const resolver = createResolver({ rolePermissions: repo });

    await resolver.getEffectiveDenyList(makeInput({ auth: makeAuth({ role: 'admin' }) }));

    expect(repo.listByRole).toHaveBeenCalledTimes(1);
    expect(repo.listByRole).toHaveBeenCalledWith('admin');
  });

  it('handles custom (non-well-known) roles via the same path', async () => {
    const repo = makeRepo([{ roleId: 'reviewer', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const deny = await resolver.getEffectiveDenyList(
      makeInput({ auth: makeAuth({ role: 'reviewer' }) }),
    );

    expect([...deny]).toEqual(['Bash']);
  });
});

describe('createResolver — isToolAllowed', () => {
  it('returns true when the tool is not denied', async () => {
    const repo = makeRepo([]);
    const resolver = createResolver({ rolePermissions: repo });

    const allowed = await resolver.isToolAllowed({
      ...makeInput(),
      toolName: 'Read',
    });

    expect(allowed).toBe(true);
  });

  it('returns false when the tool is denied via role', async () => {
    const repo = makeRepo([{ roleId: 'user', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const allowed = await resolver.isToolAllowed({
      ...makeInput(),
      toolName: 'Bash',
    });

    expect(allowed).toBe(false);
  });

  it('returns true for superadmins regardless of denies', async () => {
    const repo = makeRepo([{ roleId: 'superadmin', toolName: 'Bash', enabled: false }]);
    const resolver = createResolver({ rolePermissions: repo });

    const allowed = await resolver.isToolAllowed({
      ...makeInput({ auth: makeAuth({ role: 'superadmin' }) }),
      toolName: 'Bash',
    });

    expect(allowed).toBe(true);
  });
});

// ─── Registrar tests ───────────────────────────────────────────────────

function makePluginContext(repos?: { rolePermissions?: RolePermissionsRepository }): PluginContext {
  const logCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) => (msg: string, meta?: unknown) => {
    logCalls.push({ level, msg, meta });
  };
  const ctx = {
    options: {
      staticOrgId: 'default-org',
      orgScope: 'optional' as const,
      providers: [],
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
  (ctx as unknown as { logCalls: typeof logCalls }).logCalls = logCalls;
  return ctx;
}

describe('registerPermissions', () => {
  it('installs a real resolver when repos.rolePermissions is present', async () => {
    const repo = makeRepo([{ roleId: 'user', toolName: 'Bash', enabled: false }]);
    const ctx = makePluginContext({ rolePermissions: repo });

    const resolver = registerPermissions(ctx);
    expect(ctx.registries.permissions).toBe(resolver);

    const deny = await resolver.getEffectiveDenyList(makeInput());
    expect(deny.has('Bash')).toBe(true);
  });

  it('falls back to allowAllResolver when repos is missing', async () => {
    const ctx = makePluginContext(undefined);

    const resolver = registerPermissions(ctx);
    expect(resolver).toBe(allowAllResolver);
    expect(ctx.registries.permissions).toBe(allowAllResolver);

    const logs = (ctx as unknown as { logCalls: Array<{ level: string; msg: string }> }).logCalls;
    expect(
      logs.some((l) => l.level === 'warn' && /no rolePermissions repository/.test(l.msg)),
    ).toBe(true);
  });

  it('falls back to allowAllResolver when repos object exists but lacks .rolePermissions', async () => {
    const ctx = makePluginContext({});

    const resolver = registerPermissions(ctx);
    expect(resolver).toBe(allowAllResolver);

    const deny = await resolver.getEffectiveDenyList(makeInput());
    expect(deny.size).toBe(0);
  });
});
