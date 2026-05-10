/**
 * Backend endpoints for `@flowlib/vercel-workflows`.
 *
 * The Deploy button in the flow editor calls these routes to fetch the two
 * pieces of source the user copy-pastes into their Next.js app:
 *
 *   GET /vercel-workflows/preview/:flowId
 *     → { success, workflowSource, sdkSource, warnings, metadata }
 *
 *   GET /vercel-workflows/supported-actions
 *     → { nativeSupport, description }
 *
 * No state is persisted — compilation is deterministic from the flow version.
 */
import type { FlowlibPlugin, FlowlibDefinition, FlowNodeDefinitions } from '@flowlib/core';
import { emitSdkSource } from '@flowlib/sdk';
import { compile } from '../compiler/flow-compiler';

const OUTPUT_TYPES = new Set(['core.output', 'primitives.output']);

function isTriggerNode(node: FlowNodeDefinitions): boolean {
  return node.type.startsWith('trigger.');
}

function isOutputNode(node: FlowNodeDefinitions): boolean {
  return OUTPUT_TYPES.has(node.type);
}

// Vercel workflows treat trigger nodes as implicit (their role is fulfilled by
// the workflow function's `__inputs` arg) and output nodes as implicit (their
// role is fulfilled by the returned `flowOutputs` object). Strip both from the
// primitives flow so the SDK/compile passes don't see unsupported types, and
// return the output assignments separately so the workflow compiler can inject
// `flowOutputs[name] = completedOutputs[upstream]` at the tail of the
// orchestrator.
//
// When `activeTriggerId` is provided, the graph is first restricted to the
// subgraph reachable from that trigger — needed when a flow has multiple
// triggers, since the compiled workflow has a single entry.
function stripTriggersAndOutputs(
  def: FlowlibDefinition,
  activeTriggerId?: string,
): {
  filtered: FlowlibDefinition;
  outputAssignments: Array<{ outputName: string; upstreamRef: string }>;
} {
  const refById = new Map(def.nodes.map((n) => [n.id, n.referenceId ?? n.id]));

  // Restrict to the reachable subgraph from the active trigger, if specified.
  const reachable = activeTriggerId
    ? collectReachable(activeTriggerId, def.edges)
    : new Set(def.nodes.map((n) => n.id));

  const scopedNodes = def.nodes.filter((n) => reachable.has(n.id));
  const scopedEdges = def.edges.filter((e) => reachable.has(e.source) && reachable.has(e.target));

  const triggerIds = new Set(scopedNodes.filter(isTriggerNode).map((n) => n.id));
  const outputNodes = scopedNodes.filter(isOutputNode);
  const outputIds = new Set(outputNodes.map((n) => n.id));
  const skipIds = new Set([...triggerIds, ...outputIds]);

  const outputAssignments = outputNodes
    .map((outNode) => {
      const incoming = scopedEdges.find((e) => e.target === outNode.id);
      const upstreamRef = incoming ? refById.get(incoming.source) : undefined;
      const outputName =
        typeof outNode.params.outputName === 'string' && outNode.params.outputName.length > 0
          ? (outNode.params.outputName as string)
          : (outNode.referenceId ?? outNode.id);
      if (!upstreamRef) {
        return null;
      }
      return { outputName, upstreamRef };
    })
    .filter((x): x is { outputName: string; upstreamRef: string } => x !== null);

  const filtered: FlowlibDefinition = {
    nodes: scopedNodes.filter((n) => !skipIds.has(n.id)),
    edges: scopedEdges.filter((e) => !skipIds.has(e.source) && !skipIds.has(e.target)),
    metadata: def.metadata,
  };

  return { filtered, outputAssignments };
}

// BFS forward from `startId` over directed edges; `startId` is included.
function collectReachable(startId: string, edges: FlowlibDefinition['edges']): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const list = outgoing.get(e.source);
    if (list) {
      list.push(e.target);
    } else {
      outgoing.set(e.source, [e.target]);
    }
  }
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) {
      break;
    }
    for (const target of outgoing.get(next) ?? []) {
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return visited;
}

export interface VercelWorkflowsBackendOptions {
  /** Import path the generated workflow file will use to reach the SDK flow. */
  defaultFlowImport?: string;
  /** Import path to the user's flow config (`getFlowConfig`). */
  defaultConfigImport?: string;
}

/** Mutable runtime config — exported so the wrapping plugin can subscribe to settings changes. */
export interface VercelWorkflowsEffectiveConfig {
  defaultFlowImport: string;
  defaultConfigImport: string;
}

