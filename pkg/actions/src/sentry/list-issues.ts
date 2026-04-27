/**
 * sentry.list_issues — List an organization's issues
 *
 * Lists issues for a Sentry organization with optional query filtering.
 * Supports Sentry's structured search syntax (e.g. "is:unresolved", "assigned:me").
 * Requires a Sentry OAuth2 credential with event:read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { SENTRY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Sentry credential is required'),
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  projectId: z.string().optional().default(''),
  query: z.string().optional().default('is:unresolved'),
  statsPeriod: z.enum(['', '24h', '14d']).optional().default('24h'),
  cursor: z.string().optional().default(''),
});

export const sentryListIssuesAction = defineAction({
  id: 'sentry.list_issues',
  name: 'List Issues',
  description:
    'List issues for a Sentry organization (GET /organizations/{org}/issues/). Use when the user wants to see recent errors, filter by status, or triage unresolved issues. Supports structured search queries like "is:unresolved", "assigned:me", "level:error".\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"issues": [{"id": "123", "shortId": "PROJ-1A", "title": "TypeError", "status": "unresolved", "count": "48", "userCount": 12, "firstSeen": "2025-03-01T10:00:00Z"}], "totalCount": 25}\n' +
    '```',
  provider: SENTRY_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'sentry',
    description: 'Sentry OAuth2 credential with event:read scope',
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
        name: 'projectId',
        label: 'Project ID',
        type: 'text',
        placeholder: '123456',
        description:
          'Numeric project ID to filter issues. Use sentry.list_projects to find IDs. Leave empty for all projects.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        defaultValue: 'is:unresolved',
        placeholder: 'is:unresolved assigned:me',
        description:
          'Sentry structured search query. Examples: "is:unresolved", "assigned:me", "level:error", "browser:Chrome".',
        aiProvided: true,
      },
      {
        name: 'statsPeriod',
        label: 'Stats Period',
        type: 'select',
        defaultValue: '24h',
        options: [
          { label: 'Last 24 hours', value: '24h' },
          { label: 'Last 14 days', value: '14d' },
          { label: 'Disabled', value: '' },
        ],
        description: 'Time period for event count statistics.',
        extended: true,
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

  tags: ['sentry', 'issues', 'list', 'errors', 'monitoring', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, organizationSlug, projectId, query, statsPeriod, cursor } = params;

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

    context.logger.debug('Listing Sentry issues', { organizationSlug, projectId, query });

    try {
      const url = new URL(
        `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/`,
      );
      if (query) {
        url.searchParams.set('query', query);
      }
      if (projectId) {
        url.searchParams.set('project', projectId);
      }
      if (statsPeriod) {
        url.searchParams.set('statsPeriod', statsPeriod);
      }
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

      const issues = (await response.json()) as Array<{
        id: string;
        shortId: string;
        title: string;
        culprit: string;
        status: string;
        level: string;
        count: string;
        userCount: number;
        firstSeen: string;
        lastSeen: string;
        permalink: string;
        project: { id: string; name: string; slug: string };
        metadata: { title?: string; value?: string; filename?: string };
      }>;

      return {
        success: true,
        output: {
          issues: issues.map((i) => ({
            id: i.id,
            shortId: i.shortId,
            title: i.title,
            culprit: i.culprit,
            status: i.status,
            level: i.level,
            count: i.count,
            userCount: i.userCount,
            firstSeen: i.firstSeen,
            lastSeen: i.lastSeen,
            permalink: i.permalink,
            project: i.project?.slug,
          })),
          totalCount: issues.length,
        },
        metadata: {
          organizationSlug,
          query,
          issueCount: issues.length,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Sentry list issues failed: ${msg}` };
    }
  },
});
