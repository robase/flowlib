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
 */

import { defineAction, TRIGGERS_PROVIDER } from '@flowlib/core';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  /** Credential whose webhook URL will trigger this flow. */
  credentialId: z.string().optional(),
  /** HTTP method(s) to accept. Defaults to POST. */
  method: z.enum(['POST', 'GET', 'PUT', 'ANY']).default('POST'),
});

export const webhookTriggerAction = defineAction({
  id: 'trigger.webhook',
  name: 'Webhook Trigger',
  description:
    'Start this flow when an external webhook event is received on a credential webhook URL',
  provider: TRIGGERS_PROVIDER,
  noInput: true,
  tags: ['trigger', 'webhook', 'http', 'callback', 'endpoint', 'event', 'listen', 'incoming'],

  credential: {
    required: false,
    description:
      'Select the credential (e.g. GitHub App, Slack App) whose webhook URL should trigger this flow',
  },

  params: {
    schema: paramsSchema,
    fields: [
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
        metadata: { triggerType: 'webhook', isTest: true },
      };
    }
    return {
      success: true,
      output: data,
      metadata: { triggerType: 'webhook' },
    };
  },
});
