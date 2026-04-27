/**
 * salesforce.create_record — Create a new Salesforce record
 *
 * Creates a new SObject record using the Salesforce REST API.
 * Requires a Salesforce OAuth2 credential with API access.
 */

import { defineAction } from '@flowlib/action-kit';
import { SALESFORCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Salesforce credential is required'),
  objectType: z.string().min(1, 'Object type is required'),
  fields: z.string().min(1, 'Fields JSON is required'),
});

export const salesforceCreateRecordAction = defineAction({
  id: 'salesforce.create_record',
  name: 'Create Record',
  description:
    'Create a new Salesforce SObject record (POST /sobjects/{objectType}). Use when the user wants to create an Account, Contact, Lead, Opportunity, or any custom object in Salesforce.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "001xx000003DGbY", "success": true, "errors": []}\n' +
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
        name: 'fields',
        label: 'Fields (JSON)',
        type: 'code',
        required: true,
        placeholder: '{"Name": "Acme Corp", "Industry": "Technology"}',
        description: 'JSON object of field name-value pairs to set on the new record',
        aiProvided: true,
      },
    ],
  },

  tags: ['salesforce', 'crm', 'record', 'create', 'write'],

  async execute(params, context) {
    const { credentialId, objectType, fields } = params;

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
      const url = `${instanceUrl}/services/data/v59.0/sobjects/${encodeURIComponent(objectType)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsedFields),
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
