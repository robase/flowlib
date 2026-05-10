/**
 * WebhookRegistrationService
 *
 * Orchestrates the full register/update/unregister/sync lifecycle for a
 * webhook trigger that's wired to a third-party provider (Linear, GitHub, …).
 *
 * Flow:
 *   1. Resolve the credential via `flowlib.credentials.getDecryptedWithRefresh`
 *      so OAuth2 tokens are auto-refreshed.
 *   2. Match the credential against the adapter (oauth2Provider / acceptsApiKey)
 *      and assert all `requiredScopes` are granted.
 *   3. Call the adapter; persist the returned remote id + secret onto the
 *      local trigger row.
 *
 * Throws typed errors with stable `code` properties so plugin endpoints
 * can map them to HTTP status codes:
 *   - `ADAPTER_NOT_FOUND`            → 404
 *   - `TRIGGER_NOT_FOUND`            → 404
 *   - `ALREADY_REGISTERED`           → 409
 *   - `NOT_REGISTERED`               → 409
 *   - `WEBHOOK_BASE_URL_MISSING`     → 500 (server misconfig)
 *   - `CREDENTIAL_PROVIDER_MISMATCH` → 400
 *   - `MISSING_SCOPES`               → 403 (UI surfaces a "Re-authorize" prompt)
 */

import type { Credential, FlowlibInstance } from '@flowlib/core';
import type {
  RegisterTriggerInput,
  RemoteWebhookSummary,
  UpdateRegistrationInput,
  WebhookProviderOption,
  WebhookProviderSummary,
  WebhookTrigger,
} from '../shared/types';
import type { WebhookTriggersRepository } from './webhook-triggers.repository';
import type { AdapterLogger, RemoteWebhook, WebhookProviderAdapter } from './providers/types';

export class WebhookRegistrationError extends Error {
  constructor(
    public readonly code:
      | 'ADAPTER_NOT_FOUND'
      | 'TRIGGER_NOT_FOUND'
      | 'ALREADY_REGISTERED'
      | 'NOT_REGISTERED'
      | 'WEBHOOK_BASE_URL_MISSING'
      | 'CREDENTIAL_PROVIDER_MISMATCH'
      | 'MISSING_SCOPES',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WebhookRegistrationError';
  }
}

interface ServiceDeps {
  adapters: Map<string, WebhookProviderAdapter>;
  flowlib: FlowlibInstance;
  repo: WebhookTriggersRepository;
  webhookBaseUrl?: string;
  logger: AdapterLogger;
}

/** Generate a 32-byte HMAC secret as hex (good for any HMAC-SHA256 use). */
function generateHmacSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildWebhookUrl(base: string | undefined, path: string): string | undefined {
  return base ? `${base.replace(/\/$/, '')}/plugins/webhooks/receive/${path}` : undefined;
}

