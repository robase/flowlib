/**
 * trigger.manual — Manual Trigger action
 *
 * The primary entry-point node for flows. A flow may have at most one
 * Manual Trigger (enforced by `maxInstances: 1` and the flow validator).
 * It is invoked when the flow is started from the UI "Run" button, the
 * REST API, or programmatically via `startFlowRun()`.
 *
 * Declares the flow's input schema as a structured list — each input has a
 * name, a type (`string` | `number` | `boolean` | `json`), an optional
 * default value, and an optional `required` flag. At runtime, each declared
 * input is resolved against the caller-provided `flowInputs`; missing
 * non-required inputs fall back to `defaultValue`; missing required inputs
 * fail the run.
 *
 * Downstream nodes reference values via `{{ manual_trigger.<name> }}`.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRIGGERS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const inputTypeSchema = z.enum(['string', 'number', 'boolean', 'json']);

const inputDefSchema = z.object({
  /** Input variable name — referenced downstream as `{{ manual_trigger.<name> }}`. */
  name: z.string().min(1, 'Input name is required'),
  /** Runtime type. Caller-provided values are coerced to this type. */
  type: inputTypeSchema.default('string'),
  /** Optional default value used when the caller doesn't provide this input. */
  defaultValue: z.unknown().optional(),
  /** Free-form description shown in the UI / surfaced to docs. */
  description: z.string().optional(),
  /** When true, the run fails if the caller doesn't provide this input. */
  required: z.boolean().default(false),
});

const paramsSchema = z.object({
  /**
   * Declared inputs for this flow. Each entry defines a named input with an
   * optional default. Caller-provided values (`flowInputs`) override defaults;
   * undeclared keys still pass through to downstream nodes.
   */
  inputs: z.array(inputDefSchema).default([]),
});

export type ManualTriggerInputDef = z.infer<typeof inputDefSchema>;

function coerceValue(value: unknown, type: ManualTriggerInputDef['type']): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  switch (type) {
    case 'string':
      return typeof value === 'string' ? value : String(value);
    case 'number': {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
      }
      return value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (v === 'true') {
          return true;
        }
        if (v === 'false') {
          return false;
        }
      }
      return value;
    }
    case 'json': {
      if (typeof value !== 'string') {
        return value;
      }
      const trimmed = value.trim();
      if (trimmed === '') {
        return value;
      }
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
  }
}

export const manualTriggerAction = defineAction({
  id: 'trigger.manual',
  name: 'Manual Trigger',
  description:
    'Start this flow manually from the UI, REST API, or programmatically via startFlowRun(). ' +
    "Declare the flow's inputs as a structured list — each entry has a name, type, and optional " +
    'default value. Caller-supplied inputs override defaults; missing required inputs fail the run. ' +
    'Downstream nodes reference values via `{{ manual_trigger.<name> }}`. ' +
    'This is a flow entry-point node — AI agents should not invoke it directly.',
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
        name: 'inputs',
        label: 'Inputs',
        type: 'json',
        aiProvided: false,
        description:
          'Declared inputs for this flow. Array of objects: { name, type ("string"|"number"|"boolean"|"json"), defaultValue?, description?, required? }. ' +
          'Caller-supplied values override defaults; missing required inputs fail the run.',
        placeholder:
          '[\n  { "name": "topic", "type": "string", "defaultValue": "hello world" },\n  { "name": "count", "type": "number", "required": true }\n]',
      },
    ],
  },

  async execute(params, context) {
    const flowInputs = { ...context.flowInputs };
    delete flowInputs.__triggerData;
    delete flowInputs.__triggerNodeId;

    const declared = params.inputs ?? [];
    const output: Record<string, unknown> = { ...flowInputs };
    const missingRequired: string[] = [];

    for (const def of declared) {
      const provided = Object.prototype.hasOwnProperty.call(flowInputs, def.name)
        ? flowInputs[def.name]
        : undefined;

      if (provided !== undefined) {
        output[def.name] = coerceValue(provided, def.type);
        continue;
      }

      if (def.defaultValue !== undefined) {
        output[def.name] = coerceValue(def.defaultValue, def.type);
        continue;
      }

      if (def.required) {
        missingRequired.push(def.name);
      }
    }

    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `Manual trigger missing required inputs: ${missingRequired.join(', ')}`,
      };
    }

    context.logger.debug('Manual trigger fired', {
      declaredCount: declared.length,
      providedKeys: Object.keys(flowInputs),
    });

    return {
      success: true,
      output,
      metadata: { triggerType: 'manual' },
    };
  },
});
