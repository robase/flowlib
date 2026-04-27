/**
 * OAuth2 Service
 *
 * Handles OAuth2 authorization flow:
 * 1. Generate authorization URL with state
 * 2. Exchange authorization code for tokens
 * 3. Refresh access tokens when expired
 */

import { randomBytes, createHash } from 'crypto';
import type { Logger } from 'src/schemas';
import type { CredentialConfig } from 'src/database/schema-sqlite';
import {
  getOAuth2Provider,
  getAllOAuth2Providers,
  type OAuth2ProviderDefinition,
} from './oauth2-providers';

/**
 * OAuth2 configuration for the Invect application
 */
export interface OAuth2AppConfig {
  /** Client ID from the OAuth provider */
  clientId: string;
  /** Client secret from the OAuth provider */
  clientSecret: string;
  /** Redirect URI registered with the provider */
  redirectUri: string;
}

/**
 * Result of starting an OAuth2 flow
 */
export interface OAuth2StartResult {
  /** URL to redirect the user to */
  authorizationUrl: string;
  /** State parameter for CSRF protection (store and verify on callback) */
  state: string;
  /** Code verifier for PKCE (store and use during token exchange) */
  codeVerifier?: string;
}

/**
 * OAuth2 tokens received from provider
 */
export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number; // seconds until expiry
  scope?: string;
  /** Additional provider-specific data */
  raw?: Record<string, unknown>;
}

/**
 * Pending OAuth2 flow state
 * Store this temporarily during the OAuth flow
 */
export interface OAuth2PendingState {
  state: string;
  providerId: string;
  codeVerifier?: string;
  /** Original URL to redirect back to after OAuth completes */
  returnUrl?: string;
  /** Custom credential name */
  credentialName?: string;
  /** If set, update this credential instead of creating a new one */
  existingCredentialId?: string;
  /** App credentials stored from the start flow, so the callback doesn't need them from the client */
  appConfig?: { clientId: string; clientSecret: string; redirectUri: string };
  /** Timestamp when this state was created */
  createdAt: number;
}

// In-memory store for pending OAuth states (should use Redis in production)
const pendingStates = new Map<string, OAuth2PendingState>();

// Clean up expired states (older than 10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000;

// PR 5/14 (flowlib-hosted/UPSTREAM.md): pending-state cleanup is now driven
// by the host. The previous module-level `setInterval` started a timer at
// import time which broke edge runtimes (no timers between requests, the
// interval ran in every isolate, and was never cleared). Hosts must now
// invoke `flowlib.maintenance.cleanupExpiredOAuthStates()` from a cron entry
// point, OR call `OAuth2Service.cleanupExpiredStates()` directly.

/**
 * OAuth2 Service for handling authorization flows
 */
export class OAuth2Service {
  constructor(private readonly logger: Logger) {}

  /**
   * Sweep the in-memory pending-state map and drop entries older than
   * `STATE_EXPIRY_MS`. Returns the number of entries evicted.
   *
   * Self-hosted long-lived processes can wire this to a `setInterval`;
   * serverless / edge hosts should drive it from an external cron tick
   * via `flowlib.maintenance.cleanupExpiredOAuthStates()`.
   */
  cleanupExpiredStates(now: number = Date.now()): { count: number } {
    let count = 0;
    for (const [state, pending] of pendingStates.entries()) {
      if (now - pending.createdAt > STATE_EXPIRY_MS) {
        pendingStates.delete(state);
        count += 1;
      }
    }
    if (count > 0) {
      this.logger.debug('Evicted expired OAuth2 pending states', { count });
    }
    return { count };
  }

  /**
   * Get all available OAuth2 providers
   */
  getProviders(): OAuth2ProviderDefinition[] {
    return getAllOAuth2Providers();
  }

  /**
   * Get a specific OAuth2 provider
   */
  getProvider(providerId: string): OAuth2ProviderDefinition | undefined {
    return getOAuth2Provider(providerId);
  }

