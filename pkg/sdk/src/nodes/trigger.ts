/**
 * Trigger node helpers.
 *
 * Triggers are flow entry-points. A flow may have at most one `trigger.manual`,
 * but can have any number of `trigger.cron` and `trigger.webhook` nodes — when
 * a specific trigger fires, only that trigger node's downstream subtree runs;
 * other triggers and their subtrees are skipped.
 *
 * Both call forms supported:
 *   - `trigger.manual()` / `trigger.cron({ expression })` — named form.
 *   - `trigger.manual('ref')` / `trigger.cron('ref', { expression })` — positional.
 */

import { manualTriggerAction, cronTriggerAction } from '@flowlib/actions/triggers';
import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';

interface ManualParams {
  defaultInputs?: Record<string, unknown>;
}

interface CronParams {
  expression: string;
  timezone?: string;
  staticInputs?: Record<string, unknown>;
}

function manual(params?: ManualParams, options?: NodeOptions): SdkFlowNode;
function manual(referenceId: string, params?: ManualParams, options?: NodeOptions): SdkFlowNode;
function manual(
  arg0?: string | ManualParams,
  arg1?: ManualParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const referenceId = typeof arg0 === 'string' ? arg0 : '';
  const params = (typeof arg0 === 'string' ? arg1 : arg0) as ManualParams | undefined;
  const options = (typeof arg0 === 'string' ? arg2 : arg1) as NodeOptions | undefined;

  return manualTriggerAction(referenceId, { defaultInputs: params?.defaultInputs }, options);
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
