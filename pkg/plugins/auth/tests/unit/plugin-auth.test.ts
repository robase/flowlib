import { describe, it, expect, vi } from 'vitest';
import { authentication } from '../../src/backend/plugin';
import type { BetterAuthInstance } from '../../src/backend/types';
import type { FlowlibIdentity } from '@flowlib/core/types';

// ---------------------------------------------------------------------------
// Mock better-auth instance factory
// ---------------------------------------------------------------------------

function createMockAuth(
  sessionResult: {
    user: { id: string; name?: string; email?: string; role?: string };
    session: { id: string; userId: string; token: string; expiresAt: Date };
  } | null = null,
  options?: {
    findUserByEmail?: ReturnType<typeof vi.fn>;
    updateUser?: ReturnType<typeof vi.fn>;
  },
): BetterAuthInstance {
  return {
    handler: vi.fn(async (_req: Request) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
    api: {
      getSession: vi.fn(async () => sessionResult),
    },
    options: {
      basePath: '/api/auth',
    },
    $context: Promise.resolve({
      internalAdapter: {
        findUserByEmail: options?.findUserByEmail ?? vi.fn(async () => null),
        updateUser: options?.updateUser ?? vi.fn(async () => null),
      },
    }),
  };
}

const TEST_USER = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
};

const TEST_SESSION = {
  id: 'session-456',
  userId: 'user-123',
  token: 'tok_abc',
  expiresAt: new Date(Date.now() + 3600_000),
};

// ===========================================================================
// authentication()
// ===========================================================================

