// ============================================================================
// @flowlib/cloudflare-agents — backend plugin
//
// Adds API endpoints to compile Flowlib flows into Cloudflare Agent/Workflow
// projects. No database tables required — compilation is stateless.
// ============================================================================

import type {
  FlowlibInstance,
  FlowlibPlugin,
  FlowlibPluginDefinition,
} from '@flowlib/core/types';
import { compileFlow, scaffoldProject } from '../compiler/flow-compiler';
import type { CompileFlowOptions, CompileTarget, ScaffoldOptions } from '../shared/types';

export interface CloudflareAgentsPluginOptions {
  /** Default compilation target */
  defaultTarget?: CompileTarget;
  /** Default credential strategy */
  defaultCredentialStrategy?: 'env' | 'inline';
}

export function cloudflareAgentsPlugin(
  options?: CloudflareAgentsPluginOptions,
): FlowlibPluginDefinition {
  return {
    id: 'cloudflare-agents',
    name: 'Cloudflare Agents',
    backend: _backendPlugin(options),
  };
}

function _backendPlugin(options?: CloudflareAgentsPluginOptions): FlowlibPlugin {
  // Mutable runtime config — read on every request so settings changes take
  // effect without restart. Initialized from constructor options + DB on init().
  const effective: {
    defaultTarget: CompileTarget;
    defaultCredentialStrategy: 'env' | 'inline';
  } = {
    defaultTarget: options?.defaultTarget ?? 'agent-workflow',
    defaultCredentialStrategy: options?.defaultCredentialStrategy ?? 'env',
  };

  return {
    id: 'cloudflare-agents',
    name: 'Cloudflare Agents',

    settings: {
      namespace: 'cloudflare-agents',
      label: 'Cloudflare Agents',
      description:
        'Defaults for compiling Flowlib flows into Cloudflare Workers / Workflows. Changes take effect on the next compile or scaffold call.',
      fields: [
        {
          key: 'cloudflare-agents.defaultTarget',
          label: 'Default compile target',
          description:
            'Target runtime when a request omits `target`. agent-workflow compiles to a Cloudflare Agent + Workflow; standalone-workflow emits a plain Workflow.',
          type: 'select',
          options: [
            { value: 'agent-workflow', label: 'Agent + Workflow' },
            { value: 'standalone-workflow', label: 'Standalone Workflow' },
          ],
          defaultValue: options?.defaultTarget ?? 'agent-workflow',
        },
        {
          key: 'cloudflare-agents.defaultCredentialStrategy',
          label: 'Default credential strategy',
          description:
            'How credentials are wired into compiled output. `env` reads from `env.<NAME>` bindings; `inline` embeds values into the source.',
          type: 'select',
          options: [
            { value: 'env', label: 'Env bindings (recommended)' },
            { value: 'inline', label: 'Inline (debug only)' },
          ],
          defaultValue: options?.defaultCredentialStrategy ?? 'env',
        },
      ],
    },

    init(ctx) {
      // Stash a post-init applier — the FlowlibInstance isn't ready yet.
      ctx.store.set('__settingsApplier', async (flowlib: FlowlibInstance) => {
        const persistedTarget = await flowlib.settings.get<CompileTarget>(
          'cloudflare-agents.defaultTarget',
        );
        if (persistedTarget === 'agent-workflow' || persistedTarget === 'standalone-workflow') {
          effective.defaultTarget = persistedTarget;
        }
        const persistedStrategy = await flowlib.settings.get<'env' | 'inline'>(
          'cloudflare-agents.defaultCredentialStrategy',
        );
        if (persistedStrategy === 'env' || persistedStrategy === 'inline') {
          effective.defaultCredentialStrategy = persistedStrategy;
        }

        flowlib.settings.onChange('cloudflare-agents', (event) => {
          if (event.type !== 'set') {
            return;
          }
          if (
            event.key === 'cloudflare-agents.defaultTarget' &&
            (event.value === 'agent-workflow' || event.value === 'standalone-workflow')
          ) {
            effective.defaultTarget = event.value as CompileTarget;
          } else if (
            event.key === 'cloudflare-agents.defaultCredentialStrategy' &&
            (event.value === 'env' || event.value === 'inline')
          ) {
            effective.defaultCredentialStrategy = event.value as 'env' | 'inline';
          }
        });
      });
    },

    endpoints: [
      // ── POST /cloudflare/compile ──────────────────────────────────
      {
        method: 'POST',
        path: '/cloudflare/compile',
        handler: async (ctx) => {
          const { flowId, version, target, credentialStrategy } =
            ctx.body as unknown as CompileFlowOptions;

          if (!flowId) {
            return { status: 400, body: { error: 'flowId is required' } };
          }

          const flowlib = ctx.getFlowlib();

          // Fetch the flow
          const flow = await flowlib.flows.get(flowId);
          if (!flow) {
            return { status: 404, body: { error: `Flow ${flowId} not found` } };
          }

          // Fetch the version
          const flowVersion = await flowlib.versions.get(flowId, version ?? 'latest');
          if (!flowVersion || !flowVersion.flowlibDefinition) {
            return { status: 404, body: { error: `Flow version not found` } };
          }

          const result = compileFlow({
            definition: flowVersion.flowlibDefinition,
            flowId,
            flowName: flow.name,
            version: flowVersion.version,
            target: (target ?? effective.defaultTarget) as CompileTarget,
            credentialStrategy: credentialStrategy ?? effective.defaultCredentialStrategy,
          });

          return { status: result.success ? 200 : 422, body: result };
        },
      },

      // ── POST /cloudflare/scaffold ─────────────────────────────────
      {
        method: 'POST',
        path: '/cloudflare/scaffold',
        handler: async (ctx) => {
          const { flowId, version, target, credentialStrategy, projectName } =
            ctx.body as unknown as ScaffoldOptions;

          if (!flowId) {
            return { status: 400, body: { error: 'flowId is required' } };
          }

          const flowlib = ctx.getFlowlib();

          const flow = await flowlib.flows.get(flowId);
          if (!flow) {
            return { status: 404, body: { error: `Flow ${flowId} not found` } };
          }

          const flowVersion = await flowlib.versions.get(flowId, version ?? 'latest');
          if (!flowVersion || !flowVersion.flowlibDefinition) {
            return { status: 404, body: { error: `Flow version not found` } };
          }

          const compileTarget = (target ?? effective.defaultTarget) as CompileTarget;

          const compileResult = compileFlow({
            definition: flowVersion.flowlibDefinition,
            flowId,
            flowName: flow.name,
            version: flowVersion.version,
            target: compileTarget,
            credentialStrategy: credentialStrategy ?? effective.defaultCredentialStrategy,
          });

          if (!compileResult.success) {
            return { status: 422, body: compileResult };
          }

          const files = scaffoldProject(compileResult, {
            projectName,
            flowName: flow.name,
            target: compileTarget,
          });

          return {
            status: 200,
            body: {
              success: true,
              files,
              warnings: compileResult.warnings,
              metadata: compileResult.metadata,
            },
          };
        },
      },

      // ── GET /cloudflare/preview/:flowId ───────────────────────────
      {
        method: 'GET',
        path: '/cloudflare/preview/:flowId',
        handler: async (ctx) => {
          const { flowId } = ctx.params;
          const target = (ctx.query.target ?? effective.defaultTarget) as CompileTarget;

          const flowlib = ctx.getFlowlib();

          const flow = await flowlib.flows.get(flowId);
          if (!flow) {
            return { status: 404, body: { error: `Flow ${flowId} not found` } };
          }

          const flowVersion = await flowlib.versions.get(flowId, 'latest');
          if (!flowVersion || !flowVersion.flowlibDefinition) {
            return { status: 404, body: { error: `Flow version not found` } };
          }

          const result = compileFlow({
            definition: flowVersion.flowlibDefinition,
            flowId,
            flowName: flow.name,
            version: flowVersion.version,
            target,
            credentialStrategy: 'env',
          });

          // Return just the workflow source for preview
          const workflowFile = result.files.find((f) => f.path === 'src/workflow.ts');

          return {
            status: 200,
            body: {
              success: result.success,
              source: workflowFile?.content ?? '',
              warnings: result.warnings,
              errors: result.errors,
              metadata: result.metadata,
            },
          };
        },
      },

      // ── GET /cloudflare/supported-actions ──────────────────────────
      {
        method: 'GET',
        path: '/cloudflare/supported-actions',
        handler: async (_ctx) => {
          return {
            status: 200,
            body: {
              nativeSupport: [
                'trigger.manual',
                'core.output',
                'core.model',
                'core.jq',
                'core.if_else',
                'core.template_string',
                'core.text',
                'http.request',
                'core.agent',
              ],
              passthroughFallback: true,
              description:
                'Actions not in the nativeSupport list will compile with a passthrough stub. ' +
                'You can implement custom action compilers or use the Flowlib runtime as a tool.',
            },
          };
        },
      },
    ],
  };
}