  /**
   * Start an OAuth2 authorization flow
   *
   * @param providerId - The OAuth2 provider ID
   * @param appConfig - OAuth app credentials and redirect URI
   * @param options - Additional options
   * @returns Authorization URL and state to redirect user to
   */
  startAuthorizationFlow(
    providerId: string,
    appConfig: OAuth2AppConfig,
    options: {
      scopes?: string[];
      returnUrl?: string;
      credentialName?: string;
      existingCredentialId?: string;
    } = {},
  ): OAuth2StartResult {
    const provider = getOAuth2Provider(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth2 provider: ${providerId}`);
    }

    // Generate cryptographically secure state
    const state = randomBytes(32).toString('hex');

    // Generate PKCE code verifier and challenge
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: appConfig.clientId,
      redirect_uri: appConfig.redirectUri,
      response_type: 'code',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Add scopes
    const scopes = options.scopes ?? provider.defaultScopes;
    if (scopes.length > 0) {
      const separator = provider.scopeSeparator ?? ' ';
      params.set('scope', scopes.join(separator));
    }

    // Add provider-specific additional params
    if (provider.additionalAuthParams) {
      for (const [key, value] of Object.entries(provider.additionalAuthParams)) {
        params.set(key, value);
      }
    }

    const authorizationUrl = `${provider.authorizationUrl}?${params.toString()}`;

    // Store pending state
    const pendingState: OAuth2PendingState = {
      state,
      providerId,
      codeVerifier,
      returnUrl: options.returnUrl,
      credentialName: options.credentialName,
      existingCredentialId: options.existingCredentialId,
      appConfig: {
        clientId: appConfig.clientId,
        clientSecret: appConfig.clientSecret,
        redirectUri: appConfig.redirectUri,
      },
      createdAt: Date.now(),
    };
    pendingStates.set(state, pendingState);

    this.logger.debug('Started OAuth2 flow', { providerId, state });

    return {
      authorizationUrl,
      state,
      codeVerifier,
    };
  }

  /**
   * Get pending OAuth2 state
   */
  getPendingState(state: string): OAuth2PendingState | undefined {
    return pendingStates.get(state);
  }

  /**
   * Remove pending OAuth2 state (after successful exchange)
   */
  removePendingState(state: string): void {
    pendingStates.delete(state);
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - Authorization code from callback
   * @param state - State parameter for verification
   * @param appConfig - OAuth app credentials
   * @returns OAuth2 tokens
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
    appConfig: OAuth2AppConfig,
  ): Promise<{ tokens: OAuth2Tokens; pendingState: OAuth2PendingState }> {
    // Verify and retrieve pending state
    const pendingState = pendingStates.get(state);
    if (!pendingState) {
      throw new Error('Invalid or expired OAuth state. Please try again.');
    }

    const provider = getOAuth2Provider(pendingState.providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth2 provider: ${pendingState.providerId}`);
    }

    // Build token request
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: appConfig.redirectUri,
      client_id: appConfig.clientId,
      client_secret: appConfig.clientSecret,
    });

    // Add PKCE code verifier if available
    if (pendingState.codeVerifier) {
      params.set('code_verifier', pendingState.codeVerifier);
    }

    this.logger.debug('Exchanging code for tokens', { providerId: pendingState.providerId });

    // Exchange code for tokens
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('Token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Parse tokens
    const tokens: OAuth2Tokens = {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      tokenType: (data.token_type as string) || 'Bearer',
      expiresIn: data.expires_in as number | undefined,
      scope: data.scope as string | undefined,
      raw: data,
    };

    // Remove used state
    pendingStates.delete(state);

    this.logger.info('OAuth2 tokens obtained', {
      providerId: pendingState.providerId,
      hasRefreshToken: !!tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });

    return { tokens, pendingState };
  }

  /**
   * Refresh an expired access token
   *
   * @param refreshToken - The refresh token
   * @param providerId - The OAuth2 provider ID
   * @param appConfig - OAuth app credentials
   * @returns New OAuth2 tokens
   */
  async refreshAccessToken(
    refreshToken: string,
    providerId: string,
    appConfig: OAuth2AppConfig,
  ): Promise<OAuth2Tokens> {
    const provider = getOAuth2Provider(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth2 provider: ${providerId}`);
    }

    if (!provider.supportsRefresh) {
      throw new Error(`Provider ${providerId} does not support token refresh`);
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appConfig.clientId,
      client_secret: appConfig.clientSecret,
    });

    this.logger.debug('Refreshing access token', { providerId });

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('Token refresh failed', { status: response.status, error: errorText });
      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    const tokens: OAuth2Tokens = {
      accessToken: data.access_token as string,
      // Some providers return a new refresh token
      refreshToken: (data.refresh_token as string | undefined) || refreshToken,
      tokenType: (data.token_type as string) || 'Bearer',
      expiresIn: data.expires_in as number | undefined,
      scope: data.scope as string | undefined,
      raw: data,
    };

    this.logger.info('Access token refreshed', {
      providerId,
      expiresIn: tokens.expiresIn,
    });

    return tokens;
  }

  /**
   * Build a CredentialConfig from OAuth2 tokens
   */
  buildCredentialConfig(
    tokens: OAuth2Tokens,
    providerId: string,
    appConfig: { clientId: string; clientSecret: string },
  ): CredentialConfig {
    const now = new Date();
    const expiresAt = tokens.expiresIn
      ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString()
      : undefined;

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
      expiresAt,
      // Store provider info for refresh
      oauth2Provider: providerId,
      clientId: appConfig.clientId,
      clientSecret: appConfig.clientSecret,
    };
  }

  /**
   * Check if a credential's access token is expired or about to expire
   *
   * @param config - The credential config
   * @param bufferSeconds - Buffer time before actual expiry (default 5 minutes)
   */
  isTokenExpired(config: CredentialConfig, bufferSeconds: number = 300): boolean {
    if (!config.expiresAt) {
      // No expiry recorded — if the credential has a refresh token, assume
      // expired so we proactively refresh (Google tokens expire in ~1 hour).
      // If no refresh token, assume still valid (can't refresh anyway).
      return !!config.refreshToken;
    }

    const expiresAt = new Date(config.expiresAt);
    const bufferMs = bufferSeconds * 1000;
    return expiresAt.getTime() - bufferMs < Date.now();
  }

  /**
   * Check if a credential can be refreshed
   */
  canRefresh(config: CredentialConfig): boolean {
    return !!(config.refreshToken && config.oauth2Provider);
  }
}

/**
 * Create OAuth2 service instance
 */
export function createOAuth2Service(logger: Logger): OAuth2Service {
  return new OAuth2Service(logger);
}
