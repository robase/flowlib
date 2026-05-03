import { newToolInstanceId } from '@flowlib/action-kit';
import type {
  PrimitiveNode,
  PrimitiveEdge,
  PrimitiveFlowDefinition,
  NodeContext,
  ParamValue,
} from './types';
import { validateFlow } from './validate';

// ─── defineFlow ───────────────────────────────────────────────────────────────

export function defineFlow(def: PrimitiveFlowDefinition): PrimitiveFlowDefinition {
  validateFlow(def);
  return def;
}

// ─── Node builders ────────────────────────────────────────────────────────────

export interface ManualTriggerInputDef {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'json';
  defaultValue?: unknown;
  description?: string;
  required?: boolean;
}

export function triggerManual(
  referenceId: string,
  params?: {
    inputs?: ManualTriggerInputDef[];
  },
): PrimitiveNode {
  return {
    referenceId,
    type: 'trigger.manual',
    params: { inputs: (params?.inputs ?? []) as unknown as ParamValue<unknown> },
  };
}

export function output(
  referenceId: string,
  params: {
    value: ParamValue<unknown>;
    name?: string;
  },
): PrimitiveNode {
  return {
    referenceId,
    type: 'primitives.output',
    params: {
      outputValue: params.value,
      outputName: params.name ?? referenceId,
    },
  };
}

export function model(
  referenceId: string,
  params: {
    credentialId: ParamValue<string>;
    model: ParamValue<string>;
    prompt: ParamValue<string>;
    systemPrompt?: ParamValue<string>;
    provider?: ParamValue<string>;
    temperature?: ParamValue<number>;
    maxTokens?: ParamValue<number>;
    outputJsonSchema?: ParamValue<string>;
    useBatchProcessing?: boolean;
  },
): PrimitiveNode {
  return {
    referenceId,
    type: 'core.model',
    params: params as Record<string, ParamValue<unknown>>,
  };
}

export function ifElse(
  referenceId: string,
  params: {
    condition: (ctx: NodeContext) => boolean | Promise<boolean>;
    mapper?: (ctx: NodeContext) => NodeContext | Promise<NodeContext>;
  },
): PrimitiveNode {
  const { mapper, ...rest } = params;
  return {
    referenceId,
    type: 'primitives.if_else',
    params: { condition: rest.condition as ParamValue<unknown> },
    ...(mapper ? { mapper } : {}),
  };
}

export function switchNode(
  referenceId: string,
  params: {
    cases: Array<{
      slug: string;
      label: string;
      condition: (ctx: NodeContext) => boolean | Promise<boolean>;
    }>;
    matchMode?: 'first' | 'all';
    mapper?: (ctx: NodeContext) => NodeContext | Promise<NodeContext>;
  },
): PrimitiveNode {
  const { mapper, ...rest } = params;
  return {
    referenceId,
    type: 'primitives.switch',
    params: {
      cases: rest.cases as ParamValue<unknown>,
      matchMode: rest.matchMode ?? 'first',
    },
    ...(mapper ? { mapper } : {}),
  };
}

export interface ToolInstance {
  toolId: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
}

/**
 * Declare a tool instance for an agent's `tools` array. The runtime-level
 * `instanceId` is assigned automatically by `agent()` (duplicates of the same
 * `toolId` within one agent get `_2`, `_3` suffixes).
 *
 * @example
 * agent('triage', {
 *   credentialId: '{{ env.ANTHROPIC }}',
 *   model: 'claude-sonnet-4-6',
 *   tools: [
 *     tool('github.search_issues', {
 *       description: 'Look for existing issues before filing new ones',
 *       params: { perPage: 10 },
 *     }),
 *   ],
 * });
 */
export function tool(
  toolId: string,
  options?: {
    /** Display name surfaced to the LLM. Defaults to `toolId`. */
    name?: string;
    /** Tool description surfaced to the LLM. Defaults to empty string. */
    description?: string;
    /** Static params bound to every call of this tool instance. */
    params?: Record<string, unknown>;
  },
): ToolInstance {
  return {
    toolId,
    name: options?.name ?? toolId,
    description: options?.description ?? '',
    params: options?.params ?? {},
  };
}

// Assign runtime-level `instanceId`s using the canonical `tool_XXXXXXXX`
// format shared with the chat agent tools, the editor tool panel, and seed
// fixtures — see `newToolInstanceId` in `@flowlib/action-kit`.
function assignToolInstanceIds(
  tools: ToolInstance[],
): Array<ToolInstance & { instanceId: string }> {
  return tools.map((t) => ({ instanceId: newToolInstanceId(), ...t }));
}

export function agent(
  referenceId: string,
  params: {
    credentialId: ParamValue<string>;
    model: ParamValue<string>;
    systemPrompt?: ParamValue<string>;
    messages?: ParamValue<unknown>;
    tools?: ToolInstance[];
    temperature?: ParamValue<number>;
    maxTokens?: ParamValue<number>;
    maxIterations?: ParamValue<number>;
    mapper?: (ctx: NodeContext) => NodeContext | Promise<NodeContext>;
  },
): PrimitiveNode {
  const { mapper, tools, ...rest } = params;
  const resolved: Record<string, ParamValue<unknown>> = {
    ...(rest as Record<string, ParamValue<unknown>>),
    ...(tools ? { tools: assignToolInstanceIds(tools) } : {}),
  };
  return {
    referenceId,
    type: 'core.agent',
    params: resolved,
    ...(mapper ? { mapper } : {}),
  };
}

export function code(
  referenceId: string,
  params: {
    code: (ctx: NodeContext) => unknown | Promise<unknown>;
    mapper?: (ctx: NodeContext) => NodeContext | Promise<NodeContext>;
  },
): PrimitiveNode {
  const { mapper, ...rest } = params;
  return {
    referenceId,
    type: 'primitives.javascript',
    // The executor resolves callable params — so `result` is the resolved return value of code(ctx)
    params: { result: rest.code as ParamValue<unknown> },
    ...(mapper ? { mapper } : {}),
  };
}

/** Alias of `code()` — matches the `javascript()` name used in `@flowlib/core/sdk`. */
export const javascript = code;

// Generic node builder for action types without a dedicated helper (e.g.
// integration providers). The returned node is a plain `PrimitiveNode` whose
// params are stored as-is; runtime execution relies on the action with the
// same id being registered in the flow runner.
export function node(
  referenceId: string,
  type: string,
  params: Record<string, ParamValue<unknown>> = {},
  options?: { mapper?: (ctx: NodeContext) => NodeContext | Promise<NodeContext> },
): PrimitiveNode {
  return {
    referenceId,
    type,
    params,
    ...(options?.mapper ? { mapper: options.mapper } : {}),
  };
}

// ─── Edge helpers ─────────────────────────────────────────────────────────────

export function edge(source: string, target: string, sourceHandle?: string): PrimitiveEdge {
  return sourceHandle
    ? { from: source, to: target, handle: sourceHandle }
    : { from: source, to: target };
}
