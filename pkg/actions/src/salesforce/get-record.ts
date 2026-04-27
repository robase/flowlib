/**
 * salesforce.get_record — Get a single Salesforce record by object type and ID
 *
 * Retrieves a single SObject record using the Salesforce REST API.
 * Requires a Salesforce OAuth2 credential with API access.
 */

import { defineAction } from '@flowlib/action-kit';
import { SALESFORCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Salesforce credential is required'),
  objectType: z.string().min(1, 'Object type is required'),
  recordId: z.string().min(1, 'Record ID is required'),
});

export const salesforceGetRecordAction = defineAction({
  id: 'salesforce.get_record',
  name: 'Get Record',
  description:
    'Retrieve a single Salesforce SObject record by ID (GET /sobjects/{objectType}/{recordId}). Use when the user wants to look up a specific Account, Contact, Lead, or Opportunity by its Salesforce ID.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"Id": "001xx000003DGbY", "Name": "Acme Corp", "Industry": "Technology", "attributes": {"type": "Account"}}\n' +
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
        name: 'objectType',
        label: 'Object Type',
        type: 'text',
        required: true,
        placeholder: 'Account',
        description: 'Salesforce object type (e.g. Account, Contact, Lead, Opportunity)',
        aiProvided: true,
      },
      {
        name: 'recordId',
        label: 'Record ID',
        type: 'text',
        required: true,
        placeholder: '001xx000003DGbYAAW',
        description: 'The 15 or 18 character Salesforce record ID',
        aiProvided: true,
      },
    ],
  },

  tags: ['salesforce', 'crm', 'record', 'read'],

  async execute(params, context) {
    const { credentialId, objectType, recordId } = params;

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
      const url = `${instanceUrl}/services/data/v59.0/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(recordId)}`;
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
