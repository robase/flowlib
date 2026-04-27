import type { ActionDefinition, ActionExecutionContext, ActionResult } from '@flowlib/action-kit';
import { BaseLogger } from '@flowlib/core';
import type { PrimitiveNode, NodeContext, FlowRunnerConfig } from './types';

// ─── Param resolution ─────────────────────────────────────────────────────────

// Recursively resolves callable values within params.
// Handles top-level functions, arrays of objects (e.g. switch cases), and plain objects.
export async function resolveCallableParams(
  params: Record<string, unknown>,
  ctx: NodeContext,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = await resolveValue(value, ctx);
  }
  return result;
}

async function resolveValue(value: unknown, ctx: NodeContext): Promise<unknown> {
  if (typeof value === 'function') {
    return value(ctx);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveValue(item, ctx)));
  }
  if (value !== null && typeof value === 'object' && !isPlainResolvedObject(value)) {
    const obj = value as Record<string, unknown>;
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = await resolveValue(v, ctx);
    }
    return resolved;
  }
  return value;
}

function isPlainResolvedObject(value: object): boolean {
  // Don't recurse into class instances — only plain objects need recursive resolution
  const proto = Object.getPrototypeOf(value);
  return proto !== Object.prototype && proto !== null;
}

// ─── JSON string coercion ────────────────────────────────────────────────────

function coerceJsonStringParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        result[key] = undefined;
        continue;
      }
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          result[key] = JSON.parse(trimmed);
          continue;
        } catch {
          // Not valid JSON — keep as string
        }
      }
    }
    result[key] = value;
  }
  return result;
}

// ─── Action execution ─────────────────────────────────────────────────────────

export interface ExecuteNodeOptions {
  node: PrimitiveNode;
  resolvedCtx: NodeContext;
  resolvedParams: Record<string, unknown>;
  config: FlowRunnerConfig;
  flowRunId: string;
  flowInputs: Record<string, unknown>;
  registry: Map<string, ActionDefinition>;
}

export async function executeNodeAction(opts: ExecuteNodeOptions): Promise<ActionResult> {
  const { node, resolvedCtx, resolvedParams, config, flowRunId, flowInputs, registry } = opts;

  const action = registry.get(node.type);
  if (!action) {
    throw new Error(`Unknown action type: "${node.type}". Is this action registered?`);
  }

  const logger = new BaseLogger({ level: 'info' });

  // Coerce JSON-string params (e.g. textarea editors that store arrays as JSON strings)
  const coerced = coerceJsonStringParams(resolvedParams);

  // Zod validation
  const parseResult = action.params.schema.safeParse(coerced);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Param validation failed for "${node.type}" (${node.referenceId}): ${issues}`);
  }

  // Build ActionExecutionContext
  const context: ActionExecutionContext = {
    logger,
    credential: null,
    incomingData: resolvedCtx as Record<string, unknown>,
    flowInputs,
    flowContext: {
      flowId: 'primitives',
      flowRunId,
      nodeId: node.referenceId,
    },
    functions: {
      getCredential: (() => {
        const resolveCredential = config.resolveCredential;
        if (!resolveCredential) {
          return undefined;
        }
        return async (credentialId: string) => {
          const raw = await resolveCredential(credentialId);
          return {
            id: credentialId,
            name: credentialId,
            type: 'api_key',
            authType: 'api_key',
            config: raw,
          };
        };
      })(),
      submitPrompt: config.submitPrompt,
      submitAgentPrompt: config.submitAgentPrompt,
      evaluator: config.jsEvaluator,
    },
  };

  // Resolve credential if the action declares one and params have a credentialId
  if (
    action.credential?.required &&
    typeof coerced.credentialId === 'string' &&
    config.resolveCredential
  ) {
    const raw = await config.resolveCredential(coerced.credentialId as string);
    context.credential = {
      id: coerced.credentialId as string,
      name: coerced.credentialId as string,
      type: action.credential.type ?? 'api_key',
      authType: action.credential.type ?? 'api_key',
      config: raw,
    };
  }

  return action.execute(parseResult.data as never, context);
}
