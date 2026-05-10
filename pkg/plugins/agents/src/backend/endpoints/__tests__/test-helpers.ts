/**
 * Test substrate for the agents-plugin endpoint tests.
 *
 * Builds a fake `PluginContext` (logger + options + registries with a
 * working repositories factory) and a per-call `PluginEndpointContext`
 * over the in-memory fake database. Endpoints under test invoke the
 * same code path they would in production — only the database and the
 * provider singletons are mocked.
 */

import { vi } from 'vitest';
import type {
  FlowlibIdentity,
  FlowlibPluginEndpoint,
  PluginEndpointContext,
  PluginEndpointResponse,
} from '@flowlib/core';
import type { PluginContext } from '../../plugin-context';
import type { AgentProvider } from '../../providers/types';
import type { WorkspaceProvider } from '../../workspaces/types';
import { buildRepositories } from '../../repositories/register';
import { makeFakeDatabase } from '../../repositories/__tests__/fake-db';

export interface FakePluginCtxOptions {
  staticOrgId?: string;
  orgScope?: 'optional' | 'required';
  providers?: AgentProvider[];
  workspaceProvider?: WorkspaceProvider;
  exposeFlowlibActions?: boolean;
}

/**
 * Build a fully-wired fake `PluginContext`. The repositories factory
 * is the *real* one — tests exercise the production path.
 */
export function makeFakePluginCtx(opts: FakePluginCtxOptions = {}): {
  ctx: PluginContext;
  db: ReturnType<typeof makeFakeDatabase>;
  logs: Array<{ level: string; msg: string; meta?: unknown }>;
} {
  const logs: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) => (msg: string, meta?: unknown) => {
    logs.push({ level, msg, meta });
  };
  const logger = {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };

  const providers = new Map<string, AgentProvider>();
  for (const p of opts.providers ?? []) {
    providers.set(p.id, p);
  }

  const db = makeFakeDatabase('sqlite');

  const registries = {
    providers,
    workspaces: new Map<string, WorkspaceProvider>(),
    repositories: buildRepositories,
  } as PluginContext['registries'];
  if (opts.workspaceProvider) {
    registries.workspaces.set(opts.workspaceProvider.id, opts.workspaceProvider);
  }

  const ctx: PluginContext = {
    options: {
      staticOrgId: opts.staticOrgId ?? 'default-org',
      orgScope: opts.orgScope ?? 'optional',
      providers: opts.providers ?? [],
      workspaceProviders: opts.workspaceProvider ? [opts.workspaceProvider] : [],
      exposeFlowlibActions: opts.exposeFlowlibActions ?? false,
      defaultDenyList: [],
      defaultProviderId: 'opencode',
      defaultModel: 'anthropic/claude-sonnet-4-5',
    },
    flowlib: {
      config: {},
      logger,
      hasPlugin: vi.fn().mockReturnValue(false),
      getPlugin: vi.fn().mockReturnValue(null),
      registerAction: vi.fn(),
      store: new Map(),
      getFlowlib: vi.fn(),
    } as unknown as PluginContext['flowlib'],
    actionRegistry: {} as PluginContext['actionRegistry'],
    registries,
    logger,
  };

  return { ctx, db, logs };
}

/**
 * Build a `PluginEndpointContext` against the supplied fake database.
 */
export function makeEndpointCtx(args: {
  db: ReturnType<typeof makeFakeDatabase>;
  identity?: FlowlibIdentity | null;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
}): PluginEndpointContext {
  return {
    body: args.body ?? {},
    params: args.params ?? {},
    query: args.query ?? {},
    headers: args.headers ?? {},
    identity: args.identity ?? null,
    database: args.db,
    request: new Request('http://test/'),
    core: {
      getPermissions: () => [],
      getAvailableRoles: () => [],
      getResolvedRole: () => null,
      authorize: async () => ({ allowed: true }),
    } as PluginEndpointContext['core'],
    getFlowlib: vi.fn(),
  } as unknown as PluginEndpointContext;
}

/**
 * Locate an endpoint in a list by method+path and return its handler
 * bound for direct invocation. Throws when no match exists — that's
 * always a test bug, not an assertion-style failure.
 */
export function findEndpoint(
  endpoints: FlowlibPluginEndpoint[],
  method: FlowlibPluginEndpoint['method'],
  path: string,
): FlowlibPluginEndpoint {
  const match = endpoints.find((e) => e.method === method && e.path === path);
  if (!match) {
    throw new Error(`Endpoint not found: ${method} ${path}`);
  }
  return match;
}

/**
 * Identity factory — embeds an `orgId` in `metadata` so the auth
 * context resolver picks it up without tripping the `staticOrgId`
 * fallback path.
 */
export function makeIdentity(
  userId: string,
  orgId: string,
  role: 'user' | 'admin' = 'user',
): FlowlibIdentity {
  return {
    id: userId,
    role,
    metadata: { orgId },
  } as FlowlibIdentity;
}

/** Type guard: response body is a JSON record. */
export function jsonBody(res: PluginEndpointResponse): Record<string, unknown> {
  if ('body' in res && typeof res.body === 'object' && res.body !== null) {
    return res.body as Record<string, unknown>;
  }
  throw new Error('Response did not carry a JSON body');
}
