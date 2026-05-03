/**
 * Trigger node helpers.
 *
 * Triggers are flow entry-points. A flow may have at most one `trigger.manual`,
 * but can have any number of `trigger.cron` and `trigger.webhook` nodes — when
 * a specific trigger fires, only that trigger node's downstream subtree runs;
 * other triggers and their subtrees are skipped.
 *
 * Both call forms supported:
 *   - `trigger.manual({ inputs: [...] })` / `trigger.cron({ expression })` — named form.
 *   - `trigger.manual('ref', { inputs })` / `trigger.cron('ref', { expression })` — positional.
 */

import { manualTriggerAction, cronTriggerAction } from '@flowlib/actions/triggers';
import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';

/**
 * Maps a declared input `type` to the TS type emitted at runtime by the
 * Manual Trigger action. Used by `ManualInputsShape` to derive a typed
 * record from a `const`-asserted `inputs` literal.
 */
type ManualInputTypeMap = {
  string: string;
  number: number;
  boolean: boolean;
  json: unknown;
};

export interface ManualInputDef<
  N extends string = string,
  T extends keyof ManualInputTypeMap = keyof ManualInputTypeMap,
> {
  /** Input variable name — referenced downstream as `{{ manual_trigger.<name> }}`. */
  name: N;
  /** Runtime type. Caller-provided values are coerced to this type. Defaults to `'string'`. */
  type?: T;
  /** Optional default value used when the caller doesn't supply this input. */
  defaultValue?: ManualInputTypeMap[T];
  /** Free-form description shown in the UI / surfaced to docs. */
  description?: string;
  /** When true, the run fails if the caller doesn't provide this input. */
  required?: boolean;
}

/**
 * Compile-time projection of a `const`-asserted `inputs` array into a
 * `{ <name>: <type> }` record. Authors get this for free when they write:
 *
 *   `trigger.manual({ inputs: [{ name: 'topic', type: 'string' }] as const })`
 */
export type ManualInputsShape<L extends readonly ManualInputDef[]> = {
  [K in L[number] as K['name']]: K['type'] extends keyof ManualInputTypeMap
    ? ManualInputTypeMap[K['type']]
    : string;
};

interface ManualParams<L extends readonly ManualInputDef[] = readonly ManualInputDef[]> {
  /** Declared inputs for this flow. Use `as const` to get name/type narrowing. */
  inputs?: L;
}

interface CronParams {
  expression: string;
  timezone?: string;
  staticInputs?: Record<string, unknown>;
}

function manual<const L extends readonly ManualInputDef[]>(
  params?: ManualParams<L>,
  options?: NodeOptions,
): SdkFlowNode;
function manual<const L extends readonly ManualInputDef[]>(
  referenceId: string,
  params?: ManualParams<L>,
  options?: NodeOptions,
): SdkFlowNode;
function manual(
  arg0?: string | ManualParams,
  arg1?: ManualParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const referenceId = typeof arg0 === 'string' ? arg0 : '';
  const params = (typeof arg0 === 'string' ? arg1 : arg0) as ManualParams | undefined;
  const options = (typeof arg0 === 'string' ? arg2 : arg1) as NodeOptions | undefined;

  return manualTriggerAction(
    referenceId,
    { inputs: (params?.inputs ?? []) as ManualInputDef[] },
    options,
  );
}

function cron(params: CronParams, options?: NodeOptions): SdkFlowNode;
function cron(referenceId: string, params: CronParams, options?: NodeOptions): SdkFlowNode;
function cron(
  arg0: string | CronParams,
  arg1?: CronParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const referenceId = typeof arg0 === 'string' ? arg0 : '';
  const params = (typeof arg0 === 'string' ? arg1 : arg0) as CronParams;
  const options = (typeof arg0 === 'string' ? arg2 : arg1) as NodeOptions | undefined;

  return cronTriggerAction(
    referenceId,
    {
      expression: params.expression,
      timezone: params.timezone ?? 'UTC',
      staticInputs: params.staticInputs,
    },
    options,
  );
}

export const trigger = { manual, cron } as const;
