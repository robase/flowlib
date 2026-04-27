/**
 * @flowlib/webhooks — Backend Plugin
 *
 * Adds webhook trigger management, signature verification, rate limiting,
 * deduplication, and a management API. Works alongside the core trigger
 * system — the core flow_triggers table handles execution wiring, while
 * this plugin adds the management layer.
 */

import type {
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginSchema,
  FlowlibPluginEndpoint,
  PluginEndpointContext,
} from '@flowlib/core';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookRateLimiter } from './webhook-rate-limiter';
import { WebhookDedupService } from './webhook-dedup.service';
import { webhookTriggerAction } from './webhook-trigger.action';
import {
  WebhookTriggersRepository,
  type CreateWebhookTriggerRecord,
} from './webhook-triggers.repository';
import type { CreateWebhookTriggerInput, UpdateWebhookTriggerInput } from '../shared/types';

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
      lastTriggeredAt: { type: 'date', required: false },
      lastPayload: { type: 'json', required: false },
      triggerCount: { type: 'number', required: true, defaultValue: 0 },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

// ─── In-Memory Store (used before DB is available) ──────────────────

interface PluginState {
  signatureService: WebhookSignatureService;
  rateLimiter: WebhookRateLimiter;
  dedupService: WebhookDedupService;
  webhookBaseUrl?: string;
  /** Reference to the Flowlib core instance stored during init */
  coreInstance?: unknown;
}

function getRepository(ctx: PluginEndpointContext): WebhookTriggersRepository {
  return new WebhookTriggersRepository(ctx.database);
}

function buildWebhookUrl(
  webhookBaseUrl: string | undefined,
  webhookPath: string,
): string | undefined {
  return webhookBaseUrl
    ? `${webhookBaseUrl.replace(/\/$/, '')}/plugins/webhooks/receive/${webhookPath}`
    : undefined;
}

// ─── Helper: Generate random paths/secrets ──────────────────────────

function generateWebhookPath(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let path = '';
  for (let i = 0; i < 24; i++) {
    path += chars[Math.floor(Math.random() * chars.length)];
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

      // Delete webhook trigger
      {
        method: 'DELETE',
        path: '/webhooks/triggers/:id',
        async handler(ctx: PluginEndpointContext) {
          const trigger = await getRepository(ctx).findById(ctx.params.id);
          if (!trigger) {
            return { status: 404, body: { error: 'Webhook trigger not found' } };
          }

          await getRepository(ctx).delete(ctx.params.id);

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
      };

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
