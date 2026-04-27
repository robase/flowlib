/**
 * Invect configuration — used by the Express server and the Invect CLI.
 *
 * Run `npx flowlib-cli generate` to regenerate the Drizzle schema files
 * whenever plugins are added or removed.
 */

import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';
import { mcp } from '@flowlib/mcp';
import { vercelWorkflowsPlugin } from '@flowlib/vercel-workflows';
import { versionControl } from '@flowlib/version-control';
import { githubProvider } from '@flowlib/version-control/providers/github';
import { defineConfig } from '@flowlib/core';

export const invectConfig = defineConfig({
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY || 'change-me-in-production',
  database: {
    type: 'sqlite',
    connectionString: process.env.DB_FILE_NAME || 'file:./dev.db',
  },
  apiPath: 'http://localhost:3000/flowlib',
  frontendPath: '/flowlib',
  theme: 'dark',
  logging: {
    level: 'error',
  },
  defaultCredentials: [
    ...(process.env.SEED_ANTHROPIC_API_KEY
      ? [
          {
            name: 'Anthropic API Key',
            type: 'llm' as const,
            provider: 'anthropic',
            authType: 'apiKey' as const,
            config: { apiKey: process.env.SEED_ANTHROPIC_API_KEY },
            description: 'Anthropic Claude API credential for AI model nodes',
            isShared: true,
          },
        ]
      : []),
    ...(process.env.SEED_OPENROUTER_API_KEY
      ? [
          {
            name: 'OpenRouter API Key',
            type: 'llm' as const,
            provider: 'openrouter',
            authType: 'apiKey' as const,
            config: { apiKey: process.env.SEED_OPENROUTER_API_KEY },
            description: 'OpenRouter API credential for AI model nodes',
            isShared: true,
          },
        ]
      : []),
    ...(process.env.SEED_LINEAR_CLIENT_ID && process.env.SEED_LINEAR_CLIENT_SECRET
      ? [
          {
            name: 'Linear OAuth2',
            type: 'http-api' as const,
            provider: 'linear',
            authType: 'oauth2' as const,
            config: {
              clientId: process.env.SEED_LINEAR_CLIENT_ID,
              clientSecret: process.env.SEED_LINEAR_CLIENT_SECRET,
              oauth2Provider: 'linear',
            },
            description: 'Linear OAuth2 credential for issue tracking',
            isShared: true,
          },
        ]
      : []),
    ...(process.env.SEED_GMAIL_CLIENT_ID && process.env.SEED_GMAIL_CLIENT_SECRET
      ? [
          {
            name: 'Gmail OAuth2',
            type: 'http-api' as const,
            provider: 'google',
            authType: 'oauth2' as const,
            config: {
              clientId: process.env.SEED_GMAIL_CLIENT_ID,
              clientSecret: process.env.SEED_GMAIL_CLIENT_SECRET,
              oauth2Provider: 'google',
            },
            description: 'Gmail OAuth2 credential',
            isShared: true,
          },
        ]
      : []),
  ],
  plugins: [
    auth({
      trustedOrigins: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
      betterAuthOptions: {
        secret: process.env.BETTER_AUTH_SECRET || 'flowlib-dev-secret-do-not-use-in-production',
      },
      apiKey: true,
      globalAdmins:
        process.env.INVECT_ADMIN_EMAIL && process.env.INVECT_ADMIN_PASSWORD
          ? [
              {
                email: process.env.INVECT_ADMIN_EMAIL,
                pw: process.env.INVECT_ADMIN_PASSWORD,
                name: 'Admin',
              },
            ]
          : [],
    }),
    rbac(),
    webhooks({
      webhookBaseUrl: process.env.INVECT_WEBHOOK_BASE_URL || 'http://localhost:3000/flowlib',
    }),
    versionControl({
      provider: githubProvider({
        auth: {
          type: 'token',
          token: process.env.GITHUB_TOKEN || 'ghp_dummy_version_control_token_replace_me',
        },
      }),
      repo: process.env.INVECT_VC_REPO || 'example/flowlib-flows',
      defaultBranch: 'main',
      path: 'flows/',
      mode: 'direct-commit',
      syncDirection: 'push',
    }),
    mcp(),
    vercelWorkflowsPlugin({
      deploymentUrl: process.env.VERCEL_DEPLOYMENT_URL,
    }),
  ],
});
