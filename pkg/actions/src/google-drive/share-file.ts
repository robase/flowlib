/**
 * google_drive.share_file — Share a file in Google Drive
 *
 * Creates a permission on a file to share it with a user, group, domain, or anyone.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  fileId: z.string().min(1, 'File ID is required'),
  role: z.enum(['reader', 'commenter', 'writer', 'organizer']),
  type: z.enum(['user', 'group', 'domain', 'anyone']),
  emailAddress: z.string().optional().default(''),
  domain: z.string().optional().default(''),
  sendNotificationEmail: z.boolean().optional().default(true),
});

export const googleDriveShareFileAction = defineAction({
  id: 'google_drive.share_file',
  name: 'Share File',
  description:
    'Share a file in Google Drive by creating a permission (permissions.create). Use when the user wants to grant access to a file for a user, group, domain, or publicly. ' +
    'Call with `fileId`, `role` (reader/commenter/writer/organizer), `type` (user/group/domain/anyone), and `emailAddress` for user/group sharing.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"permissionId": "12345", "fileId": "1abc", "role": "writer", "type": "user", "emailAddress": "user@example.com"}\n' +
    '```',
  provider: GOOGLE_DRIVE_PROVIDER,
  actionCategory: 'manage',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata',
    ],
    description: 'Google Drive OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Drive Credential',
        type: 'text',
        required: true,
        description: 'Google Drive OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'fileId',
        label: 'File ID',
        type: 'text',
        required: true,
        description: 'The ID of the file to share',
        aiProvided: true,
      },
      {
        name: 'role',
        label: 'Role',
        type: 'select',
        required: true,
        options: [
          { label: 'Viewer', value: 'reader' },
          { label: 'Commenter', value: 'commenter' },
          { label: 'Editor', value: 'writer' },
          { label: 'Organizer', value: 'organizer' },
        ],
        description: 'Permission level to grant',
        aiProvided: true,
      },
      {
        name: 'type',
        label: 'Share Type',
        type: 'select',
        required: true,
        options: [
          { label: 'User', value: 'user' },
          { label: 'Group', value: 'group' },
          { label: 'Domain', value: 'domain' },
          { label: 'Anyone', value: 'anyone' },
        ],
        description: 'Type of permission',
        aiProvided: true,
      },
      {
        name: 'emailAddress',
        label: 'Email Address',
        type: 'text',
        placeholder: 'user@example.com',
        description: 'Email address (required for user/group type)',
        aiProvided: true,
      },
      {
        name: 'domain',
        label: 'Domain',
        type: 'text',
        placeholder: 'example.com',
        description: 'Domain name (required for domain type)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sendNotificationEmail',
        label: 'Send Notification',
        type: 'boolean',
        defaultValue: true,
        description: 'Whether to send a notification email to the recipient',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'share', 'permissions', 'oauth2'],

  async execute(params, context) {
    const { credentialId, fileId, role, type, emailAddress, domain, sendNotificationEmail } =
      params;

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

    context.logger.debug('Sharing Google Drive file', { fileId, role, type });

    try {
      const permission: Record<string, unknown> = { role, type };
      if (type === 'user' || type === 'group') {
        if (!emailAddress?.trim()) {
          return { success: false, error: 'Email address is required for user/group sharing' };
        }
        permission.emailAddress = emailAddress;
      }
      if (type === 'domain') {
        if (!domain?.trim()) {
          return { success: false, error: 'Domain is required for domain sharing' };
        }
        permission.domain = domain;
      }

      const url = new URL(`${DRIVE_API_BASE}/files/${fileId}/permissions`);
      url.searchParams.set('sendNotificationEmail', String(sendNotificationEmail));

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(permission),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Drive API error: ${response.status} - ${errorText}`,
        };
      }

      const result = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: {
          permissionId: result.id,
          fileId,
          role,
          type,
          emailAddress: emailAddress || undefined,
        },
        metadata: { permissionId: result.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
