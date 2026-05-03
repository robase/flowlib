/**
 * Core node helpers — ergonomic wrappers over the action callables in
 * `@flowlib/actions/core`.
 *
 * The underlying actions (exported as callable `ActionHelper`s from
 * `defineAction`) have strict signatures inferred from their Zod schemas.
 * These wrappers provide the author-friendly shapes users expect:
 *   - `input()` / `input('ref')` — no params required (schema defaults apply)
 *   - `output({ value })` / `output('ref', { value })` — `value` is an
 *     alias for `outputValue`
 *   - `code({ code })` / `code('ref', { code })` — matches the
 *     primitives-SDK name
 *
 * Every helper supports two call forms:
 *
 *   1. **Named-record form** (preferred): `input(params)` / `input()`. Used
 *      inside `defineFlow({ nodes: { event: input(...) } })` — the key
 *      becomes the referenceId, the helper itself doesn't need it.
 *   2. **Positional form** (legacy + array `defineFlow`): `input('ref', params)`.
 *
 * Each wrapper delegates to the real action helper, producing the same
 * `SdkFlowNode` shape and threading `NodeOptions` through untouched.
 *
 * The callable actions themselves remain exported (see `@flowlib/actions/core`)
 * for authors who want full Zod-strict typing.
 */

import {
  outputAction,
  javascriptAction,
  ifElseAction,
  switchAction,
  modelAction,
  agentAction,
} from '@flowlib/actions/core';
import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';
import type { ToolInstance } from '../tool';

// ═══════════════════════════════════════════════════════════════════════════
// Shared overload-discrimination
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discriminates the two call forms by the first argument:
 *   helper(referenceId: string, params, options?) — positional
 *   helper(params: object,             options?) — named-record
 *
 * For the named-record path, returns an empty `referenceId` — `defineFlow`
 * overwrites it from the object key.
 */
