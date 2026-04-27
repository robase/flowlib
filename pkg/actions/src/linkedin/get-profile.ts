/**
 * linkedin.get_profile — Get the authenticated user's LinkedIn profile
 *
 * Retrieves the current user's profile information using the OpenID Connect
 * userinfo endpoint. Returns name, email, picture, and LinkedIn sub (person ID).
 * Requires a LinkedIn OAuth2 credential with openid + profile scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINKEDIN_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINKEDIN_API = 'https://api.linkedin.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'LinkedIn credential is required'),
});

export const linkedinGetProfileAction = defineAction({
  id: 'linkedin.get_profile',
  name: 'Get Profile',
  description:
    "Get the authenticated LinkedIn user's profile via OpenID Connect (GET /v2/userinfo). Use when you need the user's person ID, name, email, or profile picture.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"sub": "abc123def", "name": "Jane Smith", "email": "jane@example.com", "picture": "https://media.licdn.com/...jpg", "email_verified": true}\n' +
    '```',
  provider: LINKEDIN_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'linkedin',
    requiredScopes: ['openid', 'profile', 'email'],
    description: 'LinkedIn OAuth2 credential with openid, profile, and email scopes',
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
    ],
  },

  tags: ['linkedin', 'profile', 'user', 'oauth2'],

  async execute(params, context) {
    const { credentialId } = params;

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

    context.logger.debug('Getting LinkedIn profile for authenticated user');

    try {
      const response = await fetch(`${LINKEDIN_API}/v2/userinfo`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `LinkedIn API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const profile = (await response.json()) as {
        sub: string;
        name: string;
        given_name: string;
        family_name: string;
        picture: string;
        email: string;
        email_verified: boolean;
        locale: { country: string; language: string };
      };

      return {
        success: true,
        output: {
          personId: profile.sub,
          name: profile.name,
          firstName: profile.given_name,
          lastName: profile.family_name,
          email: profile.email,
          emailVerified: profile.email_verified,
          picture: profile.picture,
          locale: profile.locale,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get LinkedIn profile: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
