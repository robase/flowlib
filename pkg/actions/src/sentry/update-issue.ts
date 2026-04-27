/**
 * sentry.update_issue — Update a Sentry issue
 *
 * Updates a Sentry issue's attributes: status (resolve, unresolve, ignore),
 * assignment, bookmark, and public visibility.
 * Requires a Sentry OAuth2 credential with event:write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { SENTRY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Sentry credential is required'),
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  issueId: z.string().min(1, 'Issue ID is required'),
  status: z
    .enum(['resolved', 'resolvedInNextRelease', 'unresolved', 'ignored'])
    .optional()
    .default('resolved'),
  assignedTo: z.string().optional().default(''),
  isBookmarked: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export const sentryUpdateIssueAction = defineAction({
  id: 'sentry.update_issue',
  name: 'Update Issue',
  description:
    'Update a Sentry issue (PUT /organizations/{org}/issues/{issue_id}/). Use when the user wants to resolve, ignore, assign, bookmark, or change visibility of an error.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "123456", "status": "resolved", "assignedTo": {"name": "jane"}, "isBookmarked": false}\n' +
    '```',
  provider: SENTRY_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'sentry',
    description: 'Sentry OAuth2 credential with event:write scope',
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
        description: 'The numeric ID of the Sentry issue to update',
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'resolved',
        options: [
          { label: 'Resolved', value: 'resolved' },
          { label: 'Resolved in Next Release', value: 'resolvedInNextRelease' },
          { label: 'Unresolved', value: 'unresolved' },
          { label: 'Ignored', value: 'ignored' },
        ],
        description: 'The new status for the issue.',
        aiProvided: true,
      },
      {
        name: 'assignedTo',
        label: 'Assign To',
        type: 'text',
        placeholder: 'username or team:team-slug',
        description:
          'Username or team to assign (e.g. "jane" or "team:backend"). Leave empty to skip.',
        aiProvided: true,
      },
      {
        name: 'isBookmarked',
        label: 'Bookmarked',
        type: 'boolean',
        description: 'Set the bookmark flag on this issue.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'isPublic',
        label: 'Public',
        type: 'boolean',
        description: 'Set the issue to public or private.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['sentry', 'issue', 'update', 'resolve', 'assign', 'monitoring', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, organizationSlug, issueId, status, assignedTo, isBookmarked, isPublic } =
      params;

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

    context.logger.debug('Updating Sentry issue', { organizationSlug, issueId, status });

    try {
      const body: Record<string, unknown> = {};
      if (status) {
        body.status = status;
      }
      if (assignedTo) {
        body.assignedTo = assignedTo;
      }
      if (isBookmarked !== undefined) {
        body.isBookmarked = isBookmarked;
      }
      if (isPublic !== undefined) {
        body.isPublic = isPublic;
      }

      const response = await fetch(
        `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/${encodeURIComponent(issueId)}/`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
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
        status: string;
        assignedTo: { type: string; id: string; name: string } | null;
        permalink: string;
      };

      return {
        success: true,
        output: {
          id: issue.id,
          shortId: issue.shortId,
          title: issue.title,
          status: issue.status,
          assignedTo: issue.assignedTo
            ? { type: issue.assignedTo.type, name: issue.assignedTo.name }
            : null,
          permalink: issue.permalink,
        },
        metadata: {
          organizationSlug,
          issueId: issue.id,
          updatedFields: Object.keys(body),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Sentry update issue failed: ${msg}` };
    }
  },
});
