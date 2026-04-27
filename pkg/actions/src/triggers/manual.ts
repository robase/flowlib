/**
 * trigger.manual — Manual Trigger action
 *
 * The primary entry-point node for flows. A flow may have at most one
 * Manual Trigger (enforced by `maxInstances: 1` and the flow validator).
 * It is invoked when the flow is started from the UI "Run" button, the
 * REST API, or programmatically via `startFlowRun()`.
 *
 * Accepts an optional **defaultInputs** JSON object — key/value pairs that
 * are used as the output when the flow is triggered manually (with no
 * external inputs).  When the flow is triggered from code, the caller's
 * inputs take precedence and are merged on top of the defaults.
 *
 * Downstream nodes can reference values via
 * `{{ manual_trigger.variableName }}`.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRIGGERS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  /**
   * Default input values used when the flow is triggered manually.
   * A plain JSON object like `{ "topic": "hello world", "count": 5 }`.
   * When the flow is triggered from code, the caller's inputs override
   * these defaults (missing keys fall back to the defaults here).
   */
  defaultInputs: z.record(z.string(), z.unknown()).optional(),
});

export const manualTriggerAction = defineAction({
  id: 'trigger.manual',
  name: 'Manual Trigger',
  description:
    'Start this flow manually from the UI, REST API, or programmatically via startFlowRun(). ' +
    'Optionally set Default Inputs — a JSON object of key/value pairs used when the flow is triggered manually. ' +
    "When triggered from code, the caller's values are used instead (merged on top of defaults). " +
    'This is a flow entry-point node — AI agents should not invoke it directly.\n\n' +
    'Example default inputs:\n' +
    '```json\n' +
    '{ "topic": "hello world", "severity": "medium" }\n' +
    '```',
  provider: TRIGGERS_PROVIDER,
  icon: 'Play',
  noInput: true,
  maxInstances: 1,
  tags: [
    'trigger',
    'manual',
    'start',
    'run',
    'execute',
    'begin',
    'launch',
    'input',
    'variable',
    'parameter',
    'entry',
  ],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'defaultInputs',
        label: 'Default Inputs',
        type: 'json',
        aiProvided: false,
        description:
          'Default input values used when running the flow manually. ' +
          'A plain JSON object — e.g. { "topic": "hello world" }. ' +
          "When triggered from code, the caller's values take precedence.",
        placeholder: '{ "topic": "hello world", "severity": "medium" }',
      },
    ],
  },

  async execute(params, context) {
    // Strip internal trigger keys before processing
    const flowInputs = { ...context.flowInputs };
    delete flowInputs.__triggerData;
    delete flowInputs.__triggerNodeId;

    const { defaultInputs } = params;

    context.logger.debug('Manual trigger fired', {
      inputKeys: Object.keys(flowInputs),
      hasDefaults: !!defaultInputs && Object.keys(defaultInputs).length > 0,
    });

    // Merge: defaultInputs provides fallbacks, flowInputs (from code) takes precedence.
    // When run manually (no external inputs), output is just the defaults.
    const output = { ...defaultInputs, ...flowInputs };

    return {
      success: true,
      output,
      metadata: { triggerType: 'manual' },
    };
  },
});
