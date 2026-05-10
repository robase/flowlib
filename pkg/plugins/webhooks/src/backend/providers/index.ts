/**
 * Webhook provider adapter registry.
 *
 * Built-in adapters live alongside this file. Hosts can register custom
 * adapters via `webhooks({ providers: [myAdapter] })` — `WebhookRegistrationService`
 * builds the runtime map by merging built-ins with the user-supplied list
 * (later entries with the same `id` win).
 */

import type { WebhookProviderAdapter } from './types';
import { linearWebhookAdapter } from './linear.adapter';

export const BUILTIN_WEBHOOK_PROVIDERS: WebhookProviderAdapter[] = [linearWebhookAdapter];

export function buildAdapterMap(
  custom: WebhookProviderAdapter[] = [],
): Map<string, WebhookProviderAdapter> {
  const map = new Map<string, WebhookProviderAdapter>();
  for (const adapter of [...BUILTIN_WEBHOOK_PROVIDERS, ...custom]) {
    map.set(adapter.id, adapter);
  }
  return map;
}

export type {
  WebhookProviderAdapter,
  WebhookProviderContext,
  CreateRemoteWebhookInput,
  UpdateRemoteWebhookInput,
  RemoteWebhook,
} from './types';
export { linearWebhookAdapter } from './linear.adapter';
