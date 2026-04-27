import type { InvectIdentity, InvectRole } from '@flowlib/core';

// ---------------------------------------------------------------------------
// Better Auth type stubs
// ---------------------------------------------------------------------------
// We define minimal types here rather than importing from better-auth directly.
// This lets us compile the package without requiring better-auth at build time
// while still providing the correct shapes at the type level.
// Users pass in a fully-typed Auth instance from `betterAuth()`.
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a better-auth User object.
 */
export interface BetterAuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  [key: string]: unknown;
}

/**
 * Minimal representation of a better-auth Session object.
 */
export interface BetterAuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date | string;
  [key: string]: unknown;
}

/**
 * The shape returned by `auth.api.getSession()`.
 */
export interface BetterAuthSessionResult {
  user: BetterAuthUser;
  session: BetterAuthSession;
}

export interface BetterAuthInternalAdapter {
  findUserByEmail: (
    email: string,
  ) => Promise<BetterAuthUser | { user?: BetterAuthUser | null } | null>;
  updateUser: (userId: string, data: Record<string, unknown>) => Promise<BetterAuthUser | null>;
}

export interface BetterAuthContext {
  internalAdapter?: BetterAuthInternalAdapter;
}

export interface BetterAuthGlobalAdmin {
  email?: string;
  pw?: string;
  name?: string;
}

/**
 * Minimal Auth instance type — what `betterAuth()` returns.
 *
 * We intentionally keep this narrow so we don't couple to better-auth's
 * full internal types. The plugin only needs `handler` and `api.getSession`.
 */
export interface BetterAuthInstance {
  /** Handles HTTP requests — the core request router. */
  handler: (request: Request) => Promise<Response>;

  /** Server-side API methods. */
  api: {
    getSession: (context: { headers: Headers }) => Promise<BetterAuthSessionResult | null>;
    [key: string]: unknown;
  };

  /** Auth options (used to read basePath). */
  options?: {
    basePath?: string;
    [key: string]: unknown;
  };

  $context?: Promise<BetterAuthContext>;

  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Better Auth passthrough options
// ---------------------------------------------------------------------------

/**
 * Cookie attribute options (subset of Better Auth's CookieOptions).
 */
export interface CookieAttributeOptions {
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  domain?: string;
  maxAge?: number;
  httpOnly?: boolean;
}

/**
 * A reasonable subset of Better Auth's configuration that can be passed
 * through when the plugin creates an internal Better Auth instance.
 *
 * These are ignored when you provide your own `auth` instance.
 *
 * @see https://www.better-auth.com/docs/reference/auth
 */
export interface BetterAuthPassthroughOptions {
  /** Email and password authentication settings. */
  emailAndPassword?: {
    enabled?: boolean;
    disableSignUp?: boolean;
    requireEmailVerification?: boolean;
    minPasswordLength?: number;
    maxPasswordLength?: number;
    autoSignIn?: boolean;
    revokeSessionsOnPasswordReset?: boolean;
  };

  /** Session configuration. */
  session?: {
    expiresIn?: number;
    updateAge?: number;
    disableSessionRefresh?: boolean;
    freshAge?: number;
    cookieCache?: {
      enabled?: boolean;
      maxAge?: number;
      strategy?: 'compact' | 'jwt' | 'jwe';
    };
  };

  /** Account linking configuration. */
  account?: {
    updateAccountOnSignIn?: boolean;
    accountLinking?: {
      enabled?: boolean;
      disableImplicitLinking?: boolean;
      allowDifferentEmails?: boolean;
      allowUnlinkingAll?: boolean;
    };
  };

  /** Social / OAuth providers (passed directly to Better Auth). */
  socialProviders?: Record<string, unknown>;

  /** Rate limiting. */
  rateLimit?: {
    enabled?: boolean;
    window?: number;
    max?: number;
  };

  /** Advanced options — use with caution. */
  advanced?: {
    useSecureCookies?: boolean;
    disableCSRFCheck?: boolean;
    cookiePrefix?: string;
    defaultCookieAttributes?: CookieAttributeOptions;
    crossSubDomainCookies?: {
      enabled: boolean;
      additionalCookies?: string[];
      domain?: string;
    };
    ipAddress?: {
      ipAddressHeaders?: string[];
      disableIpTracking?: boolean;
    };
  };

  /** Database hooks (lifecycle callbacks on core tables). */
  databaseHooks?: Record<string, unknown>;

  /** Lifecycle hooks (before/after request processing). */
  hooks?: Record<string, unknown>;

  /** Paths to disable (e.g. sign-up). */
  disabledPaths?: string[];