describe('authentication', () => {
  describe('construction', () => {
    it('creates a plugin with correct id and name', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.id).toBe('user-auth');
      expect(plugin.name).toBe('User Auth');
    });

    it('generates proxy endpoints for all HTTP methods', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.endpoints).toBeDefined();
      const methods = plugin.endpoints!.map((e) => e.method);
      expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));
    });

    it('marks proxy catch-all endpoints as public', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      // Only the proxy catch-all endpoints (path = /auth/*) should be public.
      // Management endpoints like /auth/me, /auth/users, etc. are not public.
      const proxyEndpoints = plugin.endpoints!.filter((e) => e.path === '/auth/*');
      expect(proxyEndpoints.length).toBeGreaterThan(0);
      for (const endpoint of proxyEndpoints) {
        expect(endpoint.isPublic).toBe(true);
      }
    });

    it('marks management endpoints as non-public', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      // Exclude the proxy catch-all (covered above) and the deliberately-
      // public sign-in shell config endpoint, which has to be reachable
      // before a session exists so the unauthenticated SignInPage can read
      // signUpEnabled / configured social providers.
      const managementEndpoints = plugin.endpoints!.filter(
        (e) => e.path !== '/auth/*' && e.path !== '/auth/public-config',
      );
      expect(managementEndpoints.length).toBeGreaterThan(0);
      for (const endpoint of managementEndpoints) {
        expect(endpoint.isPublic).toBe(false);
      }
    });

    it('uses custom prefix in endpoint paths', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth, prefix: 'myauth' });

      for (const endpoint of plugin.endpoints!) {
        expect(endpoint.path).toContain('/myauth/');
      }
    });

    it('includes error codes', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.$ERROR_CODES).toBeDefined();
      expect(plugin.$ERROR_CODES!['auth:session_expired']).toBeDefined();
      expect(plugin.$ERROR_CODES!['auth:session_not_found']).toBeDefined();
    });

    it('declares required tables for startup verification', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.requiredTables).toBeDefined();
      expect(plugin.requiredTables).toContain('flowlib_user');
      expect(plugin.requiredTables).toContain('flowlib_session');
      expect(plugin.requiredTables).toContain('flowlib_account');
      expect(plugin.requiredTables).toContain('flowlib_verification');
    });

    it('provides setup instructions referencing the CLI', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.setupInstructions).toBeDefined();
      expect(plugin.setupInstructions).toContain('npx flowlib-cli generate');
    });

    it('provides abstract schema for all better-auth tables', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      expect(plugin.schema).toBeDefined();
      expect(plugin.schema!.user).toBeDefined();
      expect(plugin.schema!.session).toBeDefined();
      expect(plugin.schema!.account).toBeDefined();
      expect(plugin.schema!.verification).toBeDefined();

      // Each table should have fields and a tableName
      expect(plugin.schema!.user.tableName).toBe('flowlib_user');
      expect(plugin.schema!.user.fields.id).toBeDefined();
      expect(plugin.schema!.user.fields.email).toBeDefined();
      expect(plugin.schema!.session.fields.userId).toBeDefined();
      expect(plugin.schema!.account.fields.providerId).toBeDefined();
      expect(plugin.schema!.verification.fields.identifier).toBeDefined();
    });

    it('schema tables have foreign key references', () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      // session.userId should reference user.id
      expect(plugin.schema!.session.fields.userId.references).toEqual({
        table: 'flowlib_user',
        field: 'id',
        onDelete: 'cascade',
      });

      // account.userId should reference user.id
      expect(plugin.schema!.account.fields.userId.references).toEqual({
        table: 'flowlib_user',
        field: 'id',
        onDelete: 'cascade',
      });
    });
  });

  describe('hooks.onRequest', () => {
    it('returns undefined for better-auth proxy routes', async () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      const request = new Request('http://localhost/plugins/auth/api/auth/sign-in/email');
      const result = await plugin.hooks!.onRequest!(request, {
        path: '/plugins/auth/api/auth/sign-in/email',
        method: 'POST',
        identity: null,
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined for public paths', async () => {
      const auth = createMockAuth();
      const plugin = authentication({
        auth,
        publicPaths: ['/health'],
      });

      const request = new Request('http://localhost/health');
      const result = await plugin.hooks!.onRequest!(request, {
        path: '/health',
        method: 'GET',
        identity: null,
      });

      expect(result).toBeUndefined();
    });

    it('returns 401 Response when no session', async () => {
      const auth = createMockAuth(null);
      const plugin = authentication({ auth });

      const request = new Request('http://localhost/flows');
      const result = await plugin.hooks!.onRequest!(request, {
        path: '/flows',
        method: 'GET',
        identity: null,
      });

      expect(result).toBeDefined();
      const resp = (result as { response: Response }).response;
      expect(resp).toBeInstanceOf(Response);
      expect(resp.status).toBe(401);
      const body = await resp.json();
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('hooks.onAuthorize', () => {
    it('returns void when identity is present (defers to downstream authorization)', async () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      const result = await plugin.hooks!.onAuthorize!({
        identity: { id: 'user-123', name: 'Test', role: 'admin' },
        action: 'flow:read',
      });

      expect(result).toBeUndefined();
    });

    it('returns { allowed: false } when no identity', async () => {
      const auth = createMockAuth(null);
      const plugin = authentication({ auth });

      const result = await plugin.hooks!.onAuthorize!({
        identity: null,
        action: 'flow:read',
      });

      expect(result).toEqual({
        allowed: false,
        reason: expect.stringContaining('better-auth'),
      });
    });
  });

  describe('default role mapping (via onRequest hook)', () => {
    async function resolveIdentityViaHook(auth: BetterAuthInstance, cookie = 'session=tok') {
      const plugin = authentication({ auth });
      const request = new Request('http://localhost/flows', {
        headers: { cookie },
      });
      const context = { path: '/flows', method: 'GET', identity: null as FlowlibIdentity | null };
      await plugin.hooks!.onRequest!(request, context);
      return context.identity;
    }

    it('maps admin to admin', async () => {
      const auth = createMockAuth({
        user: { ...TEST_USER, role: 'admin' },
        session: TEST_SESSION,
      });
      const identity = await resolveIdentityViaHook(auth);
      expect(identity?.role).toBe('admin');
    });

    it('maps viewer to viewer', async () => {
      const auth = createMockAuth({
        user: { ...TEST_USER, role: 'viewer' },
        session: TEST_SESSION,
      });
      const identity = await resolveIdentityViaHook(auth);
      expect(identity?.role).toBe('viewer');
    });

    it('maps operator to operator', async () => {
      const auth = createMockAuth({
        user: { ...TEST_USER, role: 'operator' },
        session: TEST_SESSION,
      });
      const identity = await resolveIdentityViaHook(auth);
      expect(identity?.role).toBe('operator');
    });

    it('maps unknown roles to default', async () => {
      const auth = createMockAuth({
        user: { ...TEST_USER, role: 'custom-role' },
        session: TEST_SESSION,
      });
      const identity = await resolveIdentityViaHook(auth);
      expect(identity?.role).toBe('default');
    });

    it('maps null role to default', async () => {
      const auth = createMockAuth({
        user: { ...TEST_USER, role: undefined },
        session: TEST_SESSION,
      });
      const identity = await resolveIdentityViaHook(auth);
      expect(identity?.role).toBe('default');
    });
  });

  describe('proxy endpoints', () => {
    it('forwards requests to auth.handler', async () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      // Find the proxy catch-all POST endpoint (path = /auth/*), not the management endpoints
      const proxyEndpoint = plugin.endpoints!.find(
        (e) => e.method === 'POST' && e.path === '/auth/*',
      );
      expect(proxyEndpoint).toBeDefined();

      const mockRequest = new Request(
        'http://localhost/flowlib/plugins/auth/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
        },
      );

      const result = await proxyEndpoint!.handler({
        body: { email: 'test@example.com', password: 'pass' },
        params: {},
        query: {},
        headers: { 'content-type': 'application/json' },
        identity: null,
        request: mockRequest,
      });

      // Should return a Response object from auth.handler
      expect(result).toBeInstanceOf(Response);
      expect(auth.handler).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('logs initialization message', async () => {
      const auth = createMockAuth();
      const plugin = authentication({ auth });

      const logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await plugin.init!({
        config: {},
        logger,
        registerAction: vi.fn(),
        store: new Map(),
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Better Auth plugin initialized'),
      );
    });

    it('promotes an existing configured admin user', async () => {
      const findUserByEmail = vi.fn(async () => ({
        user: {
          id: 'admin-123',
          email: 'admin@example.com',
          name: 'Admin',
          role: 'editor',
        },
        accounts: [],
      }));
      const updateUser = vi.fn(async () => ({
        id: 'admin-123',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      }));

      const auth = createMockAuth(null, {
        findUserByEmail,
        updateUser,
      });
      const plugin = authentication({
        auth,
        globalAdmins: [
          {
            email: 'admin@example.com',
            pw: 'password123',
          },
        ],
      });

      const logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      await plugin.init!({
        config: {},
        logger,
        registerAction: vi.fn(),
        store: new Map(),
      });

      expect(findUserByEmail).toHaveBeenCalledWith('admin@example.com');
      expect(updateUser).toHaveBeenCalledWith('admin-123', { role: 'admin' });
      expect(logger.info).toHaveBeenCalledWith('Admin user promoted: admin@example.com');
    });
  });
});

// ===========================================================================
// Session resolution (via onRequest hook)
// ===========================================================================

describe('session resolution via onRequest hook', () => {
  async function resolveIdentity(
    auth: BetterAuthInstance,
    headers: Record<string, string> = {},
    pluginOptions?: Partial<Parameters<typeof authentication>[0]>,
  ) {
    const plugin = authentication({ auth, ...pluginOptions });
    const request = new Request('http://localhost/flows', { headers });
    const context = { path: '/flows', method: 'GET', identity: null as FlowlibIdentity | null };
    await plugin.hooks!.onRequest!(request, context);
    return context.identity;
  }

  it('resolves identity from request headers', async () => {
    const auth = createMockAuth({ user: TEST_USER, session: TEST_SESSION });
    const identity = await resolveIdentity(auth, {
      cookie: 'better-auth.session_token=tok_abc',
    });

    expect(identity).toEqual(
      expect.objectContaining({
        id: 'user-123',
        name: 'Test User',
        role: 'admin',
      }),
    );
  });

  it('returns 401 when no session', async () => {
    const auth = createMockAuth(null);
    const plugin = authentication({ auth });
    const request = new Request('http://localhost/flows');
    const result = await plugin.hooks!.onRequest!(request, {
      path: '/flows',
      method: 'GET',
      identity: null,
    });

    expect(result).toBeDefined();
    const resp = (result as { response: Response }).response;
    expect(resp.status).toBe(401);
  });

  it('handles array header values', async () => {
    const auth = createMockAuth({ user: TEST_USER, session: TEST_SESSION });
    const identity = await resolveIdentity(auth, {
      cookie: 'session=tok',
    });

    expect(identity).toBeDefined();
    expect(identity!.id).toBe('user-123');
  });

  it('uses custom mapUser', async () => {
    const auth = createMockAuth({ user: TEST_USER, session: TEST_SESSION });
    const identity = await resolveIdentity(
      auth,
      { cookie: 'session=tok' },
      {
        mapUser: (user) => ({
          id: user.id,
          name: `Resolved: ${user.name}`,
          role: 'viewer',
        }),
      },
    );

    expect(identity).toEqual({
      id: 'user-123',
      name: 'Resolved: Test User',
      role: 'viewer',
    });
  });

  it('uses custom mapRole', async () => {
    const authData = {
      user: { ...TEST_USER, role: 'superuser' },
      session: TEST_SESSION,
    };
    const auth = createMockAuth(authData);
    const identity = await resolveIdentity(
      auth,
      { cookie: 'session=tok' },
      {
        mapRole: () => 'admin',
      },
    );

    expect(identity?.role).toBe('admin');
  });

  it('gracefully handles auth.api.getSession throwing', async () => {
    const auth = createMockAuth();
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused'),
    );
    const plugin = authentication({ auth });
    const request = new Request('http://localhost/flows', {
      headers: { cookie: 'session=tok' },
    });
    const result = await plugin.hooks!.onRequest!(request, {
      path: '/flows',
      method: 'GET',
      identity: null,
    });

    expect(result).toBeDefined();
    const resp = (result as { response: Response }).response;
    expect(resp.status).toBe(401);
  });
});

// ===========================================================================
// Schema & API key configuration
// ===========================================================================

describe('schema and apiKey option', () => {
  it('does not include apikey table in schema by default', () => {
    const auth = createMockAuth();
    const plugin = authentication({ auth });

    expect(plugin.schema).toBeDefined();
    expect(plugin.schema!.apikey).toBeUndefined();
    expect(plugin.requiredTables).not.toContain('apikey');
  });

  it('includes apikey table when apiKey is true', () => {
    const auth = createMockAuth();
    const plugin = authentication({ auth, apiKey: true });

    expect(plugin.schema!.apikey).toBeDefined();
    expect(plugin.schema!.apikey.fields.key).toBeDefined();
    expect(plugin.schema!.apikey.fields.referenceId).toBeDefined();
    expect(plugin.requiredTables).toContain('flowlib_apikey');
  });

  it('includes apikey table when apiKey is an options object', () => {
    const auth = createMockAuth();
    const plugin = authentication({ auth, apiKey: { defaultPrefix: 'inv_' } });

    expect(plugin.schema!.apikey).toBeDefined();
    expect(plugin.requiredTables).toContain('flowlib_apikey');
  });

  it('includes apikey table via betterAuthOptions.apiKey', () => {
    const auth = createMockAuth();
    const plugin = authentication({ auth, betterAuthOptions: { apiKey: true } });

    expect(plugin.schema!.apikey).toBeDefined();
    expect(plugin.requiredTables).toContain('flowlib_apikey');
  });

  it('always includes core auth tables regardless of apiKey', () => {
    const auth = createMockAuth();
    const plugin = authentication({ auth, apiKey: true });

    expect(plugin.schema!.user).toBeDefined();
    expect(plugin.schema!.session).toBeDefined();
    expect(plugin.schema!.account).toBeDefined();
    expect(plugin.schema!.verification).toBeDefined();
    expect(plugin.requiredTables).toEqual(
      expect.arrayContaining([
        'flowlib_user',
        'flowlib_session',
        'flowlib_account',
        'flowlib_verification',
        'flowlib_flow_access',
      ]),
    );
  });
});
