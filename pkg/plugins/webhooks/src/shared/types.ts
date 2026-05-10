/**
 * @flowlib/webhooks — Shared Types
 *
 * Serializable types shared between backend and frontend.
 * No runtime code, no React, no Node.js dependencies.
 */

// ─── Webhook Trigger ────────────────────────────────────────────────

export type WebhookProvider = 'github' | 'slack' | 'stripe' | 'linear' | 'generic';

export interface WebhookTrigger {
  id: string;
  name: string;
  description?: string;
  webhookPath: string;
  provider: WebhookProvider;
  isEnabled: boolean;
  allowedMethods: string;
  /** HMAC signature verification */
  hmacEnabled: boolean;
  hmacHeaderName?: string;
  hmacSecret?: string;
  /** IP whitelist (comma-separated IPs/CIDRs) */
  allowedIps?: string;
  flowId?: string;
  nodeId?: string;
  /** Remote provider webhook id, set when this trigger is registered upstream. */
  remoteWebhookId?: string;
  /** Credential used to register/manage the remote webhook. */
  remoteCredentialId?: string;
  /** Remote provider id (e.g., 'linear', 'github'). Matches a registered WebhookProviderAdapter. */
  remoteProvider?: string;
  /** Provider-specific scope used during registration (e.g., { teamId } | { owner, repo }). */
  remoteScope?: Record<string, unknown>;
  /** Event types subscribed at the provider. */
  remoteEvents?: string[];
  lastTriggeredAt?: string;
  lastPayload?: unknown;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookTriggerInput {
  name: string;
  description?: string;
  provider?: WebhookProvider;
  allowedMethods?: string;
  /** HMAC signature verification */
  hmacEnabled?: boolean;
  hmacHeaderName?: string;
  hmacSecret?: string;
  /** IP whitelist (comma-separated IPs/CIDRs) */
  allowedIps?: string;
  flowId?: string;
  nodeId?: string;
}

export interface UpdateWebhookTriggerInput {
  name?: string;
  description?: string;
  provider?: WebhookProvider;
  isEnabled?: boolean;
  allowedMethods?: string;
  /** HMAC signature verification. Pass `null` for the string fields to clear them. */
  hmacEnabled?: boolean;
  hmacHeaderName?: string | null;
  hmacSecret?: string | null;
  /** IP whitelist (comma-separated IPs/CIDRs) */
  allowedIps?: string | null;
  flowId?: string;
  nodeId?: string;
  /** Remote provider webhook fields. Pass `null` to clear. */
  remoteWebhookId?: string | null;
  remoteCredentialId?: string | null;
  remoteProvider?: string | null;
  remoteScope?: Record<string, unknown> | null;
  remoteEvents?: string[] | null;
}

// ─── Provider Webhook Registration ──────────────────────────────────

/**
 * Summary of a remote webhook as held by a third-party provider.
 * Returned from list/get/create/update/sync operations on a registered trigger.
 */
export interface RemoteWebhookSummary {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  /** Present only when the provider returns a signing secret on create. */
  secret: string | null;
  /** Full provider response, for power users. */
  raw: unknown;
}

export interface RegisterTriggerInput {
  providerId: string;
  credentialId: string;
  scope: Record<string, unknown>;
  events: string[];
  description?: string;
}

export interface UpdateRegistrationInput {
  events?: string[];
  enabled?: boolean;
}

/** Public summary of a provider adapter — surfaces enough metadata for the UI to render its panel. */
export interface WebhookProviderSummary {
  id: string;
  displayName: string;
  category: string;
  oauth2Provider?: string;
  acceptsApiKey?: boolean;
  requiredScopes?: string[];
  scopeFields: WebhookProviderScopeField[];
  /** Whether `events` is a static enum we already know, or a dynamic loader. */
  eventsKind: 'static' | 'dynamic';
  /** Populated when `eventsKind === 'static'`. */
  events?: WebhookProviderOption[];
}

export interface WebhookProviderScopeField {
  name: string;
  label: string;
  type: 'text' | 'select' | 'async-picker';
  required?: boolean;
  /** When type='async-picker', resolved by GET /webhooks/providers/:id/scope-options/:field */
  loader?: string;
  /** Static options for type='select'. */
  options?: WebhookProviderOption[];
}

export interface WebhookProviderOption {
  value: string;
  label: string;
}

export interface WebhookTriggerInfo {
  webhookPath: string;
  fullUrl?: string;
  provider: WebhookProvider;
  isEnabled: boolean;
  hmacEnabled: boolean;
  allowedIps?: string;
}

// ─── Webhook Event (for event log) ──────────────────────────────────

export interface WebhookEvent {
  id: string;
  webhookTriggerId: string;
  deliveryId?: string;
  eventType?: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  status: 'success' | 'failed' | 'skipped';
  flowRunId?: string;
  error?: string;
  receivedAt: string;
}