export function buildBackendPlugin(
  options: VercelWorkflowsBackendOptions = {},
): { plugin: FlowlibPlugin; effective: VercelWorkflowsEffectiveConfig } {
  const effective: VercelWorkflowsEffectiveConfig = {
    defaultFlowImport: options.defaultFlowImport ?? './flow',
    defaultConfigImport: options.defaultConfigImport ?? './flow.config',
  };

  const plugin: FlowlibPlugin = {
    id: 'vercel-workflows',
    name: 'Vercel Workflows',

    endpoints: [
      {
        method: 'GET',
        path: '/vercel-workflows/preview/:flowId',
        handler: async (ctx) => {
          const { flowId } = ctx.params;
          if (!flowId) {
            return { status: 400, body: { error: 'flowId is required' } };
          }

          const flowlib = ctx.getFlowlib();
          const flow = await flowlib.flows.get(flowId);
          if (!flow) {
            return { status: 404, body: { error: `Flow ${flowId} not found` } };
          }

          const version = ctx.query.version ?? 'latest';
          const flowVersion = await flowlib.versions.get(flowId, version);
          if (!flowVersion?.flowlibDefinition) {
            return { status: 404, body: { error: `Flow version not found` } };
          }
          const definition = flowVersion.flowlibDefinition as FlowlibDefinition;

          // Derive both identifiers from a single camelCased base. Strip a
          // trailing "Flow" from the flow name (e.g. "Untitled Flow") so the
          // export doesn't become "untitledFlowFlow" when we add the suffix.
          const base = stripTrailingFlow(toCamelCase(flow.name || 'my'));
          const workflowName = `${base || 'my'}Workflow`;
          const flowExport = `${base || 'my'}Flow`;

          // A flow may have multiple trigger nodes (e.g. cron + webhook), but
          // a Vercel Workflow has a single entry. Require the caller to name
          // which trigger's subgraph to compile when more than one exists.
          const triggerNodes = definition.nodes.filter(isTriggerNode);
          const requestedTriggerId =
            typeof ctx.query.triggerNodeId === 'string' ? ctx.query.triggerNodeId : undefined;

          let activeTriggerId: string | undefined;
          if (triggerNodes.length > 1) {
            if (!requestedTriggerId) {
              return {
                status: 400,
                body: {
                  success: false,
                  error:
                    'Flow has multiple triggers. Pass ?triggerNodeId=<id> to select which trigger subgraph to compile.',
                  stage: 'select-trigger',
                  triggers: triggerNodes.map((n) => ({
                    id: n.id,
                    type: n.type,
                    referenceId: n.referenceId,
                  })),
                },
              };
            }
            const match = triggerNodes.find((n) => n.id === requestedTriggerId);
            if (!match) {
              return {
                status: 400,
                body: {
                  success: false,
                  error: `triggerNodeId "${requestedTriggerId}" does not match any trigger node in this flow.`,
                  stage: 'select-trigger',
                  triggers: triggerNodes.map((n) => ({
                    id: n.id,
                    type: n.type,
                    referenceId: n.referenceId,
                  })),
                },
              };
            }
            activeTriggerId = match.id;
          } else if (triggerNodes.length === 1) {
            activeTriggerId = triggerNodes[0].id;
          }

          const { filtered, outputAssignments } = stripTriggersAndOutputs(
            definition,
            activeTriggerId,
          );

          let sdkSource: string;
          try {
            const sdkResult = emitSdkSource(filtered as Parameters<typeof emitSdkSource>[0], {
              flowName: flowExport,
            });
            sdkSource = sdkResult.code;
          } catch (error) {
            return {
              status: 422,
              body: {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                stage: 'sdk-emit',
              },
            };
          }

          try {
            const compileResult = compile(
              {
                nodes: filtered.nodes.map((n) => ({
                  referenceId: n.referenceId ?? n.id,
                  type: n.type,
                  params: n.params as Record<string, unknown>,
                })),
                edges: filtered.edges.map((e) =>
                  e.sourceHandle
                    ? [
                        edgeRef(filtered.nodes, e.source),
                        edgeRef(filtered.nodes, e.target),
                        e.sourceHandle,
                      ]
                    : [edgeRef(filtered.nodes, e.source), edgeRef(filtered.nodes, e.target)],
                ),
              },
              {
                workflowName,
                flowImport: ctx.query.flowImport ?? effective.defaultFlowImport,
                flowExport,
                configImport: ctx.query.configImport ?? effective.defaultConfigImport,
                configExport: 'getFlowConfig',
                // Inject flow-output assignments sourced from upstream step results.
                orchestratorTail: outputAssignments.map(
                  ({ outputName, upstreamRef }) =>
                    `  flowOutputs[${JSON.stringify(outputName)}] = completedOutputs[${JSON.stringify(upstreamRef)}];`,
                ),
              },
            );

            return {
              status: 200,
              body: {
                success: true,
                workflowSource: compileResult.code,
                sdkSource,
                warnings: compileResult.warnings,
                metadata: {
                  stepCount: compileResult.stepCount,
                  outputCount: compileResult.outputCount,
                  workflowName,
                  flowExport,
                  activeTriggerId,
                },
              },
            };
          } catch (error) {
            return {
              status: 422,
              body: {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                stage: 'compile',
                sdkSource,
              },
            };
          }
        },
      },

      {
        method: 'GET',
        path: '/vercel-workflows/supported-actions',
        handler: async () => ({
          status: 200,
          body: {
            nativeSupport: [
              'trigger.manual',
              'core.output',
              'core.javascript',
              'core.if_else',
              'core.switch',
              'primitives.output',
              'primitives.javascript',
              'primitives.if_else',
              'primitives.switch',
            ],
            description:
              'Only primitive action types compile to Vercel Workflows. Integration actions ' +
              '(gmail, slack, http, etc.) require either a companion Flowlib runtime call from ' +
              'inside the workflow or must be replaced with equivalent fetch-based code nodes.',
          },
        }),
      },
    ],
  };

  return { plugin, effective };
}

function edgeRef(nodes: ReadonlyArray<{ id: string; referenceId?: string }>, id: string): string {
  const match = nodes.find((n) => n.id === id);
  return match?.referenceId ?? match?.id ?? id;
}

// Split on anything non-alphanumeric, lowercase the first segment, title-case
// the rest, then join. Drops punctuation/whitespace so user-entered names like
// "My Flow!" come out as "myFlow".
function toCamelCase(input: string): string {
  const segments = input.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (segments.length === 0) {
    return '';
  }
  const joined = segments
    .map((s, i) =>
      i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join('');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

// Remove a trailing "Flow" (case-insensitive) so the generated flow export
// name doesn't double up when we re-append the "Flow" / "Workflow" suffix.
function stripTrailingFlow(input: string): string {
  return input.replace(/Flow$/i, '');
}
