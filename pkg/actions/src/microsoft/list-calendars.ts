/**
 * microsoft.list_calendars — List calendars from Microsoft 365
 *
 * Retrieves all calendars for the authenticated user via the Microsoft Graph API.
 * Requires a Microsoft 365 OAuth2 credential with Calendars.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphCalendar {
  id: string;
  name: string;
  color: string;
  isDefaultCalendar: boolean;
  canEdit: boolean;
  canShare: boolean;
  canViewPrivateItems: boolean;
  owner?: { name: string; address: string };
  changeKey?: string;
}

interface GraphCalendarsResponse {
  value: GraphCalendar[];
  '@odata.nextLink'?: string;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
});

export const microsoftListCalendarsAction = defineAction({
  id: 'microsoft.list_calendars',
  name: 'List Calendars',
  description:
    'List all calendars for the authenticated user (GET /me/calendars). Use when you need to discover available calendars before querying events.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "AAMkAGI1A...", "name": "Calendar", "color": "auto", "isDefaultCalendar": true, "canEdit": true}\n' +
    '```',
  provider: MICROSOFT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Calendars.Read'],
    description: 'Microsoft 365 OAuth2 credential with Calendars.Read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Microsoft 365 Credential',
        type: 'text',
        required: true,
        description: 'Microsoft 365 OAuth2 credential for authentication',
        aiProvided: false,
      },
    ],
  },

  tags: ['microsoft', 'outlook', 'calendar', 'list', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Listing Microsoft 365 calendars');

    try {
      const response = await fetch(`${GRAPH_API_BASE}/me/calendars`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as GraphCalendarsResponse;

      const calendars = data.value.map((cal) => ({
        id: cal.id,
        name: cal.name,
        color: cal.color,
        isDefault: cal.isDefaultCalendar,
        canEdit: cal.canEdit,
        canShare: cal.canShare,
        owner: cal.owner,
      }));

      return {
        success: true,
        output: {
          calendars,
          calendarCount: calendars.length,
        },
        metadata: { calendarCount: calendars.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
