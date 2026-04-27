/**
 * linkedin.get_company — Get LinkedIn company/organization info
 *
 * Retrieves information about a LinkedIn organization by its numeric ID.
 * Returns company name, description, website, industry, and other details.
 * Requires a LinkedIn OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINKEDIN_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINKEDIN_API = 'https://api.linkedin.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'LinkedIn credential is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export const linkedinGetCompanyAction = defineAction({
  id: 'linkedin.get_company',
  name: 'Get Company',
  description:
    'Get information about a LinkedIn company/organization by its numeric ID (GET /v2/organizations/{id}). Call with `organizationId`. Requires rw_organization_admin scope for full details; non-admin access returns limited fields.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 12345678, "name": "Acme Inc", "vanityName": "acme", "description": "Technology company", "website": "https://acme.com", "staffCountRange": {"start": 51, "end": 200}}\n' +
    '```',
  provider: LINKEDIN_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'linkedin',
    requiredScopes: ['rw_organization_admin'],
    description: 'LinkedIn OAuth2 credential with rw_organization_admin scope for full org details',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'LinkedIn Credential',
        type: 'text',
        required: true,
        description: 'LinkedIn OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'organizationId',
        label: 'Organization ID',
        type: 'text',
        required: true,
        placeholder: '12345678',
        description: 'Numeric LinkedIn organization/company ID',
        aiProvided: true,
      },
    ],
  },

  tags: ['linkedin', 'company', 'organization', 'get', 'oauth2'],

  async execute(params, context) {
    const { credentialId, organizationId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a LinkedIn OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the LinkedIn credential.',
      };
    }

    context.logger.debug('Getting LinkedIn company', { organizationId });

    try {
      const response = await fetch(
        `${LINKEDIN_API}/v2/organizations/${encodeURIComponent(organizationId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `LinkedIn API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const org = (await response.json()) as {
        id: number;
        localizedName: string;
        localizedDescription?: string;
        vanityName?: string;
        localizedWebsite?: string;
        logoV2?: { original: string };
        staffCountRange?: { start: number; end: number };
        industries?: string[];
      };

      return {
        success: true,
        output: {
          id: org.id,
          name: org.localizedName,
          description: org.localizedDescription ?? null,
          vanityName: org.vanityName ?? null,
          website: org.localizedWebsite ?? null,
          staffCountRange: org.staffCountRange ?? null,
          industries: org.industries ?? [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get LinkedIn company: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
