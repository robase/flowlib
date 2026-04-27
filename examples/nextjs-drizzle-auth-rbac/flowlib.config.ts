/**
 * Flowlib configuration — shared between the Next.js API handler and the
 * `<Flowlib>` frontend component. Read by the CLI for schema generation.
 *
 * Backend: import { flowlibConfig } from '@/flowlib.config'
 * Frontend: import config from './flowlib.config' (Vite/Next.js browser condition
 *           strips server-only plugin code automatically)
 * CLI: npx flowlib-cli generate --config flowlib.config.ts
 */

import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { defineConfig } from '@flowlib/core';

const flowlibConfig = defineConfig({
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'change-me-in-production',
  database: {
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://acme:acme@localhost:5432/acme_dashboard',
    type: 'postgresql',
    name: 'Acme Dashboard DB',
  },
  apiPath: '/api/flowlib',
  frontendPath: '/dashboard/workflows',
  theme: 'light',
  logging: {
    level: 'info',
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
            metadata: { provider: 'anthropic' },
          },
        ]
      : []),
    ...(process.env.SEED_LINEAR_CLIENT_ID && process.env.SEED_LINEAR_CLIENT_SECRET
      ? [
          {
            name: 'Linear OAuth2',
            type: 'http-api' as const,
            authType: 'oauth2' as const,
            config: {
              clientId: process.env.SEED_LINEAR_CLIENT_ID,
              clientSecret: process.env.SEED_LINEAR_CLIENT_SECRET,
              oauth2Provider: 'linear',
            },
            description: 'Linear OAuth2 credential for issue tracking',
            isShared: true,
            metadata: { provider: 'linear' },
          },
        ]
      : []),
  ],
  plugins: [
    auth({
      globalAdmins: [
        {
          email: process.env.FLOWLIB_ADMIN_EMAIL,
          pw: process.env.FLOWLIB_ADMIN_PASSWORD,
          name: 'Admin',
        },
      ],
    }),
    rbac(),
  ],
});

export { flowlibConfig };
export default flowlibConfig;
