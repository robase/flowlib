/**
 * salesforce.query — Execute a SOQL query against Salesforce
 *
 * Runs a Salesforce Object Query Language (SOQL) query and returns matching records.
 * Requires a Salesforce OAuth2 credential with API access.
 */

import { defineAction } from '@flowlib/action-kit';
import { SALESFORCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Salesforce credential is required'),
  query: z.string().min(1, 'SOQL query is required'),
});

export const salesforceQueryAction = defineAction({
  id: 'salesforce.query',
  name: 'SOQL Query',
  description:
    'Execute a SOQL query against Salesforce (GET /query?q=...). Use when the user wants to search, filter, or retrieve records using Salesforce Object Query Language.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"totalSize": 2, "done": true, "records": [{"Id": "001xx...", "Name": "Acme Corp", "attributes": {"type": "Account"}}]}\n' +
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
      {
        name: 'query',
        label: 'SOQL Query',
        type: 'textarea',
        required: true,
        placeholder: 'SELECT Id, Name FROM Account LIMIT 10',
        description: 'Salesforce Object Query Language (SOQL) query string',
        aiProvided: true,
      },
    ],
  },

  tags: ['salesforce', 'crm', 'soql', 'query', 'read'],

  async execute(params, context) {
    const { credentialId, query } = params;

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
      const url = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
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

      const data = await response.json();
      return { success: true, output: data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Salesforce request failed: ${msg}` };
    }
  },
});
