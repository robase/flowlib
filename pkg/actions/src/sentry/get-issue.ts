/**
 * sentry.get_issue — Retrieve a Sentry issue
 *
 * Returns detailed information about a single Sentry issue including
 * title, status, first/last seen timestamps, event count, and project.
 * Requires a Sentry OAuth2 credential with event:read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { SENTRY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Sentry credential is required'),
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  issueId: z.string().min(1, 'Issue ID is required'),
});

export const sentryGetIssueAction = defineAction({
  id: 'sentry.get_issue',
  name: 'Get Issue',
  description:
    'Retrieve a Sentry issue by ID (GET /organizations/{org}/issues/{issue_id}/). Use when the user wants to inspect a specific error, check its status, or see event counts.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "123456", "shortId": "PROJ-1A", "title": "TypeError: null is not an object", "status": "unresolved", "level": "error", "count": "48", "userCount": 12, "firstSeen": "2025-03-01T10:00:00Z", "lastSeen": "2025-04-07T08:30:00Z"}\n' +
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
        name: 'issueId',
        label: 'Issue ID',
        type: 'text',
        required: true,
        placeholder: '123456',
        description: 'The numeric ID of the Sentry issue',
        aiProvided: true,
      },
    ],
  },

  tags: ['sentry', 'issue', 'get', 'errors', 'monitoring', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, organizationSlug, issueId } = params;

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

    context.logger.debug('Retrieving Sentry issue', { organizationSlug, issueId });

    try {
      const response = await fetch(
        `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/${encodeURIComponent(issueId)}/`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Sentry API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const issue = (await response.json()) as {
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
        numComments: number;
        isPublic: boolean;
        isSubscribed: boolean;
        isBookmarked: boolean;
        hasSeen: boolean;
        assignedTo: { type: string; id: string; name: string; email?: string } | null;
        project: { id: string; name: string; slug: string };
        metadata: { title?: string; value?: string; filename?: string };
        tags: Array<{ key: string; name: string; totalValues: number }>;
        activity: Array<{ type: string; dateCreated: string; data: Record<string, unknown> }>;
      };

      return {
        success: true,
        output: {
          id: issue.id,
          shortId: issue.shortId,
          title: issue.title,
          culprit: issue.culprit,
          status: issue.status,
          level: issue.level,
          count: issue.count,
          userCount: issue.userCount,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          permalink: issue.permalink,
          numComments: issue.numComments,
          isPublic: issue.isPublic,
          assignedTo: issue.assignedTo
            ? { type: issue.assignedTo.type, name: issue.assignedTo.name }
            : null,
          project: issue.project?.slug,
          metadata: issue.metadata,
          tags: issue.tags?.map((t) => ({ key: t.key, name: t.name })),
          recentActivity: issue.activity?.slice(0, 10).map((a) => ({
            type: a.type,
            dateCreated: a.dateCreated,
          })),
        },
        metadata: {
          organizationSlug,
          issueId: issue.id,
          permalink: issue.permalink,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Sentry get issue failed: ${msg}` };
    }
  },
});
