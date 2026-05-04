import type { FlowlibPlugin, FlowlibIdentity, FlowlibRole, FlowlibPermission } from '@flowlib/core';
import type { FlowlibPluginSchema } from '@flowlib/db';
import type {
  AuthenticationPluginOptions,
  BetterAuthContext,
  BetterAuthUser,
  BetterAuthSession,
  BetterAuthInstance,
} from './types';
import {
  AUTH_ADMIN_ROLE,
  AUTH_ASSIGNABLE_ROLES,
  AUTH_DEFAULT_ROLE,
  AUTH_VISIBLE_ROLES,
  isAuthAssignableRole,
  isAuthVisibleRole,
} from '../shared/roles';

type PluginLoggerLike = {
  error: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  debug?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
};

type BetterAuthApiUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  [key: string]: unknown;
};

type BetterAuthApiUserResult = {
  user?: BetterAuthApiUser | null;
};

type BetterAuthHeadersQueryMethod<TResult> = (args: {
  headers: Headers;
  query: Record<string, string>;
}) => Promise<TResult>;

type BetterAuthHeadersBodyMethod<TResult> = (args: {
  headers: Headers;
  body: Record<string, unknown>;
}) => Promise<TResult>;

type BetterAuthHeadersBodyParamsMethod<TResult> = (args: {
  headers: Headers;
  body: Record<string, unknown>;
  params: Record<string, string>;
}) => Promise<TResult>;

type BetterAuthBodyMethod<TResult> = (args: { body: Record<string, unknown> }) => Promise<TResult>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PREFIX = 'auth';

/**
 * Default role mapping: keep admin/RBAC roles aligned and fall back to default.
 */
function defaultMapRole(role: string | null | undefined): FlowlibRole {
  if (!role) {
    return AUTH_DEFAULT_ROLE;
  }
  if (role === 'viewer' || role === 'readonly') {
    return 'viewer';
  }
  if (isAuthVisibleRole(role)) {
    return role;
  }
  return AUTH_DEFAULT_ROLE;
}

/**
 * Default user → identity mapping.
 */
function defaultMapUser(
  user: BetterAuthUser,
  _session: BetterAuthSession,
  mapRole: (role: string | null | undefined) => FlowlibRole,
): FlowlibIdentity {
  const resolvedRole = mapRole(user.role);

  return {
    id: user.id,
    name: user.name ?? user.email ?? undefined,
    role: resolvedRole,
    permissions: resolvedRole === AUTH_ADMIN_ROLE ? ['admin:*'] : undefined,
    resourceAccess:
      resolvedRole === AUTH_ADMIN_ROLE
        ? {
            flows: '*',
            credentials: '*',
          }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Keyed by IP address (or a fallback identifier). Tracks request timestamps
 * per window and rejects requests that exceed the limit with HTTP 429.
 *
 * Only applied to authentication-sensitive endpoints (sign-in, sign-up,
 * password reset) to prevent brute-force attacks. Session reads (GET) are
 * not rate-limited.
 */
class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 10, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Returns `true` if the request should be rejected (over limit).
   */
  isRateLimited(key: string): { limited: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Prune expired entries
    const valid = timestamps.filter((t) => t > windowStart);
    this.windows.set(key, valid);

    if (valid.length >= this.maxRequests) {
      const oldestInWindow = valid[0] ?? now;
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1000) };
    }

    valid.push(now);
    return { limited: false };
  }

  /** Periodic cleanup of stale keys to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => t > now - this.windowMs);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}

/** Auth-sensitive path segments that should be rate-limited. */
const RATE_LIMITED_AUTH_PATHS = [
  '/sign-in/',
  '/sign-up/',
  '/forgot-password',
  '/reset-password',
  '/two-factor/',
  '/email-otp/',
];

/**
 * Convert a Node.js-style `IncomingHttpHeaders` record or a `Headers` instance
 * to a standard `Headers` object for passing to better-auth.
 */
function toHeaders(raw: Record<string, string | undefined> | Headers): Headers {
  if (raw instanceof Headers) {
    return raw;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Resolve the session from a better-auth instance using request headers.
 */
async function resolveSession(
  auth: BetterAuthInstance | null,
  headers: Record<string, string | undefined> | Headers,
): Promise<{ session: BetterAuthSession; user: BetterAuthUser } | null> {
  if (!auth) {
    return null;
  }

  const h = toHeaders(headers);

  try {
    const result = await auth.api.getSession({
      headers: h,
    });
    if (result?.session && result?.user) {
      return {
        session: result.session,
        user: result.user,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function callBetterAuthHandler(
  auth: BetterAuthInstance | null,
  request: Request,
  path: string,
  init?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    query?: Record<string, string | undefined>;
    body?: Record<string, unknown>;
  },
): Promise<{ status: number; body: unknown } | null> {
  if (!auth) {
    return null;
  }

  const basePath = auth.options?.basePath ?? '/api/auth';
  const targetUrl = new URL(`${basePath}${path}`, request.url);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined) {
      targetUrl.searchParams.set(key, value);
    }
  }

  const headers = new Headers(request.headers);
  const hasBody = init?.body !== undefined;
  if (hasBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const authRequest = new Request(targetUrl.toString(), {
    method: init?.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(init?.body) : undefined,
  });

  const response = await auth.handler(authRequest);
  const text = await response.text();

  if (!text) {
    return { status: response.status, body: null };
  }

  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function getAuthContext(auth: BetterAuthInstance | null): Promise<BetterAuthContext | null> {
  if (!auth) {
    return null;
  }
  try {
    return (await auth.$context) ?? null;
  } catch {
    return null;
  }
}

function isBetterAuthUser(value: unknown): value is BetterAuthUser {
  return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string';
}

function unwrapFoundUser(
  result: BetterAuthUser | { user?: BetterAuthUser | null } | null | undefined,
): BetterAuthUser | null {
  if (!result) {
    return null;
  }

  if (typeof result === 'object' && 'user' in result) {
    const nestedUser = result.user;
    if (isBetterAuthUser(nestedUser)) {
      return nestedUser;
    }

    return null;
  }

  if (isBetterAuthUser(result)) {
    return result;
  }

  return null;
}

function toAuthApiErrorResponse(
  fallbackError: string,
  error: unknown,
): { status: number; body: Record<string, unknown> } {
  if (error instanceof Response) {
    return {
      status: error.status || 500,
      body: { error: fallbackError, message: error.statusText || fallbackError },
    };
  }

  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? ((error as { status: number }).status ?? 500)
      : error &&
          typeof error === 'object' &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? ((error as { statusCode: number }).statusCode ?? 500)
        : 500;

  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message || fallbackError
      : fallbackError;

  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;

  return {
    status,
    body: {
      error: fallbackError,
      message,
      ...(code ? { code } : {}),
    },
  };
}

function sanitizeForLogging(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogging(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (/password|token|secret/i.test(key)) {
          return [key, '[REDACTED]'];
        }

        return [key, sanitizeForLogging(nestedValue)];
      }),
    );
  }

  return value;
}

function getErrorLogDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Response) {
    return {
      type: 'Response',
      status: error.status,
      statusText: error.statusText,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error && typeof error === 'object' && 'cause' in error
        ? { cause: sanitizeForLogging((error as Error & { cause?: unknown }).cause) }
        : {}),
      ...(error && typeof error === 'object' && 'code' in error
        ? { code: (error as Error & { code?: unknown }).code }
        : {}),
      ...(error && typeof error === 'object' && 'status' in error
        ? { status: (error as Error & { status?: unknown }).status }
        : {}),
      ...(error && typeof error === 'object' && 'statusCode' in error
        ? { statusCode: (error as Error & { statusCode?: unknown }).statusCode }
        : {}),
    };
  }

  if (error && typeof error === 'object') {
    return sanitizeForLogging(error) as Record<string, unknown>;
  }

  return { value: error };
}

