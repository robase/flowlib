/**
 * Generic node escape hatch.
 *
 * Use this when you need to reference an action type by its string id without
 * importing the action callable — e.g. when pasting LLM output that references
 * a plugin-provided action the current project hasn't imported yet. Always
 * prefer importing the real action callable when available; `node()` loses the
 * Zod-inferred param types.
 *
 * Two call forms:
 *   - `node('action.id', { ... })` — named-record `defineFlow` form.
 *     Pass the action type as the first arg; `defineFlow` injects the
 *     referenceId from the object key.
 *   - `node('ref', 'action.id', { ... })` — positional form.
 */

import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';

export function node<TParams extends Record<string, unknown>>(
  type: string,
  params?: TParams,
  options?: NodeOptions,
): SdkFlowNode;
export function node<TParams extends Record<string, unknown>>(
  referenceId: string,
  type: string,
  params?: TParams,
  options?: NodeOptions,
): SdkFlowNode;
export function node<TParams extends Record<string, unknown>>(
  arg0: string,
  arg1?: string | TParams,
  arg2?: TParams | NodeOptions,
  arg3?: NodeOptions,
): SdkFlowNode {
  // Discriminate on whether arg1 is a string (= type, positional form) or
  // an object/undefined (= params, named form).
  let referenceId: string;
  let type: string;
  let params: TParams;
  let options: NodeOptions | undefined;
  if (typeof arg1 === 'string') {
    referenceId = arg0;
    type = arg1;
    params = ((arg2 as TParams | undefined) ?? ({} as TParams)) as TParams;
    options = arg3;
  } else {
    referenceId = '';
    type = arg0;
    params = ((arg1 as TParams | undefined) ?? ({} as TParams)) as TParams;
    options = arg2 as NodeOptions | undefined;
  }
  const n: SdkFlowNode = {
    referenceId,
    type,
    params: params as Record<string, unknown>,
  };
  if (options?.label !== undefined) {
    n.label = options.label;
  }
  if (options?.position !== undefined) {
    n.position = options.position;
  }
  if (options?.id !== undefined) {
    n.id = options.id;
  }
  if (options?.mapper !== undefined) {
    n.mapper = {
      enabled: options.mapper.enabled ?? true,
      expression: options.mapper.expression,
      mode: options.mapper.mode ?? 'auto',
      outputMode: options.mapper.outputMode ?? 'array',
      ...(options.mapper.keyField !== undefined ? { keyField: options.mapper.keyField } : {}),
      concurrency: options.mapper.concurrency ?? 1,
      onEmpty: options.mapper.onEmpty ?? 'skip',
    };
  }
  return n;
}
