/**
 * salesforce.list_objects — List available Salesforce SObject types
 *
 * Returns metadata about all SObject types available in the Salesforce org.
 * Requires a Salesforce OAuth2 credential with API access.
 */

import { defineAction } from '@flowlib/action-kit';
import { SALESFORCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Salesforce credential is required'),
});

export const salesforceListObjectsAction = defineAction({
  id: 'salesforce.list_objects',
  name: 'List Objects',
  description:
    'List all available SObject types in the Salesforce org (GET /sobjects). Use when the user wants to discover which objects (Account, Contact, Lead, custom objects, etc.) are available in their Salesforce instance.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"name": "Account", "label": "Account", "queryable": true, "createable": true, "urls": {}}]\n' +
    '```',
  provider: SALESFORCE_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'salesforce',
    requiredScopes: ['api'],
    description: 'Salesforce OAuth2 credential with API access',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Salesforce Credential',
        type: 'text',
        required: true,
        description: 'Salesforce OAuth2 credential for authentication',
        aiProvided: false,
      },
    ],
  },

  tags: ['salesforce', 'crm', 'sobject', 'metadata', 'read'],

  async execute(params, context) {
    const { credentialId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Salesforce OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize.',
      };
    }

    const instanceUrl = credential.config?.instanceUrl as string;
    if (!instanceUrl) {
      return {
        success: false,
        error: 'No instance URL found in credential. Please re-authorize.',
      };
    }

    try {
      const url = `${instanceUrl}/services/data/v59.0/sobjects`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `Salesforce API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as { sobjects?: unknown };
      return { success: true, output: data.sobjects ?? data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Salesforce request failed: ${msg}` };
    }
  },
});
