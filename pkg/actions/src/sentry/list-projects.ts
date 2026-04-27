/**
 * sentry.list_projects — List an organization's projects
 *
 * Lists all projects for a given Sentry organization.
 * Requires a Sentry OAuth2 credential with project:read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { SENTRY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Sentry credential is required'),
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  cursor: z.string().optional().default(''),
});

export const sentryListProjectsAction = defineAction({
  id: 'sentry.list_projects',
  name: 'List Projects',
  description:
    'List all projects in a Sentry organization (GET /organizations/{org}/projects/). Use when the user needs to discover available projects or find a project slug for filtering issues.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"projects": [{"id": "1", "slug": "my-app", "name": "My App", "platform": "javascript", "status": "active"}], "totalCount": 3}\n' +
    '```',
  provider: SENTRY_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'sentry',
    description: 'Sentry OAuth2 credential with project:read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Sentry Credential',
        type: 'text',
        required: true,
        description: 'Sentry OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'organizationSlug',
        label: 'Organization Slug',
        type: 'text',
        required: true,
        placeholder: 'my-org',
        description: 'The slug of the Sentry organization',
        aiProvided: true,
      },
      {
        name: 'cursor',
        label: 'Cursor',
        type: 'text',
        placeholder: '',
        description: 'Pagination cursor for next page of results',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['sentry', 'projects', 'list', 'monitoring', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, organizationSlug, cursor } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Sentry OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Sentry credential.',
      };
    }

    context.logger.debug('Listing Sentry projects', { organizationSlug });

    try {
      const url = new URL(
        `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/projects/`,
      );
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Sentry API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const projects = (await response.json()) as Array<{
        id: string;
        slug: string;
        name: string;
        platform: string | null;
        dateCreated: string;
        isBookmarked: boolean;
        isMember: boolean;
        hasAccess: boolean;
        status: string;
      }>;

      return {
        success: true,
        output: {
          projects: projects.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            platform: p.platform,
            dateCreated: p.dateCreated,
            status: p.status,
          })),
          totalCount: projects.length,
        },
        metadata: {
          organizationSlug,
          projectCount: projects.length,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Sentry list projects failed: ${msg}` };
    }
  },
});