  /**
   * Secret used for encryption, signing and hashing.
   *
   * Better Auth defaults to `BETTER_AUTH_SECRET` or `AUTH_SECRET` env vars.
   * In production, this **must** be set or Better Auth will throw.
   *
   * Generate one with: `openssl rand -base64 32`
   */
  secret?: string;

  /**
   * Versioned secrets for non-destructive secret rotation.
   *
   * The first entry is the current key used for new encryption.
   * Remaining entries are decryption-only (previous rotations).
   *
   * Can also be set via `BETTER_AUTH_SECRETS` env var:
   * `BETTER_AUTH_SECRETS=2:base64secret,1:base64secret`
   */
  secrets?: Array<{ version: number; value: string }>;

  /**
   * Configuration for the Better Auth API Key plugin (`@better-auth/api-key`).
   *
   * Set to `true` to enable with defaults, or pass an object to customise.
   * Disabled by default.
   *
   * When enabled, `@better-auth/api-key` must be installed as a dependency.
   *
   * @see https://better-auth.com/docs/plugins/api-key
   */
  apiKey?: boolean | ApiKeyPluginOptions;
}

/**
 * Options forwarded to the `apiKey()` Better Auth plugin.
 *
 * @see https://better-auth.com/docs/plugins/api-key/reference
 */
export interface ApiKeyPluginOptions {
  /** Default length of generated API keys (excluding prefix). */
  defaultKeyLength?: number;
  /** Default prefix prepended to every generated key. */
  defaultPrefix?: string;
  /** Require a name when creating an API key. */
  requireName?: boolean;
  /** Enable metadata storage on API keys. */
  enableMetadata?: boolean;
  /** Create mock sessions from API keys so existing session guards work. */
  enableSessionForAPIKeys?: boolean;
  /** Disable hashing of API keys (NOT recommended — insecure). */
  disableKeyHashing?: boolean;
  /** Header(s) to read the API key from. @default 'x-flowlib-token' */
  apiKeyHeaders?: string | string[];
  /** Key expiration defaults. */
  keyExpiration?: {
    defaultExpiresIn?: number | null;
    disableCustomExpiresTime?: boolean;
    minExpiresIn?: number;
    maxExpiresIn?: number;
  };
  /** Rate limiting for API key usage. */
  rateLimit?: {
    enabled?: boolean;
    timeWindow?: number;
    maxRequests?: number;
  };
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options forwarded to the `twoFactor()` Better Auth plugin.
 *
 * @see https://better-auth.com/docs/plugins/2fa
 */
export interface TwoFactorPluginOptions {
  /**
   * The issuer name displayed in authenticator apps (e.g. Google Authenticator).
   * Defaults to `'Invect'` if not set.
   */
  issuer?: string;
  /** Skip the TOTP verification step when enabling 2FA. @default false */
  skipVerificationOnEnable?: boolean;
  /** Allow enabling/managing 2FA without a password for passwordless users. @default false */
  allowPasswordless?: boolean;
  /** TOTP-specific options. */
  totpOptions?: {
    /** Number of digits in the TOTP code. @default 6 */
    digits?: number;
    /** TOTP time period in seconds. @default 30 */
    period?: number;
  };
  /** Backup code options. */
  backupCodeOptions?: {
    /** Number of backup codes to generate. @default 10 */
    amount?: number;
    /** Length of each backup code. @default 10 */
    length?: number;
    /** Custom backup code generator function. */
    customBackupCodesGenerate?: () => string[];
  };
}

/**
 * Configuration for the User Auth Invect plugin.
 *
 * A light wrapper around [Better Auth](https://better-auth.com).
 */
export interface AuthenticationPluginOptions {
  /**
   * A configured Better Auth instance (the return value of `betterAuth()`).
   *
   * When omitted, the plugin creates an internal Better Auth instance
   * automatically using Invect's database configuration. This is the
   * recommended approach for simple setups — no separate `auth.ts` file needed.
   *
   * @example
   * ```ts
   * // Simple: let the plugin manage better-auth internally
   * authentication({ globalAdmins: [{ email: 'admin@example.com', pw: 'secret' }] });
   *
   * // Advanced: provide your own instance for full control
   * import { betterAuth } from 'better-auth';
   * const auth = betterAuth({ ... });
   * authentication({ auth });
   * ```
   */
  auth?: BetterAuthInstance;