// ---------------------------------------------------------------------------
// Abstract schema — defines the tables the user-auth plugin requires
// ---------------------------------------------------------------------------

/**
 * Abstract schema for the user-auth plugin's database tables.
 *
 * These definitions allow the Flowlib CLI (`npx flowlib-cli generate`) to include
 * the auth tables when generating Drizzle/Prisma schema files.
 *
 * The shapes match Better Auth's default table structure. If your Better Auth
 * config adds extra fields (e.g., via plugins like `twoFactor`, `organization`),
 * you can extend these in your own config.
 */
export const USER_AUTH_SCHEMA: FlowlibPluginSchema = {
  user: {
    tableName: 'flowlib_user',
    order: 1,
    fields: {
      id: { type: 'string', primaryKey: true },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true, unique: true },
      emailVerified: { type: 'boolean', required: true, defaultValue: false },
      image: { type: 'string', required: false },
      role: { type: 'string', required: false, defaultValue: AUTH_DEFAULT_ROLE },
      banned: { type: 'boolean', required: false, defaultValue: false },
      banReason: { type: 'string', required: false },
      banExpires: { type: 'date', required: false },
      twoFactorEnabled: { type: 'boolean', required: false, defaultValue: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  session: {
    tableName: 'flowlib_session',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      expiresAt: { type: 'date', required: true },
      token: { type: 'string', required: true, unique: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
      ipAddress: { type: 'string', required: false },
      userAgent: { type: 'string', required: false },
      impersonatedBy: { type: 'string', required: false },
      userId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_user', field: 'id', onDelete: 'cascade' },
      },
    },
  },

  account: {
    tableName: 'flowlib_account',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      accountId: { type: 'string', required: true },
      providerId: { type: 'string', required: true },
      userId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_user', field: 'id', onDelete: 'cascade' },
      },
      accessToken: { type: 'string', required: false },
      refreshToken: { type: 'string', required: false },
      idToken: { type: 'string', required: false },
      accessTokenExpiresAt: { type: 'date', required: false },
      refreshTokenExpiresAt: { type: 'date', required: false },
      scope: { type: 'string', required: false },
      password: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  verification: {
    tableName: 'flowlib_verification',
    order: 2,
    fields: {
      id: { type: 'string', primaryKey: true },
      identifier: { type: 'string', required: true },
      value: { type: 'string', required: true },
      expiresAt: { type: 'date', required: true },
      createdAt: { type: 'date', required: false },
      updatedAt: { type: 'date', required: false },
    },
  },

  // ----- Flow access control table (moved from core) -----
  flowAccess: {
    tableName: 'flowlib_flow_access',
    order: 3,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      userId: { type: 'string', required: false },
      teamId: { type: 'string', required: false },
      permission: {
        type: 'string',
        required: true,
        defaultValue: 'viewer',
      },
      grantedBy: { type: 'string', required: false },
      grantedAt: { type: 'date', required: true, defaultValue: 'now()' },
      expiresAt: { type: 'date', required: false },
    },
  },

  // ----- Two-Factor Authentication table (Better Auth 2FA plugin) -----
  twoFactor: {
    tableName: 'flowlib_two_factor',
    order: 3,
    fields: {
      id: { type: 'string', primaryKey: true },
      userId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_user', field: 'id', onDelete: 'cascade' },
      },
      secret: { type: 'string', required: true },
      backupCodes: { type: 'string', required: true },
      verified: { type: 'boolean', required: false, defaultValue: false },
    },
  },
};

/**
 * Abstract schema for the Better Auth API Key plugin's `apikey` table.
 *
 * Only merged into the plugin schema when `apiKey` is enabled.
 *
 * @see https://better-auth.com/docs/plugins/api-key/reference#schema
 */
const API_KEY_SCHEMA: FlowlibPluginSchema = {
  apikey: {
    tableName: 'flowlib_apikey',
    order: 3,
    fields: {
      id: { type: 'string', primaryKey: true },
      configId: { type: 'string', required: true, defaultValue: 'default' },
      name: { type: 'string', required: false },
      start: { type: 'string', required: false },
      prefix: { type: 'string', required: false },
      key: { type: 'string', required: true },
      referenceId: { type: 'string', required: true },
      refillInterval: { type: 'number', required: false },
      refillAmount: { type: 'number', required: false },
      lastRefillAt: { type: 'date', required: false },
      enabled: { type: 'boolean', required: false, defaultValue: true },
      rateLimitEnabled: { type: 'boolean', required: false },
      rateLimitTimeWindow: { type: 'number', required: false },
      rateLimitMax: { type: 'number', required: false },
      requestCount: { type: 'number', required: false },
      remaining: { type: 'number', required: false },
      lastRequest: { type: 'date', required: false },
      expiresAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
      permissions: { type: 'string', required: false },
      metadata: { type: 'string', required: false },
    },
  },
};

// ---------------------------------------------------------------------------
// Internal Better Auth instance creation
// ---------------------------------------------------------------------------

/**
 * Create a Better Auth instance internally using Flowlib's database config.
 *
 * Dynamically imports `better-auth` (a required peer dependency) and creates
 * a fully-configured instance with email/password auth, the admin plugin,
 * and session caching.
 *
 * Database resolution order:
 * 1. Explicit `options.database` (any value `betterAuth({ database })` accepts)
 * 2. Auto-created client from Flowlib's `database.connectionString`
 */
