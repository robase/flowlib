/**
 * trigger.webhook — Webhook Trigger action
 *
 * Entry-point node for flows triggered by external HTTP webhook events
 * (GitHub, Slack, Stripe, Linear, etc.).
 *
 * At execution time, the orchestrator injects trigger data via
 * `flowInputs.__triggerData`. The action reads it and returns it as output
 * so downstream nodes can access the payload via template expressions like
 * `{{ webhook_trigger.body.pull_request.title }}`.
 *
 * The `webhookTriggerId` field is populated server-side from the
 * `flowlib_webhook_triggers` table via a closure set by the plugin during
 * `init()` (see `setWebhookTriggersListLoader`).
 */

import { defineAction, TRIGGERS_PROVIDER, type LoadOptionsResult } from '@flowlib/core';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  /** Configured webhook trigger this flow should listen on. */
  webhookTriggerId: z.string().optional(),
  /** HTTP method(s) to accept. Defaults to POST. */
  method: z.enum(['POST', 'GET', 'PUT', 'ANY']).default('POST'),
});

/**
 * Module-scoped loader for the configured-webhooks dropdown. The webhooks
 * plugin's `init()` installs this with a closure that reads from the
 * `flowlib_webhook_triggers` table; we keep it at module scope so the
 * static `defineAction()` call below can reference it.
 */
let listConfiguredWebhooks: (() => Promise<LoadOptionsResult>) | null = null;

export function setWebhookTriggersListLoader(loader: () => Promise<LoadOptionsResult>): void {
  listConfiguredWebhooks = loader;
}

async function loadWebhookTriggerOptions(): Promise<LoadOptionsResult> {
  if (!listConfiguredWebhooks) {
    return {
      options: [],
      placeholder: 'Webhooks plugin not initialized',
      disabled: true,
    };
  }
  return listConfiguredWebhooks();
}

export const webhookTriggerAction = defineAction({
  id: 'trigger.webhook',
  name: 'Webhook Trigger',
  description: 'Start this flow when an external webhook event is received on a configured webhook',
  provider: TRIGGERS_PROVIDER,
  noInput: true,
  tags: ['trigger', 'webhook', 'http', 'callback', 'endpoint', 'event', 'listen', 'incoming'],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'webhookTriggerId',
        label: 'Webhook',
        type: 'select',
        description: 'Select a configured webhook. Manage webhooks under the Webhooks page.',
        placeholder: 'Select a webhook',
        loadOptions: {
          dependsOn: [],
          handler: loadWebhookTriggerOptions,
        },
      },
      {
        name: 'method',
        label: 'HTTP Method',
        type: 'select',
        description: 'HTTP method(s) the webhook endpoint accepts',
        defaultValue: 'POST',
        options: [
          { label: 'POST', value: 'POST' },
          { label: 'GET', value: 'GET' },
          { label: 'PUT', value: 'PUT' },
          { label: 'Any', value: 'ANY' },
        ],
      },
    ],
  },

  async execute(params, context) {
    // triggerData is injected via flowInputs.__triggerData (a native object)
    const data = context.flowInputs?.__triggerData as Record<string, unknown> | undefined;
    if (!data) {
      // When run manually (testing / no triggerNodeId), return a placeholder
      const {
        __triggerData: _td,
        __triggerNodeId: _tn,
        ...cleanInputs
      } = (context.flowInputs ?? {}) as Record<string, unknown>;
      return {
        success: true,
        output: {
          body: cleanInputs,
          headers: {},
          event: 'manual_test',
          timestamp: new Date().toISOString(),
        },
        metadata: {
          triggerType: 'webhook',
          isTest: true,
          webhookTriggerId: params.webhookTriggerId,
        },
      };
    }
    return {
      success: true,
      output: data,
      metadata: { triggerType: 'webhook', webhookTriggerId: params.webhookTriggerId },
    };
  },
});