/** Parse the credential's space-separated `scope` claim into a set. */
function getGrantedScopes(credential: Credential): Set<string> {
  const raw = credential.config?.scope;
  if (typeof raw !== 'string') {
    return new Set();
  }
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

export class WebhookRegistrationService {
  private readonly adapters: Map<string, WebhookProviderAdapter>;
  private readonly flowlib: FlowlibInstance;
  private readonly repo: WebhookTriggersRepository;
  private readonly webhookBaseUrl?: string;
  private readonly logger: AdapterLogger;

  constructor(deps: ServiceDeps) {
    this.adapters = deps.adapters;
    this.flowlib = deps.flowlib;
    this.repo = deps.repo;
    this.webhookBaseUrl = deps.webhookBaseUrl;
    this.logger = deps.logger;
  }

  // ─── Discovery ────────────────────────────────────────────────────

  listProviders(): WebhookProviderSummary[] {
    return Array.from(this.adapters.values()).map((a) => this.summarize(a));
  }

  getProvider(providerId: string): WebhookProviderSummary {
    const adapter = this.requireAdapter(providerId);
    return this.summarize(adapter);
  }

  async loadScopeOptions(
    providerId: string,
    field: string,
    credentialId: string,
    scope: Record<string, unknown>,
  ): Promise<WebhookProviderOption[]> {
    const adapter = this.requireAdapter(providerId);
    const loader = adapter.scopeLoaders?.[field];
    if (!loader) {
      throw new WebhookRegistrationError(
        'ADAPTER_NOT_FOUND',
        `Provider '${providerId}' has no async-picker loader for field '${field}'`,
      );
    }
    const credential = await this.resolveCredential(credentialId, adapter);
    return loader({ credential, scope, logger: this.scopedLogger(providerId) });
  }

  async listEvents(
    providerId: string,
    credentialId: string,
    scope: Record<string, unknown>,
  ): Promise<WebhookProviderOption[]> {
    const adapter = this.requireAdapter(providerId);
    if (Array.isArray(adapter.events)) {
      return adapter.events;
    }
    const credential = await this.resolveCredential(credentialId, adapter);
    return adapter.events({ credential, scope, logger: this.scopedLogger(providerId) });
  }

  async listRemote(
    providerId: string,
    credentialId: string,
    scope: Record<string, unknown>,
  ): Promise<RemoteWebhookSummary[]> {
    const adapter = this.requireAdapter(providerId);
    const credential = await this.resolveCredential(credentialId, adapter);
    const remote = await adapter.list({
      credential,
      scope,
      logger: this.scopedLogger(providerId),
    });
    return remote.map(toSummary);
  }

  // ─── Registration ────────────────────────────────────────────────

  async register(
    triggerId: string,
    input: RegisterTriggerInput,
  ): Promise<{ trigger: WebhookTrigger; remote: RemoteWebhookSummary }> {
    const trigger = await this.requireTrigger(triggerId);
    if (trigger.remoteWebhookId) {
      throw new WebhookRegistrationError(
        'ALREADY_REGISTERED',
        `Trigger ${triggerId} is already registered with provider '${trigger.remoteProvider}' (remote id ${trigger.remoteWebhookId})`,
      );
    }

    const adapter = this.requireAdapter(input.providerId);
    const credential = await this.resolveCredential(input.credentialId, adapter);

    const url = buildWebhookUrl(this.webhookBaseUrl, trigger.webhookPath);
    if (!url) {
      throw new WebhookRegistrationError(
        'WEBHOOK_BASE_URL_MISSING',
        'webhookBaseUrl is not configured. Set `webhookBaseUrl` in the webhooks() plugin options.',
      );
    }

    const secret = generateHmacSecret();
    const remote = await adapter.create({
      credential,
      scope: input.scope,
      logger: this.scopedLogger(adapter.id),
      url,
      secret,
      events: input.events,
      description: input.description,
    });

    const updated = await this.repo.update(triggerId, {
      provider: adapter.id as WebhookTrigger['provider'],
      hmacEnabled: true,
      // Provider may echo back its own secret (e.g., when one was already set)
      // — prefer that over our generated one.
      hmacSecret: remote.secret ?? secret,
      remoteWebhookId: remote.id,
      remoteCredentialId: input.credentialId,
      remoteProvider: adapter.id,
      remoteScope: input.scope,
      remoteEvents: remote.events,
    });

    this.logger.info('Webhook trigger registered with provider', {
      triggerId,
      provider: adapter.id,
      remoteId: remote.id,
    });

    return { trigger: updated ?? trigger, remote: toSummary(remote) };
  }

  async updateRegistration(
    triggerId: string,
    input: UpdateRegistrationInput,
  ): Promise<{ trigger: WebhookTrigger; remote: RemoteWebhookSummary }> {
    const trigger = await this.requireTrigger(triggerId);
    const { adapter, credential, remoteWebhookId } = await this.requireRegistered(trigger);

    const remote = await adapter.update({
      credential,
      scope: trigger.remoteScope ?? {},
      logger: this.scopedLogger(adapter.id),
      remoteId: remoteWebhookId,
      events: input.events,
      enabled: input.enabled,
    });

    const updates: Parameters<WebhookTriggersRepository['update']>[1] = {};
    if (input.events !== undefined) {
      updates.remoteEvents = remote.events;
    }
    if (input.enabled !== undefined) {
      updates.isEnabled = remote.enabled;
    }

    const updated = Object.keys(updates).length
      ? ((await this.repo.update(triggerId, updates)) ?? trigger)
      : trigger;

    return { trigger: updated, remote: toSummary(remote) };
  }

  async unregister(triggerId: string): Promise<WebhookTrigger> {
    const trigger = await this.requireTrigger(triggerId);
    const { adapter, credential, remoteWebhookId } = await this.requireRegistered(trigger);

    try {
      await adapter.delete(
        { credential, scope: trigger.remoteScope ?? {}, logger: this.scopedLogger(adapter.id) },
        remoteWebhookId,
      );
    } catch (err) {
      // Don't leave the trigger in a half-registered state if the remote
      // is already gone — log and proceed to clear local state.
      this.logger.warn('Adapter delete failed; clearing local state anyway', {
        triggerId,
        provider: adapter.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Reset both the remote-tracking columns AND the inbound verification
    // state. Otherwise straggler deliveries to the same webhookPath would
    // try to verify against a Linear-style signature using a secret the
    // remote no longer holds, causing 401s on what should now be treated
    // as a generic webhook.
    const updated = await this.repo.update(triggerId, {
      provider: 'generic',
      hmacEnabled: false,
      hmacSecret: null,
      hmacHeaderName: null,
      remoteWebhookId: null,
      remoteCredentialId: null,
      remoteProvider: null,
      remoteScope: null,
      remoteEvents: null,
    });
    return updated ?? trigger;
  }

  async sync(
    triggerId: string,
  ): Promise<{ trigger: WebhookTrigger; remote: RemoteWebhookSummary }> {
    const trigger = await this.requireTrigger(triggerId);
    const { adapter, credential, remoteWebhookId } = await this.requireRegistered(trigger);

    const remote = await adapter.get(
      { credential, scope: trigger.remoteScope ?? {}, logger: this.scopedLogger(adapter.id) },
      remoteWebhookId,
    );

    const updated =
      (await this.repo.update(triggerId, {
        isEnabled: remote.enabled,
        remoteEvents: remote.events,
      })) ?? trigger;

    return { trigger: updated, remote: toSummary(remote) };
  }

  /**
   * Hook used by the trigger CRUD `DELETE /webhooks/triggers/:id` path:
   * if the trigger has a remote registration, tear it down at the provider
   * before the row is removed. Best-effort — failures are logged so they
   * don't block deletion of the local row.
   */
  async cascadeOnDelete(trigger: WebhookTrigger): Promise<void> {
    if (!trigger.remoteWebhookId || !trigger.remoteProvider || !trigger.remoteCredentialId) {
      return;
    }
    const adapter = this.adapters.get(trigger.remoteProvider);
    if (!adapter) {
      this.logger.warn('Cannot cascade webhook delete: adapter not registered', {
        triggerId: trigger.id,
        remoteProvider: trigger.remoteProvider,
      });
      return;
    }
    try {
      const credential = await this.resolveCredential(trigger.remoteCredentialId, adapter);
      await adapter.delete(
        { credential, scope: trigger.remoteScope ?? {}, logger: this.scopedLogger(adapter.id) },
        trigger.remoteWebhookId,
      );
    } catch (err) {
      this.logger.warn('cascadeOnDelete: remote delete failed', {
        triggerId: trigger.id,
        provider: adapter.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private requireAdapter(providerId: string): WebhookProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new WebhookRegistrationError(
        'ADAPTER_NOT_FOUND',
        `No webhook provider adapter registered for '${providerId}'. Available: ${Array.from(this.adapters.keys()).join(', ') || '<none>'}`,
      );
    }
    return adapter;
  }

  private async requireTrigger(triggerId: string): Promise<WebhookTrigger> {
    const trigger = await this.repo.findById(triggerId);
    if (!trigger) {
      throw new WebhookRegistrationError(
        'TRIGGER_NOT_FOUND',
        `Webhook trigger ${triggerId} not found`,
      );
    }
    return trigger;
  }

  private async requireRegistered(trigger: WebhookTrigger): Promise<{
    adapter: WebhookProviderAdapter;
    credential: Credential;
    remoteWebhookId: string;
  }> {
    if (!trigger.remoteWebhookId || !trigger.remoteProvider || !trigger.remoteCredentialId) {
      throw new WebhookRegistrationError(
        'NOT_REGISTERED',
        `Trigger ${trigger.id} is not registered with any provider`,
      );
    }
    const adapter = this.requireAdapter(trigger.remoteProvider);
    const credential = await this.resolveCredential(trigger.remoteCredentialId, adapter);
    return { adapter, credential, remoteWebhookId: trigger.remoteWebhookId };
  }

  private async resolveCredential(
    credentialId: string,
    adapter: WebhookProviderAdapter,
  ): Promise<Credential> {
    const credential = await this.flowlib.credentials.getDecryptedWithRefresh(credentialId);
    this.assertCredentialMatches(credential, adapter);
    this.assertScopes(credential, adapter);
    return credential;
  }

  private assertCredentialMatches(credential: Credential, adapter: WebhookProviderAdapter): void {
    const credProvider =
      (credential.config?.oauth2Provider as string | undefined) ??
      (credential.metadata?.oauth2Provider as string | undefined);

    if (adapter.oauth2Provider) {
      if (credential.authType === 'oauth2' && credProvider === adapter.oauth2Provider) {
        return;
      }
      if (adapter.acceptsApiKey && credential.authType !== 'oauth2') {
        return;
      }
      throw new WebhookRegistrationError(
        'CREDENTIAL_PROVIDER_MISMATCH',
        `Credential is for provider '${credProvider ?? credential.authType}', but adapter '${adapter.id}' expects '${adapter.oauth2Provider}'`,
        { expected: adapter.oauth2Provider, actual: credProvider },
      );
    }
    // No oauth2Provider set on adapter — only api-key path is supported.
    if (adapter.acceptsApiKey) {
      return;
    }
    throw new WebhookRegistrationError(
      'CREDENTIAL_PROVIDER_MISMATCH',
      `Adapter '${adapter.id}' has no credential matching strategy configured`,
    );
  }

  private assertScopes(credential: Credential, adapter: WebhookProviderAdapter): void {
    if (!adapter.requiredScopes?.length) {
      return;
    }
    if (credential.authType !== 'oauth2') {
      return; // API-key credentials don't have scope claims
    }
    const granted = getGrantedScopes(credential);
    const missing = adapter.requiredScopes.filter((s) => !granted.has(s));
    if (missing.length) {
      throw new WebhookRegistrationError(
        'MISSING_SCOPES',
        `Credential is missing required scopes for provider '${adapter.id}': ${missing.join(', ')}. Re-authorize the credential to grant them.`,
        { missing, required: adapter.requiredScopes },
      );
    }
  }

  private summarize(adapter: WebhookProviderAdapter): WebhookProviderSummary {
    const eventsKind: 'static' | 'dynamic' = Array.isArray(adapter.events) ? 'static' : 'dynamic';
    return {
      id: adapter.id,
      displayName: adapter.displayName,
      category: adapter.category,
      oauth2Provider: adapter.oauth2Provider,
      acceptsApiKey: adapter.acceptsApiKey,
      requiredScopes: adapter.requiredScopes,
      scopeFields: adapter.scopeFields,
      eventsKind,
      events: eventsKind === 'static' ? (adapter.events as WebhookProviderOption[]) : undefined,
    };
  }

  private scopedLogger(providerId: string): AdapterLogger {
    const prefix = `webhooks.provider.${providerId}`;
    const wrap = (level: 'debug' | 'info' | 'warn' | 'error') => (msg: string, meta?: unknown) =>
      this.logger[level](`[${prefix}] ${msg}`, meta);
    return {
      debug: wrap('debug'),
      info: wrap('info'),
      warn: wrap('warn'),
      error: wrap('error'),
    };
  }
}

function toSummary(remote: RemoteWebhook): RemoteWebhookSummary {
  return {
    id: remote.id,
    url: remote.url,
    events: remote.events,
    enabled: remote.enabled,
    secret: remote.secret,
    raw: remote.raw,
  };
}
