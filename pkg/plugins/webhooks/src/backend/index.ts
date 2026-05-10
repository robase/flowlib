/**
 * @flowlib/webhooks — Backend Entry Point
 */
export { webhooks } from './plugin';
export type { WebhooksPluginOptions } from './plugin';
export { WebhookSignatureService, WEBHOOK_PROVIDER_SIGNATURES } from './webhook-signature.service';
export type { WebhookProviderSignatureConfig } from './webhook-signature.service';
export { WebhookRateLimiter } from './webhook-rate-limiter';
export { WebhookDedupService } from './webhook-dedup.service';
export { webhookTriggerAction } from './webhook-trigger.action';

// Provider registration surface — adapters + service for hosts wiring custom providers.
export {
  WebhookRegistrationService,
  WebhookRegistrationError,
} from './webhook-registration.service';
export { BUILTIN_WEBHOOK_PROVIDERS, buildAdapterMap, linearWebhookAdapter } from './providers';
export type {
  WebhookProviderAdapter,
  WebhookProviderContext,
  CreateRemoteWebhookInput,
  UpdateRemoteWebhookInput,
  RemoteWebhook,
} from './providers/types';
