/**
 * hubspot.create_deal — Create a new deal in HubSpot CRM
 *
 * Creates a deal record with the supplied properties (name, amount, stage, etc.).
 * Requires a HubSpot OAuth2 credential with crm.objects.deals.write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { HUBSPOT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const HUBSPOT_API = 'https://api.hubapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'HubSpot credential is required'),
  dealname: z.string().min(1, 'Deal name is required'),
  amount: z.string().optional().default(''),
  dealstage: z.string().optional().default(''),
  pipeline: z.string().optional().default(''),
  closedate: z.string().optional().default(''),
});

export const hubspotCreateDealAction = defineAction({
  id: 'hubspot.create_deal',
  name: 'Create Deal',
  description:
    'Create a new deal in HubSpot CRM (POST /crm/v3/objects/deals). Use when the user wants to track a new sales opportunity. Pass `dealname` (required), plus optional `amount`, `dealstage` (internal name, e.g. "appointmentscheduled"), `pipeline` (defaults to default pipeline), and `closedate` (ISO 8601).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "101", "properties": {"dealname": "New deal", "amount": "50000", "dealstage": "contractsent", "pipeline": "default"}, "createdAt": "2024-01-01T00:00:00.000Z", "updatedAt": "2024-01-01T00:00:00.000Z", "archived": false}\n' +
    '```',
  provider: HUBSPOT_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'hubspot',
    requiredScopes: ['crm.objects.deals.write'],
    description: 'HubSpot OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'HubSpot Credential',
        type: 'text',
        required: true,
        description: 'HubSpot OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'dealname',
        label: 'Deal Name',
        type: 'text',
        required: true,
        placeholder: 'New Enterprise Deal',
        description: 'Name of the deal (required)',
        aiProvided: true,
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'text',
        placeholder: '50000',
        description: 'Deal monetary amount',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'dealstage',
        label: 'Deal Stage',
        type: 'text',
        placeholder: 'appointmentscheduled',
        description: 'Deal stage internal name (e.g. appointmentscheduled, qualifiedtobuy)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'pipeline',
        label: 'Pipeline',
        type: 'text',
        placeholder: 'default',
        description: 'Pipeline internal name (defaults to the default pipeline if empty)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'closedate',
        label: 'Close Date',
        type: 'text',
        placeholder: '2026-12-31',
        description: 'Expected close date (ISO 8601 format)',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['hubspot', 'crm', 'deals', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, dealname, amount, dealstage, pipeline, closedate } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a HubSpot OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the HubSpot credential.',
      };
    }

    const properties: Record<string, string> = { dealname };
    if (amount) {
      properties.amount = amount;
    }
    if (dealstage) {
      properties.dealstage = dealstage;
    }
    if (pipeline) {
      properties.pipeline = pipeline;
    }
    if (closedate) {
      properties.closedate = closedate;
    }

    context.logger.debug('Creating HubSpot deal', { dealname });

    try {
      const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `HubSpot API error (${response.status}): ${errText}`,
        };
      }

      const data = await response.json();
      return { success: true, output: data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `HubSpot create deal failed: ${msg}` };
    }
  },
});
