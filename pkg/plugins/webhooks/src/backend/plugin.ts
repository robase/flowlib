/**
 * @flowlib/webhooks — Backend Plugin
 *
 * Adds webhook trigger management, signature verification, rate limiting,
 * deduplication, and a management API. Works alongside the core trigger
 * system — the core flow_triggers table handles execution wiring, while
 * this plugin adds the management layer.
 */

import {
  createPluginDatabaseApi,
  type FlowlibPlugin,
  type FlowlibPluginDefinition,
  type FlowlibPluginEndpoint,
  type LoadOptionsResult,
  type PluginEndpointContext,
} from '@flowlib/core';
import type { FlowlibPluginSchema } from '@flowlib/db';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookRateLimiter } from './webhook-rate-limiter';
import { WebhookDedupService } from './webhook-dedup.service';
import { setWebhookTriggersListLoader, webhookTriggerAction } from './webhook-trigger.action';
import {
  WebhookTriggersRepository,
  type CreateWebhookTriggerRecord,
} from './webhook-triggers.repository';
import {
  WebhookRegistrationError,
  WebhookRegistrationService,
} from './webhook-registration.service';
import { buildAdapterMap } from './providers';
import type { WebhookProviderAdapter } from './providers/types';
import type {
  CreateWebhookTriggerInput,
  RegisterTriggerInput,
  UpdateRegistrationInput,
  UpdateWebhookTriggerInput,
} from '../shared/types';

// ─── Plugin Options ─────────────────────────────────────────────────

export interface WebhooksPluginOptions {
  /** Base URL for webhook endpoints (e.g. "https://example.com/api/flowlib") */
  webhookBaseUrl?: string;
  /** Rate limit: max requests per window. @default 60 */
  rateLimitMaxRequests?: number;
  /** Rate limit: window size in ms. @default 60000 */
  rateLimitWindowMs?: number;
  /** Dedup TTL in ms. @default 86400000 (24h) */
  dedupTtlMs?: number;

  /**
   * Custom webhook provider adapters. Merged with the built-in set
   * (`linear`, …); later entries with the same `id` override earlier ones.
   */
  providers?: WebhookProviderAdapter[];

  /**
   * Frontend plugin (sidebar, routes) for the webhooks UI.
   *
   * Import from `@flowlib/webhooks/ui` and pass here.
   * Omit for backend-only setups.
   */
  frontend?: unknown;
}

