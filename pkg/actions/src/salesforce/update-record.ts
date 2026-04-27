/**
 * salesforce.update_record — Update an existing Salesforce record
 *
 * Updates fields on an existing SObject record using the Salesforce REST API.
 * Requires a Salesforce OAuth2 credential with API access.
 */

import { defineAction } from '@flowlib/action-kit';
import { SALESFORCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Salesforce credential is required'),
  objectType: z.string().min(1, 'Object type is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fields: z.string().min(1, 'Fields JSON is required'),
});

export const salesforceUpdateRecordAction = defineAction({
  id: 'salesforce.update_record',
  name: 'Update Record',
  description:
    'Update an existing Salesforce SObject record (PATCH /sobjects/{objectType}/{recordId}). Use when the user wants to modify fields on an Account, Contact, Lead, or Opportunity. Salesforce returns 204 No Content on success; this action returns a synthetic confirmation.\n\n' +
    'Example response (synthetic):\n' +
    '```json\n' +
    '{"id": "001xx000003DGbY", "updated": true}\n' +
    '```',
  provider: SALESFORCE_PROVIDER,
  actionCategory: 'write',

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
      {
        name: 'fields',
        label: 'Fields (JSON)',
        type: 'code',
        required: true,
        placeholder: '{"Industry": "Finance", "Rating": "Hot"}',
        description: 'JSON object of field name-value pairs to update on the record',
        aiProvided: true,
      },
    ],
  },

  tags: ['salesforce', 'crm', 'record', 'update', 'write'],

  async execute(params, context) {
    const { credentialId, objectType, recordId, fields } = params;

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

    let parsedFields: Record<string, unknown>;
    try {
      parsedFields = typeof fields === 'string' ? JSON.parse(fields) : fields;
    } catch {
      return { success: false, error: 'Invalid JSON in fields parameter' };
    }

    try {
      const url = `${instanceUrl}/services/data/v59.0/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(recordId)}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsedFields),
      });

      // Salesforce PATCH returns 204 No Content on success
      if (response.status === 204) {
        return { success: true, output: { id: recordId, updated: true } };
      }

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
