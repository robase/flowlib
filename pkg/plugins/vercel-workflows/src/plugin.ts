import type { InvectPluginDefinition } from '@flowlib/core';
import { buildBackendPlugin, type VercelWorkflowsBackendOptions } from './backend/endpoints';

export interface VercelWorkflowsPluginOptions extends VercelWorkflowsBackendOptions {
  // Optional: base URL for the Vercel deployment (used in logging / config validation).
  deploymentUrl?: string;
}

// Server plugin for the Vercel Workflows integration. Exposes a Deploy preview
// endpoint that returns both the compiled `'use workflow'` source and the
// SDK-source file it imports, ready for copy-paste into the user's Next.js app.
export function vercelWorkflowsPlugin(
  options: VercelWorkflowsPluginOptions = {},
): InvectPluginDefinition {
  const backend = buildBackendPlugin(options);
  return {
    id: 'vercel-workflows',
    name: 'Vercel Workflows',
    backend: {
      ...backend,
      schema: {},
      actions: [],
      async init(ctx) {
        ctx.logger.info('[vercel-workflows] Plugin initialised', {
          deploymentUrl: options.deploymentUrl ?? '(not set)',
          endpoints: backend.endpoints?.length ?? 0,
        });
        return {};
      },
    },
  };
}