async function createInternalBetterAuth(
  flowlibConfig: Record<string, unknown>,
  options: AuthenticationPluginOptions,
  logger: PluginLoggerLike,
): Promise<BetterAuthInstance> {
  // 1. Dynamic-import better-auth (peer dependency)
  let betterAuthFn: (config: Record<string, unknown>) => unknown;
  let adminPlugin: (config?: Record<string, unknown>) => unknown;

  try {
    const betterAuthModule = await import('better-auth');
    betterAuthFn = betterAuthModule.betterAuth;
  } catch {
    throw new Error(
      'Could not import "better-auth". It is a required peer dependency of @flowlib/user-auth. ' +
        'Install it with: npm install better-auth',
    );
  }

  try {
    const pluginsModule = await import('better-auth/plugins');
    adminPlugin = pluginsModule.admin;
  } catch {
    throw new Error(
      'Could not import "better-auth/plugins". Ensure better-auth is properly installed.',
    );
  }

  // 2. Resolve database
  let database: unknown = options.database;

  if (!database) {
    const dbConfig = flowlibConfig.database as
      | { type?: string; connectionString?: string }
      | undefined;

    if (!dbConfig?.connectionString) {
      throw new Error(
        'Cannot create internal Better Auth instance: no database configuration found. ' +
          'Either provide `auth` (a Better Auth instance), `database`, or ensure ' +
          'Flowlib database has a connectionString.',
      );
    }

    const connStr = dbConfig.connectionString;
    const dbType = (dbConfig.type ?? 'sqlite').toLowerCase();

    if (dbType === 'sqlite') {
      database = await createSQLiteClient(connStr, logger);
    } else if (dbType === 'pg' || dbType === 'postgresql') {
      database = await createPostgresPool(connStr);
    } else if (dbType === 'mysql') {
      database = await createMySQLPool(connStr);
    } else {
      throw new Error(
        `Unsupported database type for internal Better Auth: "${dbType}". ` +
          'Supported: sqlite, pg, mysql. Alternatively, provide your own Better Auth instance via `auth`.',
      );
    }
  }

  // 3. Resolve base URL
  const baseURL =
    options.baseURL ??
    process.env.BETTER_AUTH_URL ??
    `http://localhost:${process.env.PORT ?? '3000'}`;

  // 4. Resolve trusted origins
  const configuredOrigins = options.trustedOrigins;
  const trustedOrigins =
    configuredOrigins ??
    ((request: Request) => {
      const trusted = new Set<string>([baseURL, 'http://localhost:5173', 'http://localhost:5174']);
      try {
        if (request) {
          trusted.add(new URL(request.url).origin);
        }
      } catch {
        // Ignore malformed URLs
      }
      return Array.from(trusted);
    });

  // 5. Build passthrough config from betterAuthOptions
  const passthrough = options.betterAuthOptions ?? {};

  const emailAndPassword = {
    enabled: true,
    ...passthrough.emailAndPassword,
  };

  const session = {
    modelName: 'flowlib_session',
    cookieCache: { enabled: true, maxAge: 5 * 60 },
    ...passthrough.session,
    // Merge cookieCache if both exist
    ...(passthrough.session?.cookieCache
      ? {
          cookieCache: {
            enabled: true,
            maxAge: 5 * 60,
            ...passthrough.session.cookieCache,
          },
        }
      : {}),
  };

  // 6. Resolve secret — fall back to FLOWLIB_ENCRYPTION_KEY when no explicit
  //    secret or secrets are provided.  This lets deployments that already set
  //    FLOWLIB_ENCRYPTION_KEY get a valid Better Auth secret for free.
  let resolvedSecret = passthrough.secret;
  const resolvedSecrets = passthrough.secrets;

  if (!resolvedSecret && !resolvedSecrets) {
    const envKey = process.env.FLOWLIB_ENCRYPTION_KEY;
    if (envKey) {
      resolvedSecret = envKey;
      logger.debug?.(
        'Using FLOWLIB_ENCRYPTION_KEY as Better Auth secret (no explicit secret/secrets provided)',
      );
    }
  }

  // 7. Optionally load the Better Auth API Key plugin
  //    Merge top-level `options.apiKey` with `passthrough.apiKey` (top-level wins).
  const apiKeyOpt = options.apiKey ?? passthrough.apiKey;
  const betterAuthPlugins: unknown[] = [
    adminPlugin({ defaultRole: AUTH_DEFAULT_ROLE, adminRoles: [AUTH_ADMIN_ROLE] }),
  ];

  // 7a. Load the Better Auth Two-Factor plugin (always bundled)
  {
    let twoFactorPlugin: (config?: Record<string, unknown>) => unknown;
    try {
      const pluginsModule = await import('better-auth/plugins');
      twoFactorPlugin = pluginsModule.twoFactor;
    } catch {
      throw new Error(
        'Could not import twoFactor from "better-auth/plugins". Ensure better-auth is properly installed.',
      );
    }

    const twoFactorOpt = options.twoFactor;
    const twoFactorConfig: Record<string, unknown> =
      typeof twoFactorOpt === 'object' ? { ...twoFactorOpt } : {};
    // Default issuer to "Flowlib" if not provided
    if (twoFactorConfig.issuer === undefined) {
      twoFactorConfig.issuer = 'Flowlib';
    }
    // Use flowlib-prefixed table name for the two-factor table
    if (twoFactorConfig.twoFactorTable === undefined) {
      twoFactorConfig.twoFactorTable = 'flowlib_two_factor';
    }
    betterAuthPlugins.push(twoFactorPlugin(twoFactorConfig));
    logger.info?.('Better Auth Two-Factor plugin enabled');
  }

  if (apiKeyOpt) {
    let apiKeyPluginFn: (config?: Record<string, unknown>) => unknown;
    try {
      // Dynamic import — @better-auth/api-key is an optional peer dependency.
      // Using a variable to prevent TypeScript from resolving the module at
      // type-check time (it may not be installed).
      const pkg = '@better-auth/api-key';
      const apiKeyModule: Record<string, unknown> = await import(pkg);
      apiKeyPluginFn = apiKeyModule.apiKey as (config?: Record<string, unknown>) => unknown;
    } catch {
      throw new Error(
        'Could not import "@better-auth/api-key". Install it with: npm install @better-auth/api-key',
      );
    }

    const apiKeyConfig: Record<string, unknown> =
      typeof apiKeyOpt === 'object' ? { ...apiKeyOpt } : {};
    // Default API key header to "x-flowlib-token" (overridable via options).
    if (apiKeyConfig.apiKeyHeaders === undefined) {
      apiKeyConfig.apiKeyHeaders = 'x-flowlib-token';
    }
    // Ensure getSession() can resolve API keys to sessions.
    // Without this, auth.api.getSession() only checks cookies/tokens.
    if (apiKeyConfig.enableSessionForAPIKeys === undefined) {
      apiKeyConfig.enableSessionForAPIKeys = true;
    }
    // Use flowlib-prefixed table name for the api-key table
    if (apiKeyConfig.schema === undefined) {
      apiKeyConfig.schema = { apikey: { modelName: 'flowlib_apikey' } };
    }
    betterAuthPlugins.push(apiKeyPluginFn(apiKeyConfig));
    logger.info?.('Better Auth API Key plugin enabled');
  }

  // 7b. Optionally load the Magic Link plugin (powers passwordless sign-up).
  const magicLinkOpt = options.magicLink;
  if (magicLinkOpt) {
    let magicLinkPluginFn: (config: Record<string, unknown>) => unknown;
    try {
      // The plugin lives at the subpath, not the root /plugins barrel.
      const pluginsModule = await import('better-auth/plugins/magic-link');
      magicLinkPluginFn = pluginsModule.magicLink as unknown as (
        config: Record<string, unknown>,
      ) => unknown;
    } catch {
      throw new Error(
        'Could not import magicLink from "better-auth/plugins/magic-link". Ensure better-auth is properly installed.',
      );
    }

    const magicLinkConfig: Record<string, unknown> =
      typeof magicLinkOpt === 'object' ? { ...magicLinkOpt } : {};
    // Without a sendMagicLink callback, links are generated but never
    // delivered. Warn so the operator notices.
    if (typeof magicLinkConfig.sendMagicLink !== 'function') {
      magicLinkConfig.sendMagicLink = async () => {
        // No-op delivery — links are generated but never sent. Useful in
        // tests; useless in production.
      };
      logger.warn?.(
        'magicLink enabled without a sendMagicLink callback — links will not be delivered.',
      );
    }
    betterAuthPlugins.push(magicLinkPluginFn(magicLinkConfig));
    logger.info?.('Better Auth Magic Link plugin enabled');
  }

  // 8. Create the instance
  logger.info?.('Creating internal Better Auth instance');

  const instance = betterAuthFn({
    baseURL,
    database,
    emailAndPassword,
    plugins: betterAuthPlugins,
    session,
    trustedOrigins,
    // Map Better Auth model names to flowlib-prefixed table names.
    user: { modelName: 'flowlib_user' },
    account: { modelName: 'flowlib_account', ...passthrough.account },
    verification: { modelName: 'flowlib_verification' },
    // Spread optional passthrough fields
    ...(passthrough.socialProviders ? { socialProviders: passthrough.socialProviders } : {}),
    ...(passthrough.rateLimit ? { rateLimit: passthrough.rateLimit } : {}),
    // Default cookie prefix to "flowlib" (cookies become flowlib.session_token).
    // Users can override via betterAuthOptions.advanced.cookiePrefix.
    advanced: {
      cookiePrefix: 'flowlib',
      ...passthrough.advanced,
    },
    ...(passthrough.databaseHooks ? { databaseHooks: passthrough.databaseHooks } : {}),
    ...(passthrough.hooks ? { hooks: passthrough.hooks } : {}),
    ...(passthrough.disabledPaths ? { disabledPaths: passthrough.disabledPaths } : {}),
    ...(resolvedSecret ? { secret: resolvedSecret } : {}),
    ...(resolvedSecrets ? { secrets: resolvedSecrets } : {}),
  });

  return instance as BetterAuthInstance;
}

