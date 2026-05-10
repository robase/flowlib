/**
 * Provider Webhook Adapter — interface
 *
 * Each adapter encapsulates the CRUD surface a third-party provider exposes
 * for managing its webhooks. Adapters are pure functions over a credential
 * — no global state, no DB access. The plugin's `WebhookRegistrationService`
 * resolves the credential, dispatches to the adapter, and persists the
 * remote id back onto the local trigger row.
 *
 * Adding a new provider = drop a file in this folder implementing
 * `WebhookProviderAdapter`, then register it in `./index.ts`.
 */

import type { Credential } from '@flowlib/core';
import type { WebhookProviderOption, WebhookProviderScopeField } from '../../shared/types';

/** Normalised remote-webhook shape. Each adapter maps the provider's native response into this. */
export interface RemoteWebhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  /** Present only when the provider returns a signing secret on create. */
  secret: string | null;
  /** Full provider response, surfaced for power users / debugging. */
  raw: unknown;
}

export interface AdapterLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/** Common context passed into every adapter call. */
export interface WebhookProviderContext {
  /** Decrypted credential, with OAuth2 token already refreshed if applicable. */
  credential: Credential;
  /** Provider-specific scope (e.g., `{ teamId }` for Linear, `{ owner, repo }` for GitHub). */
  scope: Record<string, unknown>;
  /** Logger scoped to `webhooks.provider.<id>`. */
  logger: AdapterLogger;
}

export interface CreateRemoteWebhookInput extends WebhookProviderContext {
  /** Public ingestion URL the provider will POST to. */
  url: string;
  /** HMAC signing secret to register with the provider. Adapters that prefer
   *  the provider-generated secret should ignore this and surface the result. */
  secret: string;
  /** Event types to subscribe to (provider-native names). */
  events: string[];
  /** Optional human-readable label sent to providers that support it. */
  description?: string;
}

export interface UpdateRemoteWebhookInput extends WebhookProviderContext {
  remoteId: string;
  events?: string[];
  enabled?: boolean;
}

export interface WebhookProviderAdapter {
  /** Stable identifier — also the value of `webhook_triggers.remote_provider`. */
  id: string;
  displayName: string;
  category:
    | 'project_management'
    | 'development'
    | 'crm_sales'
    | 'payments'
    | 'support'
    | 'communication'
    | 'productivity'
    | 'storage'
    | 'marketing'
    | 'other';

  /** OAuth2 provider id this adapter consumes (matches `credential.config.oauth2Provider`). */
  oauth2Provider?: string;
  /** Whether this adapter accepts an api-key credential instead of/in addition to OAuth2. */
  acceptsApiKey?: boolean;
  /** Extra scopes required beyond the credential's default scope set. */
  requiredScopes?: string[];

  /** Fields the user must supply for scope (teamId, owner+repo, …). */
  scopeFields: WebhookProviderScopeField[];
  /** Loaders backing async-picker scope fields, keyed by `WebhookProviderScopeField.loader`. */
  scopeLoaders?: Record<string, (ctx: WebhookProviderContext) => Promise<WebhookProviderOption[]>>;
  /** Available event types — static enum or async loader. */
  events:
    | WebhookProviderOption[]
    | ((ctx: WebhookProviderContext) => Promise<WebhookProviderOption[]>);

  list(ctx: WebhookProviderContext): Promise<RemoteWebhook[]>;
  get(ctx: WebhookProviderContext, remoteId: string): Promise<RemoteWebhook>;
  create(input: CreateRemoteWebhookInput): Promise<RemoteWebhook>;
  update(input: UpdateRemoteWebhookInput): Promise<RemoteWebhook>;
  delete(ctx: WebhookProviderContext, remoteId: string): Promise<void>;
}
