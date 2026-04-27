/**
 * Template-string node helper.
 *
 * `core.template_string` — renders a string with `{{ expr }}` interpolations
 * evaluated against upstream node outputs.
 *
 * Two call forms:
 *   - `template({ template: '...' })` — named-record `defineFlow` form.
 *   - `template('ref', { template: '...' })` — positional form.
 */

import { templateStringAction } from '@flowlib/actions/core';
import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';

interface TemplateParams {
  template: string;
}

export function template(params: TemplateParams, options?: NodeOptions): SdkFlowNode;
export function template(
  referenceId: string,
  params: TemplateParams,
  options?: NodeOptions,
): SdkFlowNode;
export function template(
  arg0: string | TemplateParams,
  arg1?: TemplateParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  if (typeof arg0 === 'string') {
    return templateStringAction(arg0, { template: (arg1 as TemplateParams).template }, arg2);
  }
  return templateStringAction('', { template: arg0.template }, arg1 as NodeOptions | undefined);
}