/** Create a SQLite client using better-sqlite3. */
async function createSQLiteClient(connectionString: string, logger: PluginLoggerLike) {
  try {
    const { default: Database } = await import('better-sqlite3');
    const { Kysely, SqliteDialect, CamelCasePlugin } = await import('kysely');
    logger.debug?.(`Using better-sqlite3 for internal Better Auth database`);
    // Strip file: prefix if present
    let dbPath = connectionString.replace(/^file:/, '');
    if (dbPath === '') {
      dbPath = ':memory:';
    }
    const sqliteDb = new Database(dbPath);
    // Return in Better Auth's { db, type } format so it uses our Kysely instance
    // directly, preserving CamelCasePlugin for snake_case column mapping.
    const kyselyDb = new Kysely({
      dialect: new SqliteDialect({ database: sqliteDb }),
      plugins: [new CamelCasePlugin()],
    });
    return { db: kyselyDb, type: 'sqlite' as const };
  } catch (err) {
    if (err instanceof Error && err.message.includes('better-sqlite3')) {
      throw new Error(
        'Cannot create SQLite database for internal Better Auth: ' +
          'install better-sqlite3 (npm install better-sqlite3). ' +
          'Alternatively, provide your own Better Auth instance via the `auth` option.',
      );
    }
    throw err;
  }
}

/** Create a PostgreSQL pool from a connection string. */
async function createPostgresPool(connectionString: string) {
  try {
    const { Pool } = await import('pg');
    return new Pool({ connectionString });
  } catch {
    throw new Error(
      'Cannot create PostgreSQL pool for internal Better Auth: ' +
        'install the "pg" package. ' +
        'Alternatively, provide your own Better Auth instance via the `auth` option.',
    );
  }
}