const WEBHOOK_TRIGGERS_SCHEMA: FlowlibPluginSchema = {
  webhook_triggers: {
    tableName: 'flowlib_webhook_triggers',
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      name: { type: 'string', required: true },
      description: { type: 'text', required: false },
      webhookPath: { type: 'string', required: true, unique: true },
      provider: { type: 'string', required: true, defaultValue: 'generic' },
      isEnabled: { type: 'boolean', required: true, defaultValue: true },
      allowedMethods: { type: 'string', required: true, defaultValue: 'POST' },
      hmacEnabled: { type: 'boolean', required: true, defaultValue: false },
      hmacHeaderName: { type: 'string', required: false },
      hmacSecret: { type: 'string', required: false },
      allowedIps: { type: 'text', required: false },
      flowId: {
        type: 'string',
        required: false,
        references: { table: 'flowlib_flows', field: 'id' },
      },
      nodeId: { type: 'string', required: false },
      // Remote provider webhook tracking — populated when a trigger is
      // registered with the upstream provider via WebhookRegistrationService.
      remoteWebhookId: { type: 'string', required: false },
      remoteCredentialId: {
        type: 'string',
        required: false,
        references: { table: 'flowlib_credentials', field: 'id', onDelete: 'set null' },
      },
      remoteProvider: { type: 'string', required: false },
      remoteScope: { type: 'json', required: false },
      remoteEvents: { type: 'json', required: false },
      lastTriggeredAt: { type: 'date', required: false },
      lastPayload: { type: 'json', required: false },
      triggerCount: { type: 'number', required: true, defaultValue: 0 },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

// ─── In-Memory Store (used before DB is available) ──────────────────

type PluginLogger = import('@flowlib/core').FlowlibPluginContext['logger'];

interface PluginState {
  signatureService: WebhookSignatureService;
  rateLimiter: WebhookRateLimiter;
  dedupService: WebhookDedupService;
  webhookBaseUrl?: string;
  /** Adapter map built once per plugin instance from built-in + user-provided providers. */
  adapters: Map<string, WebhookProviderAdapter>;
  /** Logger captured at init time (PluginEndpointContext doesn't carry one). */
  logger: PluginLogger;
}

function getRepository(ctx: PluginEndpointContext): WebhookTriggersRepository {
  return new WebhookTriggersRepository(ctx.database);
}

function getRegistration(
  ctx: PluginEndpointContext,
  state: PluginState,
): WebhookRegistrationService {
  return new WebhookRegistrationService({
    adapters: state.adapters,
    flowlib: ctx.getFlowlib(),
    repo: getRepository(ctx),
    webhookBaseUrl: state.webhookBaseUrl,
    logger: state.logger,
  });
}

function mapRegistrationError(
  err: unknown,
): { status: number; body: { error: string; code?: string; details?: unknown } } | null {
  if (err instanceof WebhookRegistrationError) {
    const status =
      err.code === 'TRIGGER_NOT_FOUND' || err.code === 'ADAPTER_NOT_FOUND'
        ? 404
        : err.code === 'ALREADY_REGISTERED' || err.code === 'NOT_REGISTERED'
          ? 409
          : err.code === 'CREDENTIAL_PROVIDER_MISMATCH'
            ? 400
            : err.code === 'MISSING_SCOPES'
              ? 403
              : 500;
    return { status, body: { error: err.message, code: err.code, details: err.details } };
  }
  return null;
}

function buildWebhookUrl(
  webhookBaseUrl: string | undefined,
  webhookPath: string,
): string | undefined {
  return webhookBaseUrl
    ? `${webhookBaseUrl.replace(/\/$/, '')}/plugins/webhooks/receive/${webhookPath}`
    : undefined;
}

/**
 * Parse the `scope` query parameter for endpoints that need it.
 *
 * Accepted shapes:
 *   - JSON-encoded object:  ?scope={"teamId":"abc"}
 *   - Repeated key=value:   ?scope=teamId:abc&scope=…  (skipped — single string only)
 *   - Omitted:              {}
 */
function parseScopeQuery(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ─── Helper: Generate random paths/secrets ──────────────────────────

function generateWebhookPath(): string {
  // Webhook paths are the only thing standing between an attacker and the
  // ability to fire payloads at a flow (HMAC verification is opt-in). Use
  // a CSPRNG so paths can't be predicted from observed siblings — Math.random
  // is xoroshiro128+ in V8 and its state is recoverable from a few samples.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let path = '';
  for (let i = 0; i < 24; i++) {
    path += chars[bytes[i] % chars.length];
  }
  return path;
}

// ─── Plugin Factory ─────────────────────────────────────────────────

export function webhooks(options?: WebhooksPluginOptions): FlowlibPluginDefinition {
  const { frontend, ...backendOptions } = options ?? {};
  return {
    id: 'webhooks',
    name: 'Webhooks',
    backend: _webhooksBackendPlugin(backendOptions),
    frontend,
  };
}

function _webhooksBackendPlugin(options?: Omit<WebhooksPluginOptions, 'frontend'>): FlowlibPlugin {
  let state: PluginState | null = null;

  // ── Endpoints ────────────────────────────────────────────────────

  function createEndpoints(): FlowlibPluginEndpoint[] {
    return [
      // List all webhook triggers
      {
        method: 'GET',
        path: '/webhooks/triggers',
        async handler(ctx: PluginEndpointContext) {
          const triggers = await getRepository(ctx).list();
          return { body: { data: triggers } };
        },
      },

      // Create webhook trigger
      {
        method: 'POST',
        path: '/webhooks/triggers',
        async handler(ctx: PluginEndpointContext) {
          const input = ctx.body as unknown as CreateWebhookTriggerInput;

          if (!input.name) {
            return { status: 400, body: { error: 'name is required' } };
          }

          const triggerInput: CreateWebhookTriggerRecord = {
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description,
            webhookPath: generateWebhookPath(),
            flowId: input.flowId,
            nodeId: input.nodeId,
            provider: input.provider ?? 'generic',
            allowedMethods: input.allowedMethods ?? 'POST',
            hmacEnabled: input.hmacEnabled ?? false,
            hmacHeaderName: input.hmacHeaderName,
            hmacSecret: input.hmacSecret,
            allowedIps: input.allowedIps,
          };

          const trigger = await getRepository(ctx).create(triggerInput);

          const fullUrl = buildWebhookUrl(state?.webhookBaseUrl, trigger.webhookPath);

          return {
            status: 201,
            body: { ...trigger, fullUrl },
          };
        },
      },

      // Get single webhook trigger
      {
        method: 'GET',
        path: '/webhooks/triggers/:id',
        async handler(ctx: PluginEndpointContext) {
          const trigger = await getRepository(ctx).findById(ctx.params.id);

          if (!trigger) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          const fullUrl = buildWebhookUrl(state?.webhookBaseUrl, trigger.webhookPath);

          return { body: { ...trigger, fullUrl } };
        },
      },

      // Update webhook trigger
      {
        method: 'PUT',
        path: '/webhooks/triggers/:id',
        async handler(ctx: PluginEndpointContext) {
          const input = ctx.body as UpdateWebhookTriggerInput;
          const updated = await getRepository(ctx).update(ctx.params.id, input);

          if (!updated) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          return { body: updated };
        },
      },

      // Delete webhook trigger — cascades to remote provider if registered
      {
        method: 'DELETE',
        path: '/webhooks/triggers/:id',
        async handler(ctx: PluginEndpointContext) {
          const repo = getRepository(ctx);
          const trigger = await repo.findById(ctx.params.id);
          if (!trigger) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          if (state && trigger.remoteWebhookId) {
            await getRegistration(ctx, state).cascadeOnDelete(trigger);
          }

          await repo.delete(ctx.params.id);

          return { body: { success: true } };
        },
      },

      // Webhook ingestion endpoint (public — no auth required)
      {
        method: 'POST',
        path: '/webhooks/receive/:webhookPath',
        isPublic: true,
        async handler(ctx: PluginEndpointContext) {
          const { webhookPath } = ctx.params;

          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }

          // Rate limiting
          const rateResult = state.rateLimiter.check(webhookPath);
          if (!rateResult.allowed) {
            return {
              status: 429,
              body: {
                error: `Rate limit exceeded. Retry after ${Math.ceil((rateResult.retryAfterMs ?? 1000) / 1000)}s`,
              },
            };
          }

          // Find the webhook trigger
          const trigger = await getRepository(ctx).findByWebhookPath(webhookPath);

          if (!trigger) {
            return { status: 404, body: { error: 'Webhook not found' } };
          }

          if (!trigger.isEnabled) {
            return { status: 403, body: { error: 'Webhook is disabled' } };
          }

          // Method check
          const method = ctx.headers['x-http-method']?.toUpperCase() || 'POST';
          if (trigger.allowedMethods !== 'ANY') {
            const allowed = trigger.allowedMethods.split(',').map((m) => m.trim().toUpperCase());
            if (!allowed.includes(method)) {
              return { status: 405, body: { error: `Method ${method} not allowed` } };
            }
          }

          // Signature verification
          if (trigger.provider !== 'generic') {
            const rawBody = typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body);
            const sigResult = await state.signatureService.verify(
              trigger.provider,
              trigger.hmacSecret ?? '',
              rawBody,
              ctx.headers as Record<string, string>,
            );
            if (!sigResult.valid) {
              return {
                status: 401,
                body: { error: `Signature verification failed: ${sigResult.error}` },
              };
            }
          } else if (trigger.hmacEnabled && trigger.hmacHeaderName && trigger.hmacSecret) {
            const rawBody = typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body);
            const sigResult = await state.signatureService.verifyCustomHmac(
              trigger.hmacSecret,
              trigger.hmacHeaderName,
              rawBody,
              ctx.headers as Record<string, string>,
            );
            if (!sigResult.valid) {
              return {
                status: 401,
                body: { error: `HMAC verification failed: ${sigResult.error}` },
              };
            }
          }

          // IP whitelist check
          if (trigger.allowedIps) {
            const clientIp =
              (ctx.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
              (ctx.headers['x-real-ip'] as string) ||
              '';
            const allowed = trigger.allowedIps
              .split(',')
              .map((ip) => ip.trim())
              .filter(Boolean);
            if (allowed.length > 0 && !allowed.includes(clientIp)) {
              return { status: 403, body: { error: 'IP address not allowed' } };
            }
          }

          // Dedup check
          const deliveryId = state.signatureService.getDeliveryId(
            trigger.provider,
            ctx.headers as Record<string, string>,
          );
          const existing = state.dedupService.check(webhookPath, deliveryId);
          if (existing) {
            return { body: { status: 'duplicate', flowRunIds: existing.flowRunIds } };
          }

          await getRepository(ctx).recordDelivery(trigger.id, ctx.body);

          // TODO: Execute the linked flow via core's trigger system
          // For now, return success with the received data
          const result = {
            status: 'received',
            webhookTriggerId: trigger.id,
            flowId: trigger.flowId,
            timestamp: new Date().toISOString(),
          };

          // Record in dedup
          if (deliveryId) {
            state.dedupService.record(webhookPath, deliveryId, []);
          }

          return { body: result };
        },
      },

      // Get webhook URL info for a trigger
      {
        method: 'GET',
        path: '/webhooks/triggers/:id/info',
        async handler(ctx: PluginEndpointContext) {
          const trigger = await getRepository(ctx).findById(ctx.params.id);

          if (!trigger) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          const fullUrl =
            buildWebhookUrl(state?.webhookBaseUrl, trigger.webhookPath) ??
            `/plugins/webhooks/receive/${trigger.webhookPath}`;

          return {
            body: {
              webhookPath: trigger.webhookPath,
              fullUrl,
              provider: trigger.provider,
              isEnabled: trigger.isEnabled,
              hmacEnabled: trigger.hmacEnabled,
              allowedIps: trigger.allowedIps,
            },
          };
        },
      },

      // Send a test payload to a webhook trigger
      {
        method: 'POST',
        path: '/webhooks/triggers/:id/test',
        async handler(ctx: PluginEndpointContext) {
          const trigger = await getRepository(ctx).findById(ctx.params.id);

          if (!trigger) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          const payload = ctx.body || { test: true, timestamp: new Date().toISOString() };
          await getRepository(ctx).recordDelivery(trigger.id, payload);

          return {
            body: {
              status: 'test_received',
              webhookTriggerId: trigger.id,
              payload,
            },
          };
        },
      },

      // ── Provider registration ────────────────────────────────────

      // List registered provider adapters
      {
        method: 'GET',
        path: '/webhooks/providers',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          return { body: { data: getRegistration(ctx, state).listProviders() } };
        },
      },

      // Get a single provider adapter's metadata
      {
        method: 'GET',
        path: '/webhooks/providers/:providerId',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          try {
            return { body: getRegistration(ctx, state).getProvider(ctx.params.providerId) };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // List event types available from a provider (static enum or dynamic loader)
      {
        method: 'GET',
        path: '/webhooks/providers/:providerId/events',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          const credentialId = ctx.query.credentialId;
          const scope = parseScopeQuery(ctx.query.scope);
          if (!credentialId) {
            return { status: 400, body: { error: 'credentialId query param is required' } };
          }
          try {
            const events = await getRegistration(ctx, state).listEvents(
              ctx.params.providerId,
              credentialId,
              scope,
            );
            return { body: { data: events } };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // Async-picker loader for a provider's scope field (e.g., Linear teams)
      {
        method: 'GET',
        path: '/webhooks/providers/:providerId/scope-options/:field',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          const credentialId = ctx.query.credentialId;
          const scope = parseScopeQuery(ctx.query.scope);
          if (!credentialId) {
            return { status: 400, body: { error: 'credentialId query param is required' } };
          }
          try {
            const options = await getRegistration(ctx, state).loadScopeOptions(
              ctx.params.providerId,
              ctx.params.field,
              credentialId,
              scope,
            );
            return { body: { data: options } };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // List remote webhooks the credential currently has at the provider
      {
        method: 'GET',
        path: '/webhooks/providers/:providerId/remote',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          const credentialId = ctx.query.credentialId;
          const scope = parseScopeQuery(ctx.query.scope);
          if (!credentialId) {
            return { status: 400, body: { error: 'credentialId query param is required' } };
          }
          try {
            const remote = await getRegistration(ctx, state).listRemote(
              ctx.params.providerId,
              credentialId,
              scope,
            );
            return { body: { data: remote } };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // Register a trigger with the upstream provider
      {
        method: 'POST',
        path: '/webhooks/triggers/:id/register',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          const input = ctx.body as unknown as RegisterTriggerInput | undefined;
          if (!input || !input.providerId || !input.credentialId || !Array.isArray(input.events)) {
            return {
              status: 400,
              body: {
                error:
                  'Body must include providerId (string), credentialId (string), events (string[]), and scope (object)',
              },
            };
          }
          try {
            const result = await getRegistration(ctx, state).register(ctx.params.id, {
              providerId: input.providerId,
              credentialId: input.credentialId,
              scope: input.scope ?? {},
              events: input.events,
              description: input.description,
            });
            return { status: 201, body: result };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // Update a registered trigger's events / enabled state at the provider
      {
        method: 'PATCH',
        path: '/webhooks/triggers/:id/register',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          const input = ctx.body as unknown as UpdateRegistrationInput | undefined;
          try {
            const result = await getRegistration(ctx, state).updateRegistration(
              ctx.params.id,
              input ?? {},
            );
            return { body: result };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // Unregister: delete the remote webhook but keep the local trigger
      {
        method: 'DELETE',
        path: '/webhooks/triggers/:id/register',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          try {
            const trigger = await getRegistration(ctx, state).unregister(ctx.params.id);
            return { body: { trigger } };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },

      // Pull the remote webhook state and reconcile with the local row
      {
        method: 'POST',
        path: '/webhooks/triggers/:id/sync',
        async handler(ctx: PluginEndpointContext) {
          if (!state) {
            return { status: 503, body: { error: 'Plugin not initialized' } };
          }
          try {
            const result = await getRegistration(ctx, state).sync(ctx.params.id);
            return { body: result };
          } catch (err) {
            return mapRegistrationError(err) ?? { status: 500, body: { error: String(err) } };
          }
        },
      },
    ];
  }

  // ── Plugin Definition ────────────────────────────────────────────

  return {
    id: 'webhooks',
    name: 'Webhooks',
    schema: WEBHOOK_TRIGGERS_SCHEMA,

    async init(ctx) {
      const logger = ctx.logger;

      state = {
        signatureService: new WebhookSignatureService(logger),
        rateLimiter: new WebhookRateLimiter({
          maxRequests: options?.rateLimitMaxRequests ?? 60,
          windowMs: options?.rateLimitWindowMs ?? 60_000,
        }),
        dedupService: new WebhookDedupService({
          ttlMs: options?.dedupTtlMs ?? 24 * 60 * 60 * 1000,
        }),
        webhookBaseUrl: options?.webhookBaseUrl,
        adapters: buildAdapterMap(options?.providers ?? []),
        logger,
      };

      // Power the trigger.webhook node's "Webhook" dropdown. Resolved lazily
      // at loader-call time so the host's `getFlowlib()` is fully ready.
      setWebhookTriggersListLoader(async (): Promise<LoadOptionsResult> => {
        try {
          const flowlib = ctx.getFlowlib();
          const conn = flowlib.plugins.getDatabaseConnection();
          const dbApi = createPluginDatabaseApi(conn);
          const repo = new WebhookTriggersRepository(dbApi);
          const triggers = await repo.list();
          if (triggers.length === 0) {
            return {
              options: [],
              placeholder: 'No webhooks configured. Create one on the Webhooks page.',
            };
          }
          return {
            options: triggers.map((t) => ({ label: t.name, value: t.id })),
            placeholder: 'Select a webhook',
          };
        } catch (error) {
          logger.error('Failed to load webhook triggers for trigger.webhook node', error);
          return {
            options: [],
            placeholder: 'Failed to load webhooks',
            disabled: true,
          };
        }
      });

      logger.info('Webhooks plugin initialized');
    },

    endpoints: createEndpoints(),

    actions: [webhookTriggerAction],

    async shutdown() {
      if (state) {
        state.rateLimiter.dispose();
        state.dedupService.dispose();
        state = null;
      }
    },

    setupInstructions:
      'Run `npx flowlib-cli generate` to generate the flowlib_webhook_triggers table schema, then `npx flowlib-cli migrate` to apply it.',
  };
}
