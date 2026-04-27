/**
 * google_analytics.list_properties — List GA4 account summaries
 *
 * Lists all Google Analytics 4 account summaries visible to the authenticated user.
 * Returns accounts with their associated properties.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_ANALYTICS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GA_ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Analytics credential is required'),
});

export const googleAnalyticsListPropertiesAction = defineAction({
  id: 'google_analytics.list_properties',
  name: 'List Properties',
  description:
    'List GA4 account summaries with their properties (accountSummaries.list). Use when the user wants to discover available Analytics properties or find a property ID.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"accountSummaries": [{"displayName": "My Account", "propertySummaries": [{"property": "properties/123456", "displayName": "My Site"}]}], "accountCount": 1}\n' +
    '```',
  provider: GOOGLE_ANALYTICS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    description: 'Google OAuth2 credential with Analytics read-only scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Credential',
        type: 'text',
        required: true,
        description: 'Google OAuth2 credential with Analytics read-only scope',
        aiProvided: false,
      },
    ],
  },

  tags: ['google', 'analytics', 'ga4', 'properties', 'accounts', 'oauth2'],

  async execute(params, context) {
    const { credentialId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Listing GA4 account summaries');

    try {
      const url = `${GA_ADMIN_API}/accountSummaries`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GA4 Admin API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        accountSummaries?: Array<{
          name?: string;
          account?: string;
          displayName?: string;
          propertySummaries?: Array<{
            property?: string;
            displayName?: string;
            propertyType?: string;
          }>;
        }>;
      };

      const summaries = data.accountSummaries ?? [];

      return {
        success: true,
        output: {
          accountSummaries: summaries,
          accountCount: summaries.length,
          propertyCount: summaries.reduce((sum, a) => sum + (a.propertySummaries?.length ?? 0), 0),
        },
        metadata: { accountCount: summaries.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GA4 list properties failed: ${msg}` };
    }
  },
});
