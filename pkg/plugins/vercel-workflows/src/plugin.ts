import type { FlowlibInstance, FlowlibPluginDefinition } from '@flowlib/core';
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
): FlowlibPluginDefinition {
  const { plugin: backend, effective } = buildBackendPlugin(options);
  return {
    id: 'vercel-workflows',
    name: 'Vercel Workflows',
    backend: {
      ...backend,
      schema: {},
      actions: [],
      settings: {
        namespace: 'vercel-workflows',
        label: 'Vercel Workflows',
        description:
          'Defaults for the Deploy preview endpoint. Changes take effect on the next preview request.',
        fields: [
          {
            key: 'vercel-workflows.defaultFlowImport',
            label: 'Default flow import path',
            description:
              'Import path the generated workflow file uses to reach the SDK flow (e.g. `./flow` or `@/lib/flow`).',
            type: 'string',
            defaultValue: options.defaultFlowImport ?? './flow',
          },
          {
            key: 'vercel-workflows.defaultConfigImport',
            label: 'Default config import path',
            description:
              "Import path to the user's flow config (`getFlowConfig`). Defaults to `./flow.config`.",
            type: 'string',
            defaultValue: options.defaultConfigImport ?? './flow.config',
          },
          {
            key: 'vercel-workflows.deploymentUrl',
            label: 'Deployment URL',
            description: 'Configured in flowlib.config.ts. Used only for logging/validation.',
            type: 'string',
            readOnly: true,
            defaultValue: options.deploymentUrl ?? '',
          },
        ],
      },
      init(ctx) {
        ctx.logger.info('[vercel-workflows] Plugin initialised', {
          deploymentUrl: options.deploymentUrl ?? '(not set)',
          endpoints: backend.endpoints?.length ?? 0,
        });

        // Stash a post-init applier — the FlowlibInstance isn't ready yet.
        ctx.store.set('__settingsApplier', async (flowlib: FlowlibInstance) => {
          const persistedFlow = await flowlib.settings.get<string>(
            'vercel-workflows.defaultFlowImport',
          );
          if (typeof persistedFlow === 'string' && persistedFlow.length > 0) {
            effective.defaultFlowImport = persistedFlow;
          }
          const persistedConfig = await flowlib.settings.get<string>(
            'vercel-workflows.defaultConfigImport',
          );
          if (typeof persistedConfig === 'string' && persistedConfig.length > 0) {
            effective.defaultConfigImport = persistedConfig;
          }

          flowlib.settings.onChange('vercel-workflows', (event) => {
            if (event.type !== 'set' || typeof event.value !== 'string') {
              return;
            }
            if (event.key === 'vercel-workflows.defaultFlowImport') {
              effective.defaultFlowImport = event.value;
            } else if (event.key === 'vercel-workflows.defaultConfigImport') {
              effective.defaultConfigImport = event.value;
            }
          });
        });

        return {};
      },
    },
  };
}
