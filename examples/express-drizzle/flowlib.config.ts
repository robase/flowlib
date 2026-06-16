/**
 * Flowlib configuration — used by the Express server and the Flowlib CLI.
 *
 * Run `npx flowlib-cli generate` to regenerate the Drizzle schema files
 * whenever plugins are added or removed.
 */

import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';
import { mcp } from '@flowlib/mcp';
import { agents } from '@flowlib/agents';
import { aiSdkProvider, standardAiSdkVendors } from '@flowlib/agents/providers';
import { localDockerWorkspace } from '@flowlib/agents/workspaces';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { versionControl } from '@flowlib/version-control';
import { githubProvider } from '@flowlib/version-control/providers/github';
import { defineConfig } from '@flowlib/core';

export const flowlibConfig = defineConfig({
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'change-me-in-production',
  database: {
    type: 'sqlite',
    connectionString: 'file:./dev.db',
  },
  apiPath: 'http://localhost:3000/flowlib',
  frontendPath: '/flowlib',
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
        process.env.FLOWLIB_ADMIN_EMAIL && process.env.FLOWLIB_ADMIN_PASSWORD
          ? [
              {
                email: process.env.FLOWLIB_ADMIN_EMAIL,
                pw: process.env.FLOWLIB_ADMIN_PASSWORD,
                name: 'Admin',
              },
            ]
          : [],
    }),
    rbac(),
    webhooks({
      webhookBaseUrl: process.env.FLOWLIB_WEBHOOK_BASE_URL || 'http://localhost:3000/flowlib',
    }),
    versionControl({
      provider: githubProvider({
        auth: {
          type: 'token',
          token: process.env.GITHUB_TOKEN || 'ghp_dummy_version_control_token_replace_me',
        },
      }),
      repo: process.env.FLOWLIB_VC_REPO || 'example/flowlib-flows',
      defaultBranch: 'main',
      path: 'flows/',
      mode: 'direct-commit',
      syncDirection: 'write',
    }),
    mcp(),
    // Code-editing agents. Chat runs **in-process** on Express via the
    // runtime-portable agent loop (HTTP/SSE transport) — no Cloudflare
    // Durable Object required. The `ai-sdk` provider drives our own
    // prompt→tool loop through the Vercel AI SDK, with **direct** vendor
    // connections (Anthropic / OpenAI / Google) so there's no gateway
    // markup.
    //
    // Credential resolution is handled **internally**: the plugin threads
    // `flowlib.credentials` to the provider, so the chat's own attached
    // credential (decrypted) is resolved automatically — each user brings
    // their own key; OpenRouter / Groq / etc. work via an OpenAI-compatible
    // credential (`baseUrl`). No `resolveCredential` wiring needed.
    agents({
      defaultProviderId: 'ai-sdk',
      providers: [
        aiSdkProvider({
          // Statically wired (Workers can't dynamic-import); harmless on Node.
          streamText,
          // The host installs the `@ai-sdk/*` packages it wants and passes
          // the `create*` fns; the helper wires the vendor map (with
          // baseURL/headers passthrough, so `openai` also serves any
          // OpenAI-compatible gateway).
          vendors: standardAiSdkVendors({
            createAnthropic,
            createOpenAI,
            createGoogleGenerativeAI,
          }),
        }),
      ],
      // Sandbox offload (opt-in). Pure chat needs no workspace. Set
      // `AGENT_DOCKER_SANDBOX_IMAGE` (e.g. `node:24-slim`) to give the
      // agent a real shell + filesystem in a local Docker container — no
      // cloud creds, just a running Docker daemon. The example still boots
      // without it (the sandbox is provisioned lazily, only when a tool
      // actually needs it).
      ...(process.env.AGENT_DOCKER_SANDBOX_IMAGE
        ? {
            workspaceProviders: [
              localDockerWorkspace({ image: process.env.AGENT_DOCKER_SANDBOX_IMAGE }),
            ],
          }
        : {}),
      // Alternatively, a cloud sandbox via ComputeSDK — install a provider
      // (e.g. `@computesdk/e2b`) and wire it the same way:
      //   import { computesdkWorkspace } from '@flowlib/agents/workspaces';
      //   import { e2b } from '@computesdk/e2b';
      //   workspaceProviders: [computesdkWorkspace({ compute: e2b({ apiKey: ... }) })],
    }),
  ],
});
