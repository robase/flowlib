// ============================================================================
// @flowlib/cloudflare-agents — backend plugin
//
// Adds API endpoints to compile Flowlib flows into Cloudflare Agent/Workflow
// projects. No database tables required — compilation is stateless.
// ============================================================================

import type { FlowlibPlugin, FlowlibPluginDefinition } from '@flowlib/core/types';
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
  const defaultTarget = options?.defaultTarget ?? 'agent-workflow';
  const defaultCredentialStrategy = options?.defaultCredentialStrategy ?? 'env';

  return {
    id: 'cloudflare-agents',
    name: 'Cloudflare Agents',

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
            target: (target ?? defaultTarget) as CompileTarget,
            credentialStrategy: credentialStrategy ?? defaultCredentialStrategy,
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

          const compileTarget = (target ?? defaultTarget) as CompileTarget;

          const compileResult = compileFlow({
            definition: flowVersion.flowlibDefinition,
            flowId,
            flowName: flow.name,
            version: flowVersion.version,
            target: compileTarget,
            credentialStrategy: credentialStrategy ?? defaultCredentialStrategy,
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
          const target = (ctx.query.target ?? defaultTarget) as CompileTarget;

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