function splitArgs<P>(
  arg0: string | P | undefined,
  arg1: P | NodeOptions | undefined,
  arg2: NodeOptions | undefined,
): { referenceId: string; params: P; options: NodeOptions | undefined } {
  if (typeof arg0 === 'string') {
    return {
      referenceId: arg0,
      params: (arg1 ?? {}) as P,
      options: arg2,
    };
  }
  return {
    referenceId: '',
    params: (arg0 ?? {}) as P,
    options: arg1 as NodeOptions | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Code-expression form (string | arrow)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Code-bearing fields (`output.value`, `code.code`, `ifElse.condition`, and
 * each `switchNode` case's `expression`) accept either a string template /
 * JS expression, or a `(ctx) => ...` arrow that the save pipeline's
 * arrow-to-string transform converts to a runtime string.
 *
 * Both forms type-check; runtime stores strings only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeExpression<T = unknown> = string | ((ctx: any) => T);

// ═══════════════════════════════════════════════════════════════════════════
// output
// ═══════════════════════════════════════════════════════════════════════════

interface OutputParams {
  /** Output value — either a `{{ expr }}` template string or a `(ctx) => ...` arrow. */
  value: CodeExpression;
  name?: string;
}

/**
 * Flow output node.
 *
 * `value` supports `{{ expr }}` template syntax (JS, evaluated in QuickJS at
 * runtime).
 */
export function output(params: OutputParams, options?: NodeOptions): SdkFlowNode;
export function output(
  referenceId: string,
  params: OutputParams,
  options?: NodeOptions,
): SdkFlowNode;
export function output(
  arg0: string | OutputParams,
  arg1?: OutputParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const { referenceId, params, options } = splitArgs<OutputParams>(arg0, arg1, arg2);
  return outputAction(
    referenceId,
    {
      // Cast: outputAction's Zod schema declares `outputValue` as a string;
      // arrow values get converted by `transformArrowsToStrings` in the
      // save pipeline. Runtime never sees the function.
      outputValue: params.value as string,
      outputName: params.name ?? referenceId,
    },
    options,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// code / javascript
// ═══════════════════════════════════════════════════════════════════════════

interface CodeParams {
  /** JS expression — either a string of source or a `(ctx) => ...` arrow. */
  code: CodeExpression;
}

/**
 * Run a JavaScript expression/block in QuickJS.
 *
 * Today: pass a string of JS source (the runtime form).
 */
export function code(params: CodeParams, options?: NodeOptions): SdkFlowNode;
export function code(referenceId: string, params: CodeParams, options?: NodeOptions): SdkFlowNode;
export function code(
  arg0: string | CodeParams,
  arg1?: CodeParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const { referenceId, params, options } = splitArgs<CodeParams>(arg0, arg1, arg2);
  return javascriptAction(referenceId, { code: params.code as string }, options);
}

/** Alias matching the `javascript()` name used in `@flowlib/core/sdk`. */
export const javascript = code;

// ═══════════════════════════════════════════════════════════════════════════
// ifElse
// ═══════════════════════════════════════════════════════════════════════════

interface IfElseParams {
  /** Boolean expression — string or `(ctx) => boolean` arrow. */
  condition: CodeExpression<boolean>;
}

/**
 * Two-way conditional branching — edges from this node use source handles
 * `true_output` and `false_output`.
 */
export function ifElse(
  params: IfElseParams,
  options?: NodeOptions,
): SdkFlowNode<string, 'core.if_else', 'true_output' | 'false_output'>;
export function ifElse(
  referenceId: string,
  params: IfElseParams,
  options?: NodeOptions,
): SdkFlowNode<string, 'core.if_else', 'true_output' | 'false_output'>;
export function ifElse(
  arg0: string | IfElseParams,
  arg1?: IfElseParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode<string, 'core.if_else', 'true_output' | 'false_output'> {
  const { referenceId, params, options } = splitArgs<IfElseParams>(arg0, arg1, arg2);
  return ifElseAction(
    referenceId,
    { expression: params.condition as string },
    options,
  ) as SdkFlowNode<string, 'core.if_else', 'true_output' | 'false_output'>;
}

// ═══════════════════════════════════════════════════════════════════════════
// switchNode
// ═══════════════════════════════════════════════════════════════════════════

export interface SwitchCase<Slug extends string = string> {
  slug: Slug;
  label: string;
  /** Boolean expression — string or `(ctx) => boolean` arrow. */
  expression: CodeExpression<boolean>;
}

/**
 * Extract the per-case slug union from a `cases` tuple literal.
 *
 * `switchAction` declares `dynamicOutputs: true` at the runtime level
 * (handles depend on the user's `cases` array, not on a static `outputs`
 * tuple), so the SDK helper computes the handle union locally from the
 * caller's `cases` literal. Always includes `'default'` for the
 * fallthrough branch.
 */
type SwitchHandlesOf<C extends readonly SwitchCase[]> =
  | (C[number] extends { slug: infer S extends string } ? S : never)
  | 'default';

interface SwitchParams<C extends readonly SwitchCase[]> {
  cases: C;
  matchMode?: 'first' | 'all';
}

/**
 * Multi-way conditional branching. Edges use source handles that match each
 * case's `slug` (plus `default` for the fallthrough).
 *
 * The `const C` modifier captures the `cases` literal so each `slug` becomes
 * part of the node's handle union — `edge: { from: 'router', to: 'x', handle: 'unknown' }`
 * type-errors if `'unknown'` isn't one of the declared slugs (or `'default'`).
 */
export function switchNode<const C extends readonly SwitchCase[]>(
  params: SwitchParams<C>,
  options?: NodeOptions,
): SdkFlowNode<string, 'core.switch', SwitchHandlesOf<C>>;
export function switchNode<R extends string, const C extends readonly SwitchCase[]>(
  referenceId: R,
  params: SwitchParams<C>,
  options?: NodeOptions,
): SdkFlowNode<R, 'core.switch', SwitchHandlesOf<C>>;
export function switchNode<C extends readonly SwitchCase[]>(
  arg0: string | SwitchParams<C>,
  arg1?: SwitchParams<C> | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode<string, 'core.switch', SwitchHandlesOf<C>> {
  const { referenceId, params, options } = splitArgs<SwitchParams<C>>(arg0, arg1, arg2);
  return switchAction(
    referenceId,
    {
      // Cast: arrow expressions inside cases get converted to strings by
      // the save-pipeline's arrow-to-string transform; runtime stores
      // strings only.
      cases: params.cases.map((c) => ({
        slug: c.slug,
        label: c.label,
        expression: c.expression as string,
      })),
      matchMode: params.matchMode ?? 'first',
    },
    options,
  ) as unknown as SdkFlowNode<string, 'core.switch', SwitchHandlesOf<C>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// model
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelParams {
  credentialId: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  outputJsonSchema?: string;
  useBatchProcessing?: boolean;
}

/** Single-shot LLM call (OpenAI / Anthropic / OpenRouter). */
export function model(params: ModelParams, options?: NodeOptions): SdkFlowNode;
export function model(referenceId: string, params: ModelParams, options?: NodeOptions): SdkFlowNode;
export function model(
  arg0: string | ModelParams,
  arg1?: ModelParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const { referenceId, params, options } = splitArgs<ModelParams>(arg0, arg1, arg2);
  return modelAction(
    referenceId,
    {
      credentialId: params.credentialId,
      model: params.model,
      prompt: params.prompt,
      systemPrompt: params.systemPrompt ?? '',
      provider: params.provider,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens,
      outputJsonSchema: params.outputJsonSchema,
      useBatchProcessing: params.useBatchProcessing ?? false,
    } as Parameters<typeof modelAction>[1],
    options,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// agent
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentParams {
  credentialId: string;
  model: string;
  taskPrompt: string;
  systemPrompt?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  stopCondition?: 'explicit_stop' | 'tool_result' | 'max_iterations';
  toolTimeoutMs?: number;
  maxConversationTokens?: number;
  enableParallelTools?: boolean;
  useBatchProcessing?: boolean;
  /** Attached tools as `tool()` instances. `instanceId` is assigned at save time. */
  addedTools?: ToolInstance[];
}

/**
 * Iterative agent node — runs an LLM tool-calling loop.
 *
 * Tools are declared via the `tool()` helper in `addedTools`. The save pipeline
 * assigns stable `instanceId`s by matching against the prior version; new
 * tools get fresh ids.
 */
export function agent(params: AgentParams, options?: NodeOptions): SdkFlowNode;
export function agent(referenceId: string, params: AgentParams, options?: NodeOptions): SdkFlowNode;
export function agent(
  arg0: string | AgentParams,
  arg1?: AgentParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const { referenceId, params, options } = splitArgs<AgentParams>(arg0, arg1, arg2);
  return agentAction(referenceId, params as unknown as Parameters<typeof agentAction>[1], options);
}
