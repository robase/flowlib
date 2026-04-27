/**
 * Flowlib Configuration
 *
 * This file is read by the Flowlib CLI for schema generation
 * and by your application at runtime.
 *
 * Docs: https://flowlib.dev/docs
 */

import { defineConfig } from '@flowlib/core';
// import { ... } from '@flowlib/nextjs';

export const config = defineConfig({
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'change me',
  database: {
    type: 'sqlite',
    driver: 'libsql',
    connectionString: 'file:./dev.db',
  },
  frontendPath: '/flowlib',
  apiPath: '/api/flowlib',

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

  // Plugins (each has backend + frontend parts)
  // plugins: [],
});