  /**
   * Database for the internal better-auth instance.
   *
   * Accepts anything that `betterAuth({ database })` accepts — e.g. a
   * `better-sqlite3` instance, a `pg` Pool, etc.
   *
   * When omitted, the plugin creates a database client from Invect's
   * `database` (connection string + type).
   *
   * Only used when `auth` is **not** provided.
   */
  database?: unknown;

  /**
   * Base URL for the auth server (used for cookies, CSRF tokens, etc.).
   *
   * Defaults to `BETTER_AUTH_URL` env var, or `http://localhost:PORT`.
   *
   * Only used when `auth` is **not** provided.
   */
  baseURL?: string;

  /**
   * Origins trusted for CORS / cookie sharing.
   *
   * Defaults to common local development origins plus the `baseURL`.
   *
   * Only used when `auth` is **not** provided.
   */
  trustedOrigins?: string[] | ((request: Request) => string[]);

  /**
   * URL path prefix where better-auth routes are mounted within Invect's
   * plugin endpoint space.
   *
   * Plugin endpoints are served at `/plugins/<prefix>/...`.
   * better-auth's own basePath (usually `/api/auth`) is mapped under this.
   *
   * @default 'auth'
   */
  prefix?: string;

  /**
   * Map a better-auth user + session to an `InvectIdentity`.
   *
   * Override this to customise role mapping, team resolution, or resource
   * access from your better-auth user model.
   *
   * @default — Uses `user.id`, `user.name`, and maps `user.role` to an Invect role.
   */
  mapUser?: (
    user: BetterAuthUser,
    session: BetterAuthSession,
  ) => InvectIdentity | Promise<InvectIdentity>;

  /**
   * Map a better-auth user role string to an Invect role.
   * Only used when `mapUser` is not provided.
   *
   * @default — Maps admin/RBAC roles directly, aliases readonly → viewer,
   * and falls back to default for missing or unknown roles.
   */
  mapRole?: (role: string | null | undefined) => InvectRole;

  /**
   * Paths (relative to the Invect mount point) that should be accessible
   * without a valid session.
   *
   * The better-auth proxy routes (sign-in, sign-up, callback, etc.) are
   * always public regardless of this setting.
   *
   * @default []
   */
  publicPaths?: string[];

  /**
   * Explicit list of global admin accounts to seed and/or promote on startup.
   *
   * Each configured admin is ensured to exist with the `admin` role.
   * This is intentionally explicit; the plugin does not implicitly read
   * admin credentials from environment variables.
   */
  globalAdmins?: BetterAuthGlobalAdmin[];

  /**
   * Better Auth configuration options passed through to the internal instance.
   *
   * Use this to configure session behaviour, email/password settings,
   * social providers, rate limiting, advanced cookie options, etc.
   * without needing to create your own `betterAuth()` instance.
   *
   * Ignored when `auth` is provided (you already have full control).
   *
   * @example
   * ```ts
   * authentication({
   *   betterAuthOptions: {
   *     session: { expiresIn: 60 * 60 * 24 * 30 }, // 30 days
   *     advanced: { useSecureCookies: true },
   *   },
   * })
   * ```
   */
  betterAuthOptions?: BetterAuthPassthroughOptions;

  /**
   * Enable the Better Auth API Key plugin (`@better-auth/api-key`).
   *
   * Set to `true` to enable with defaults, or pass an options object.
   * Disabled by default.
   *
   * When enabled, users can create and verify API keys for programmatic
   * access to your application. The `apikey` database table will be
   * required.
   *
   * This is a convenience shorthand — equivalent to setting
   * `betterAuthOptions.apiKey`.
   *
   * @see https://better-auth.com/docs/plugins/api-key
   */
  apiKey?: boolean | ApiKeyPluginOptions;

  /**
   * Configuration for the Two-Factor Authentication plugin.
   *
   * 2FA (TOTP + backup codes) is always bundled and available.
   * Pass an options object to customise the issuer name, TOTP digits/period,
   * or backup code settings.
   *
   * Users enable 2FA on their own account from the profile page.
   * All Better Auth 2FA endpoints (enable, disable, verify-totp, backup codes,
   * etc.) are automatically proxied through the auth plugin's catch-all route.
   *
   * @see https://better-auth.com/docs/plugins/2fa
   */
  twoFactor?: TwoFactorPluginOptions;

  /**
   * Frontend plugin (sidebar, routes, providers) for the auth UI.
   *
   * Import from `@flowlib/user-auth/ui` and pass here.
   * Omit for backend-only setups (Express without React).
   *
   * @example
   * ```ts
   * import { authFrontend } from '@flowlib/user-auth/ui';
   * auth({ frontend: authFrontend })
   * ```
   */
  frontend?: unknown;
}