/** Create a MySQL pool from a connection string. */
async function createMySQLPool(connectionString: string) {
  try {
    const mysql = await import('mysql2/promise');
    return mysql.createPool(connectionString);
  } catch {
    throw new Error(
      'Cannot create MySQL pool for internal Better Auth: ' +
        'install the "mysql2" package. ' +
        'Alternatively, provide your own Better Auth instance via the `auth` option.',
    );
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the Flowlib user-auth plugin (a light wrapper around Better Auth).
 *
 * This plugin:
 *
 * 1. **Proxies Better Auth routes** — All of Better Auth's HTTP endpoints
 *    (sign-in, sign-up, sign-out, OAuth callbacks, session, etc.) are mounted
 *    under the plugin endpoint space at `/plugins/auth/api/auth/*` (configurable).
 *
 * 2. **Resolves sessions → identities** — On every Flowlib API request, the
 *    `onRequest` hook reads the session cookie / bearer token via
 *    `auth.api.getSession()` and populates `FlowlibIdentity`.
 *
 * 3. **Handles authorization** — The `onAuthorize` hook lets Better Auth's
 *    session decide whether a request is allowed.
 *
 * @example
 * ```ts
 * // Simple: let the plugin manage Better Auth internally
 * import { authentication } from '@flowlib/user-auth';
 *
 * app.use('/flowlib', createFlowlibRouter({
 *   databaseUrl: 'file:./dev.db',
 *   plugins: [authentication({
 *     globalAdmins: [{ email: 'admin@co.com', pw: 'secret' }],
 *   })],
 * }));
 * ```
 *
 * @example
 * ```ts
 * // Advanced: provide your own better-auth instance
 * import { betterAuth } from 'better-auth';
 * import { authentication } from '@flowlib/user-auth';
 *
 * const auth = betterAuth({
 *   database: { ... },
 *   emailAndPassword: { enabled: true },
 *   // ... your better-auth config
 * });
 *
 * app.use('/flowlib', createFlowlibRouter({
 *   databaseUrl: 'file:./dev.db',
 *   plugins: [authentication({ auth })],
 * }));
 * ```
 */
export function authentication(options: AuthenticationPluginOptions): FlowlibPlugin {
  const {
    prefix = DEFAULT_PREFIX,
    mapUser: customMapUser,
    mapRole = defaultMapRole,
    publicPaths = [],
    globalAdmins = [],
  } = options;

  // Mutable — assigned in `init` when no external instance was provided.
  let auth: BetterAuthInstance | null = options.auth ?? null;

  /** Narrow `auth` for call-sites that run only after init. */
  function requireAuth(): BetterAuthInstance {
    if (!auth) {
      throw new Error('Auth plugin not initialized');
    }
    return auth;
  }

  let endpointLogger: PluginLoggerLike = console;

  // Determine Better Auth's basePath (defaults to /api/auth).
  // Computed lazily since `auth` may not exist until `init`.
  let betterAuthBasePath = '/api/auth';

  /**
   * Resolve an identity from a request's headers.
   */
  async function getIdentityFromHeaders(
    headers: Record<string, string | undefined>,
  ): Promise<FlowlibIdentity | null> {
    if (!auth) {
      return null;
    }

    const result = await resolveSession(auth, headers);
    if (!result) {
      return null;
    }

    if (customMapUser) {
      return customMapUser(result.user, result.session);
    }

    return defaultMapUser(result.user, result.session, mapRole);
  }

  async function getIdentityFromRequest(request: Request): Promise<FlowlibIdentity | null> {
    if (!auth) {
      return null;
    }

    const result = await callBetterAuthHandler(auth, request, '/get-session');
    const body = result?.body as { session?: BetterAuthSession; user?: BetterAuthUser } | null;
    if (!body?.session || !body?.user) {
      return null;
    }

    if (customMapUser) {
      return customMapUser(body.user, body.session);
    }

    return defaultMapUser(body.user, body.session, mapRole);
  }

  async function resolveEndpointIdentity(ctx: {
    identity: FlowlibIdentity | null;
    request: Request;
  }): Promise<FlowlibIdentity | null> {
    if (ctx.identity) {
      return ctx.identity;
    }

    return getIdentityFromRequest(ctx.request);
  }

  // Rate limiter for auth-sensitive endpoints (sign-in, sign-up, password reset)
  // 10 attempts per IP per 60 seconds by default
  const authRateLimiter = new RateLimiter(10, 60_000);

  // Periodic cleanup every 5 minutes to prevent memory leaks
  const cleanupInterval = setInterval(() => authRateLimiter.cleanup(), 5 * 60_000);
  cleanupInterval.unref?.(); // Don't keep the process alive

  // ----- Build plugin endpoint list -----
  // We create a catch-all endpoint that proxies everything under the prefix
  // to better-auth's handler. This covers all auth routes: sign-in, sign-up,
  // OAuth callbacks, session management, etc.

  const proxyMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

  const endpoints = proxyMethods.map((method) => ({
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: `/${prefix}/*` as const,
    isPublic: true, // Auth routes must be accessible without existing session
    handler: async (ctx: {
      body: Record<string, unknown>;
      params: Record<string, string>;
      query: Record<string, string | undefined>;
      headers: Record<string, string | undefined>;
      request: Request;
    }) => {
      // Build a new Request for better-auth's handler.
      // The incoming path is: /plugins/auth/api/auth/sign-in/email  (for example)
      // We need to reconstruct the URL that better-auth expects.
      const incomingUrl = new URL(ctx.request.url);
      endpointLogger.debug?.(`[auth-proxy] ${method} ${incomingUrl.pathname}`);

      // Strip the /plugins/<prefix> prefix from the pathname to get
      // the better-auth-relative path
      const pluginPrefixPattern = `/plugins/${prefix}`;
      let authPath = incomingUrl.pathname;
      const prefixIdx = authPath.indexOf(pluginPrefixPattern);
      if (prefixIdx !== -1) {
        authPath = authPath.slice(prefixIdx + pluginPrefixPattern.length);
      }
      if (!authPath.startsWith('/')) {
        authPath = '/' + authPath;
      }

      // ── Rate-limit auth-sensitive POST endpoints ──────────
      if (method === 'POST' && RATE_LIMITED_AUTH_PATHS.some((p) => authPath.includes(p))) {
        const clientIp =
          ctx.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          ctx.headers['x-real-ip'] ||
          'unknown';
        const { limited, retryAfterMs } = authRateLimiter.isRateLimited(clientIp);
        if (limited) {
          return new Response(
            JSON.stringify({
              error: 'Too Many Requests',
              message: 'Too many authentication attempts. Please try again later.',
            }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'retry-after': String(Math.ceil((retryAfterMs ?? 60_000) / 1000)),
              },
            },
          );
        }
      }

      // Construct the URL that better-auth expects
      const authUrl = new URL(`${incomingUrl.origin}${authPath}${incomingUrl.search}`);
      endpointLogger.debug?.(
        `[auth-proxy] Forwarding to better-auth: ${method} ${authUrl.pathname}`,
      );

      // Clone/forward the request to better-auth
      const authRequest = new Request(authUrl.toString(), {
        method: ctx.request.method,
        headers: ctx.request.headers,
        body: method !== 'GET' && method !== 'DELETE' ? ctx.request.body : undefined,
        // @ts-expect-error - duplex is needed for streaming bodies
        duplex: method !== 'GET' && method !== 'DELETE' ? 'half' : undefined,
      });

      // Let better-auth handle it
      const response = await requireAuth().handler(authRequest);
      endpointLogger.debug?.(`[auth-proxy] Response: ${response.status} ${response.statusText}`, {
        setCookie: response.headers.get('set-cookie') ? 'present' : 'absent',
        contentType: response.headers.get('content-type'),
      });
      return response;
    },
  }));

  // ----- Resolve API key opt from top-level or passthrough -----
  const apiKeyEnabled = !!(options.apiKey ?? options.betterAuthOptions?.apiKey);
  // Cap how many API keys a single user can hold at once. Keeps the
  // bookkeeping bounded and limits blast radius if a key leaks. Override via
  // `apiKey.maxKeysPerUser` on the auth plugin options.
  const apiKeyMaxPerUser =
    (typeof options.apiKey === 'object' &&
      options.apiKey !== null &&
      typeof (options.apiKey as { maxKeysPerUser?: unknown }).maxKeysPerUser === 'number' &&
      (options.apiKey as { maxKeysPerUser: number }).maxKeysPerUser) ||
    10;

  // ----- Build schema (always includes twoFactor, conditionally includes apikey) -----
  let schema: FlowlibPluginSchema = { ...USER_AUTH_SCHEMA };

  if (apiKeyEnabled) {
    schema = { ...schema, ...API_KEY_SCHEMA };
  }

  const requiredTables = [
    'flowlib_user',
    'flowlib_session',
    'flowlib_account',
    'flowlib_verification',
    'flowlib_flow_access',
    'flowlib_two_factor',
  ];
  if (apiKeyEnabled) {
    requiredTables.push('flowlib_apikey');
  }

  // ----- Build the plugin -----
  return {
    id: 'user-auth',
    name: 'User Auth',

    // Abstract schema for auth tables — the CLI reads this to generate
    // Drizzle/Prisma schema files that include auth tables automatically.
    schema,

    // Also declare requiredTables for the startup existence check.
    requiredTables,
    setupInstructions:
      'Run `npx flowlib-cli generate` to add the better-auth tables to your schema, ' +
      'then `npx drizzle-kit push` (or `npx flowlib-cli migrate`) to apply.',

    endpoints: [
      // ── Auth Info (specific routes must come BEFORE the catch-all proxy) ───

      {
        method: 'GET' as const,
        path: `/${prefix}/me`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
          core: {
            getPermissions: (identity: FlowlibIdentity | null) => string[];
            getResolvedRole: (identity: FlowlibIdentity) => string | null;
          };
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          const permissions = ctx.core.getPermissions(identity);
          const resolvedRole = identity ? ctx.core.getResolvedRole(identity) : null;

          return {
            status: 200,
            body: {
              identity: identity
                ? {
                    id: identity.id,
                    name: identity.name,
                    role: identity.role,
                    resolvedRole,
                  }
                : null,
              permissions,
              isAuthenticated: !!identity,
            },
          };
        },
      },

      {
        method: 'GET' as const,
        path: `/${prefix}/roles`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
          core: { getAvailableRoles: () => unknown };
        }) => {
          const roles = ctx.core.getAvailableRoles() as Array<{
            role: string;
            permissions: string[];
          }>;
          const missingRoles = AUTH_VISIBLE_ROLES.filter(
            (role) => !roles.some((entry) => entry.role === role),
          ).map((role) => ({ role, permissions: [] }));
          return { status: 200, body: { roles: [...roles, ...missingRoles] } };
        },
      },

      // ── Public sign-in page config ───────────────────────────
      // Returns flags the unauthenticated sign-in / sign-up pages need to
      // know about (sign-up enabled? magic-link enabled? configured social
      // providers?). Public — no session required.
      {
        method: 'GET' as const,
        path: `/${prefix}/public-config`,
        isPublic: true,
        handler: async () => {
          const passthroughOpts = options.betterAuthOptions ?? {};
          const signUpDisabledViaPassword =
            passthroughOpts.emailAndPassword?.disableSignUp === true;
          const signUpDisabledViaMagicLink =
            typeof options.magicLink === 'object' &&
            options.magicLink !== null &&
            (options.magicLink as { disableSignUp?: boolean }).disableSignUp === true;
          const signUpEnabled = !signUpDisabledViaPassword && !signUpDisabledViaMagicLink;

          const socialProviders = Object.keys(
            (passthroughOpts.socialProviders as Record<string, unknown> | undefined) ?? {},
          );

          return {
            status: 200,
            body: {
              signUpEnabled,
              magicLinkEnabled: !!options.magicLink,
              passwordEnabled: passthroughOpts.emailAndPassword?.enabled !== false,
              socialProviders,
            },
          };
        },
      },

      // ── Auth Info ────────────────────────────────────────────

      {
        method: 'GET' as const,
        path: `/${prefix}/info`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized' },
            };
          }
          return {
            status: 200,
            body: {
              apiKeysEnabled: apiKeyEnabled,
              twoFactorEnabled: true,
            },
          };
        },
      },

      // ── API Key Management (admin-only) ────────────────────

      {
        method: 'GET' as const,
        path: `/${prefix}/api-keys`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }
          if (!apiKeyEnabled) {
            return {
              status: 400,
              body: { error: 'API keys are not enabled' },
            };
          }

          try {
            const result = await callBetterAuthHandler(auth, ctx.request, '/api-key/list', {
              method: 'GET',
              query: ctx.query,
            });
            if (result && result.status >= 200 && result.status < 300) {
              const body = (result.body ?? {}) as Record<string, unknown>;
              return { status: 200, body: { ...body, maxKeysPerUser: apiKeyMaxPerUser } };
            }
            return {
              status: result?.status ?? 500,
              body: result?.body ?? { error: 'Failed to list API keys' },
            };
          } catch (err) {
            endpointLogger.error('Failed to list API keys', {
              identity: sanitizeForLogging(identity),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to list API keys', err);
          }
        },
      },

      {
        method: 'POST' as const,
        path: `/${prefix}/api-keys`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }
          if (!apiKeyEnabled) {
            return {
              status: 400,
              body: { error: 'API keys are not enabled' },
            };
          }

          const {
            name,
            expiresIn,
            prefix: keyPrefix,
          } = ctx.body as {
            name?: string;
            expiresIn?: number;
            prefix?: string;
          };

          try {
            // Enforce per-user cap. Better Auth's /api-key/list returns
            // the current user's keys when no organizationId is supplied.
            const existing = await callBetterAuthHandler(auth, ctx.request, '/api-key/list', {
              method: 'GET',
            });
            const existingKeys = (existing?.body as { apiKeys?: unknown[] } | undefined)?.apiKeys;
            if (Array.isArray(existingKeys) && existingKeys.length >= apiKeyMaxPerUser) {
              return {
                status: 409,
                body: {
                  error: 'API key limit reached',
                  message: `You can have at most ${apiKeyMaxPerUser} API keys. Delete an existing key to create a new one.`,
                  limit: apiKeyMaxPerUser,
                },
              };
            }

            const result = await callBetterAuthHandler(auth, ctx.request, '/api-key/create', {
              method: 'POST',
              body: {
                name: name || undefined,
                expiresIn: expiresIn || undefined,
                prefix: keyPrefix || undefined,
              },
            });
            if (result && result.status >= 200 && result.status < 300) {
              return { status: 201, body: result.body };
            }
            return {
              status: result?.status ?? 500,
              body: result?.body ?? { error: 'Failed to create API key' },
            };
          } catch (err) {
            endpointLogger.error('Failed to create API key', {
              identity: sanitizeForLogging(identity),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to create API key', err);
          }
        },
      },

      {
        method: 'DELETE' as const,
        path: `/${prefix}/api-keys/:keyId`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }
          if (!apiKeyEnabled) {
            return {
              status: 400,
              body: { error: 'API keys are not enabled' },
            };
          }

          const { keyId } = ctx.params;
          try {
            const result = await callBetterAuthHandler(auth, ctx.request, '/api-key/delete', {
              method: 'POST',
              body: { keyId },
            });
            if (result && result.status >= 200 && result.status < 300) {
              return { status: 200, body: { success: true } };
            }
            return {
              status: result?.status ?? 500,
              body: result?.body ?? { error: 'Failed to delete API key' },
            };
          } catch (err) {
            endpointLogger.error('Failed to delete API key', {
              identity: sanitizeForLogging(identity),
              params: sanitizeForLogging(ctx.params),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to delete API key', err);
          }
        },
      },

      // ── User Management (admin-only) ──────────────────────

      {
        method: 'GET' as const,
        path: `/${prefix}/users`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }

          try {
            const api = requireAuth().api as Record<string, unknown>;
            const headers = toHeaders(ctx.headers);

            // Try better-auth's admin listUsers API first
            if (typeof api.listUsers === 'function') {
              const listUsers = api.listUsers as BetterAuthHeadersQueryMethod<
                { users?: unknown[] } | unknown[] | null
              >;
              const result = await listUsers({
                headers,
                query: {
                  limit: ctx.query.limit ?? '100',
                  offset: ctx.query.offset ?? '0',
                },
              });
              const users = Array.isArray(result) ? result : (result?.users ?? []);
              return { status: 200, body: { users } };
            }

            const fallbackResult = await callBetterAuthHandler(
              auth,
              ctx.request,
              '/admin/list-users',
              {
                method: 'GET',
                query: {
                  limit: ctx.query.limit ?? '100',
                  offset: ctx.query.offset ?? '0',
                },
              },
            );
            if (fallbackResult && fallbackResult.status >= 200 && fallbackResult.status < 300) {
              return {
                status: 200,
                body: fallbackResult.body as Record<string, unknown>,
              };
            }

            // Fallback: query the user table directly via an internal request
            // to better-auth's get-session endpoint for the current user
            return {
              status: 200,
              body: {
                users: [],
                message:
                  'User listing requires the better-auth admin plugin. ' +
                  'Add `admin()` to your better-auth plugins config.',
              },
            };
          } catch (err) {
            endpointLogger.error('Failed to list users', {
              identity: sanitizeForLogging(identity),
              query: sanitizeForLogging(ctx.query),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to list users', err);
          }
        },
      },

      {
        method: 'POST' as const,
        path: `/${prefix}/users`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }

          const { email, password, name, role } = ctx.body as {
            email?: string;
            password?: string;
            name?: string;
            role?: string;
          };

          if (!email || !password) {
            return {
              status: 400,
              body: { error: 'email and password are required' },
            };
          }

          if (role !== undefined && !isAuthAssignableRole(role)) {
            return {
              status: 400,
              body: {
                error: 'role must be one of: ' + AUTH_ASSIGNABLE_ROLES.join(', '),
              },
            };
          }

          try {
            const api = requireAuth().api as Record<string, unknown>;
            const headers = toHeaders(ctx.headers);
            let result: BetterAuthApiUserResult | null = null;

            if (typeof api.createUser === 'function') {
              const createUser =
                api.createUser as BetterAuthHeadersBodyMethod<BetterAuthApiUserResult>;
              result = await createUser({
                headers,
                body: {
                  email,
                  password,
                  name: name ?? email.split('@')[0],
                  role: role ?? AUTH_DEFAULT_ROLE,
                },
              });
            } else if (typeof api.signUpEmail === 'function') {
              const signUpEmail =
                api.signUpEmail as BetterAuthHeadersBodyMethod<BetterAuthApiUserResult>;
              result = await signUpEmail({
                headers,
                body: {
                  email,
                  password,
                  name: name ?? email.split('@')[0],
                  role: role ?? AUTH_DEFAULT_ROLE,
                },
              });
            } else {
              const fallbackResult = await callBetterAuthHandler(
                auth,
                ctx.request,
                '/admin/create-user',
                {
                  method: 'POST',
                  body: {
                    email,
                    password,
                    name: name ?? email.split('@')[0],
                    role: role ?? AUTH_DEFAULT_ROLE,
                  },
                },
              );
              if (fallbackResult && fallbackResult.status >= 200 && fallbackResult.status < 300) {
                result = fallbackResult.body as BetterAuthApiUserResult;
              }
            }

            if (
              !result &&
              typeof api.createUser !== 'function' &&
              typeof api.signUpEmail !== 'function'
            ) {
              return {
                status: 500,
                body: { error: 'Auth API does not support user creation' },
              };
            }

            if (!result?.user) {
              return {
                status: 400,
                body: {
                  error: 'Failed to create user',
                  message: 'User may already exist',
                },
              };
            }

            return {
              status: 201,
              body: {
                user: {
                  id: result.user.id,
                  email: result.user.email,
                  name: result.user.name,
                  role: result.user.role,
                },
              },
            };
          } catch (err) {
            endpointLogger.error('Failed to create user', {
              identity: sanitizeForLogging(identity),
              body: sanitizeForLogging({ email, name, role }),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to create user', err);
          }
        },
      },

      {
        method: 'PATCH' as const,
        path: `/${prefix}/users/:userId/role`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }

          const { userId } = ctx.params;
          const { role } = ctx.body as { role?: string };

          if (!isAuthAssignableRole(role)) {
            return {
              status: 400,
              body: {
                error: 'role must be one of: ' + AUTH_ASSIGNABLE_ROLES.join(', '),
              },
            };
          }

          try {
            const api = requireAuth().api as Record<string, unknown>;
            const headers = toHeaders(ctx.headers);

            // Try better-auth admin API for updating user
            if (typeof api.setRole === 'function') {
              const setRole = api.setRole as BetterAuthHeadersBodyMethod<unknown>;
              await setRole({
                headers,
                body: { userId, role },
              });
              return { status: 200, body: { success: true, userId, role } };
            }

            const fallbackResult = await callBetterAuthHandler(
              auth,
              ctx.request,
              '/admin/set-role',
              {
                method: 'POST',
                body: { userId, role },
              },
            );
            if (fallbackResult && fallbackResult.status >= 200 && fallbackResult.status < 300) {
              return { status: 200, body: { success: true, userId, role } };
            }

            // Fallback: try updateUser API
            if (typeof api.updateUser === 'function') {
              const updateUser = api.updateUser as BetterAuthHeadersBodyParamsMethod<unknown>;
              await updateUser({
                headers,
                body: { role },
                params: { id: userId },
              });
              return { status: 200, body: { success: true, userId, role } };
            }

            return {
              status: 501,
              body: {
                error:
                  'Role update requires the better-auth admin plugin. ' +
                  'Add `admin()` to your better-auth plugins config.',
              },
            };
          } catch (err) {
            endpointLogger.error('Failed to update role', {
              identity: sanitizeForLogging(identity),
              params: sanitizeForLogging(ctx.params),
              body: sanitizeForLogging({ role }),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to update role', err);
          }
        },
      },

      {
        method: 'DELETE' as const,
        path: `/${prefix}/users/:userId`,
        isPublic: false,
        handler: async (ctx: {
          body: Record<string, unknown>;
          params: Record<string, string>;
          query: Record<string, string | undefined>;
          headers: Record<string, string | undefined>;
          identity: FlowlibIdentity | null;
          request: Request;
        }) => {
          const identity = await resolveEndpointIdentity(ctx);
          if (!identity || identity.role !== 'admin') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Admin access required' },
            };
          }

          const { userId } = ctx.params;

          // Prevent deleting yourself
          if (identity.id === userId) {
            return {
              status: 400,
              body: { error: 'Cannot delete your own account' },
            };
          }

          try {
            const api = requireAuth().api as Record<string, unknown>;
            const headers = toHeaders(ctx.headers);

            if (typeof api.removeUser === 'function') {
              const removeUser = api.removeUser as BetterAuthHeadersBodyMethod<unknown>;
              await removeUser({
                headers,
                body: { userId },
              });
              return { status: 200, body: { success: true, userId } };
            }

            const fallbackResult = await callBetterAuthHandler(
              auth,
              ctx.request,
              '/admin/remove-user',
              {
                method: 'POST',
                body: { userId },
              },
            );
            if (fallbackResult && fallbackResult.status >= 200 && fallbackResult.status < 300) {
              return { status: 200, body: { success: true, userId } };
            }

            // Try deleteUser
            if (typeof api.deleteUser === 'function') {
              const deleteUser = api.deleteUser as BetterAuthHeadersBodyMethod<unknown>;
              await deleteUser({
                headers,
                body: { userId },
              });
              return { status: 200, body: { success: true, userId } };
            }

            return {
              status: 501,
              body: {
                error:
                  'User deletion requires the better-auth admin plugin. ' +
                  'Add `admin()` to your better-auth plugins config.',
              },
            };
          } catch (err) {
            endpointLogger.error('Failed to delete user', {
              identity: sanitizeForLogging(identity),
              params: sanitizeForLogging(ctx.params),
              error: getErrorLogDetails(err),
            });
            return toAuthApiErrorResponse('Failed to delete user', err);
          }
        },
      },

      // ── Auth proxy catch-all (must come LAST so specific routes above win) ──
      ...endpoints,
    ],

    hooks: {
      /**
       * onRequest: Intercept incoming requests to resolve auth sessions.
       *
       * - Auth proxy routes are passed through untouched.
       * - For all other routes, we resolve the session. If no session exists,
       *   we short-circuit with a 401.
       */
      onRequest: async (
        request: Request,
        context: { path: string; method: string; identity: FlowlibIdentity | null },
      ) => {
        // Skip session resolution for auth proxy routes
        if (isBetterAuthRoute(context.path, prefix, betterAuthBasePath)) {
          return; // Let the proxy endpoint handle it
        }

        // Skip for public paths
        if (publicPaths.some((p) => context.path.startsWith(p))) {
          return;
        }

        // Resolve session from request headers
        const headersRecord: Record<string, string | undefined> = {};
        request.headers.forEach((value, key) => {
          headersRecord[key] = value;
        });

        endpointLogger.debug?.(`[auth-onRequest] ${context.method} ${context.path}`, {
          hasCookie: !!headersRecord['cookie'],
          hasAuth: !!headersRecord['authorization'],
        });

        const identity = await getIdentityFromHeaders(headersRecord);

        endpointLogger.debug?.(`[auth-onRequest] Identity resolved:`, {
          authenticated: !!identity,
          userId: identity?.id,
          role: identity?.role,
        });

        // Write identity back so the framework adapter has it available.
        context.identity = identity;

        if (!identity) {
          return {
            response: new Response(
              JSON.stringify({
                error: 'Unauthorized',
                message: 'Valid session required. Sign in via better-auth.',
              }),
              {
                status: 401,
                headers: { 'content-type': 'application/json' },
              },
            ),
          };
        }
      },

      /**
       * onAuthorize: Baseline authorization guard using better-auth sessions.
       *
       * If the identity is already populated (from onRequest),
       * we defer to downstream authorization hooks. This hook is a fallback
       * for cases where the identity wasn't resolved upstream.
       */
      onAuthorize: async (context: {
        identity: FlowlibIdentity | null;
        action: FlowlibPermission;
        resource?: { type: string; id?: string };
      }) => {
        // If an identity is already attached, let downstream authorization proceed
        if (context.identity) {
          return;
        }

        // No identity — deny access
        return { allowed: false, reason: 'No valid better-auth session' };
      },
    },

    init: async (pluginContext) => {
      endpointLogger = pluginContext.logger;

      // ── Create internal better-auth instance if none was provided ────────
      if (!auth) {
        auth = await createInternalBetterAuth(pluginContext.config, options, pluginContext.logger);
      }

      betterAuthBasePath = auth.options?.basePath ?? '/api/auth';

      pluginContext.logger.info(
        `Better Auth plugin initialized (prefix: ${prefix}, basePath: ${betterAuthBasePath})`,
      );

      if (globalAdmins.length === 0) {
        pluginContext.logger.debug(
          'No global admins configured. Pass `globalAdmins` to authentication(...) to seed admin access.',
        );
        return;
      }

      for (const configuredAdmin of globalAdmins) {
        const adminEmail = configuredAdmin.email?.trim();
        const adminPassword = configuredAdmin.pw;
        const adminName = configuredAdmin.name?.trim() || 'Admin';

        if (!adminEmail || !adminPassword) {
          pluginContext.logger.debug(
            'Skipping invalid global admin config: both email and pw are required.',
          );
          continue;
        }

        try {
          const authContext = await getAuthContext(auth);
          const existingAdminUser = unwrapFoundUser(
            await authContext?.internalAdapter?.findUserByEmail(adminEmail),
          );

          if (existingAdminUser) {
            if (existingAdminUser.role !== 'admin') {
              await authContext?.internalAdapter?.updateUser(existingAdminUser.id, {
                role: 'admin',
              });
              pluginContext.logger.info(`Admin user promoted: ${adminEmail}`);
            } else {
              pluginContext.logger.debug(`Admin user already configured: ${adminEmail}`);
            }

            continue;
          }

          const api = requireAuth().api as Record<string, unknown>;
          let result: BetterAuthApiUserResult | null = null;

          // Try createUser first (admin plugin API), then fall back to signUpEmail.
          // createUser requires admin auth headers which aren't available during
          // initial seeding, so we fall through to signUpEmail when it fails.
          if (typeof api.createUser === 'function') {
            const createUser =
              api.createUser as BetterAuthHeadersBodyMethod<BetterAuthApiUserResult>;
            result = await createUser({
              headers: new Headers(),
              body: {
                email: adminEmail,
                password: adminPassword,
                name: adminName,
                role: 'admin',
              },
            }).catch((_err: unknown) => {
              pluginContext.logger.debug?.(
                `createUser API requires auth, falling back to signUpEmail for ${adminEmail}`,
              );
              return null;
            });
          }

          if (!result?.user && typeof api.signUpEmail === 'function') {
            const signUpEmail = api.signUpEmail as BetterAuthBodyMethod<BetterAuthApiUserResult>;
            result = await signUpEmail({
              body: {
                email: adminEmail,
                password: adminPassword,
                name: adminName,
              },
            }).catch((err: unknown) => {
              pluginContext.logger.error?.(
                `signUpEmail failed for ${adminEmail}: ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            });
          }

          if (
            !result?.user &&
            typeof api.createUser !== 'function' &&
            typeof api.signUpEmail !== 'function'
          ) {
            pluginContext.logger.debug(
              `Could not create global admin ${adminEmail}: auth.api.createUser/signUpEmail are unavailable.`,
            );
            continue;
          }

          if (result?.user) {
            // Promote the newly created user to admin via internal adapter
            const createdAuthContext = authContext ?? (await getAuthContext(auth));
            const createdAdminUser =
              unwrapFoundUser(
                await createdAuthContext?.internalAdapter?.findUserByEmail(adminEmail),
              ) ?? result.user;

            if (createdAdminUser?.id && createdAdminUser.role !== 'admin') {
              await createdAuthContext?.internalAdapter?.updateUser(createdAdminUser.id, {
                role: 'admin',
              });
            }

            pluginContext.logger.info(`Admin user created: ${adminEmail}`);
          } else {
            pluginContext.logger.debug(
              `Admin user already exists or could not be created: ${adminEmail}`,
            );
          }
        } catch (seedErr) {
          pluginContext.logger.debug(
            `Could not seed admin user (tables may not exist yet): ${adminEmail} — ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`,
          );
        }
      }
    },

    $ERROR_CODES: {
      'auth:session_expired': {
        message: 'Session has expired. Please sign in again.',
        status: 401,
      },
      'auth:session_not_found': {
        message: 'No valid session found.',
        status: 401,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Check if a path is a better-auth proxy route (should skip session checks).
 * Only matches the actual better-auth API proxy routes, not custom plugin endpoints.
 */
function isBetterAuthRoute(path: string, prefix: string, basePath: string): boolean {
  return path.startsWith(`/plugins/${prefix}${basePath}`);
}
