/**
 * core.input — Flow input action
 *
 * Emits a named input value for downstream nodes.
 * If flow inputs include the configured variable name, that value is used.
 * Otherwise, the configured default value is emitted.
 */

import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  variableName: z.string().min(1, 'Variable name is required').default('input'),
  defaultValue: z.string().default(''),
});

function parseIfJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export const inputAction = defineAction({
  id: 'core.input',
  name: 'Input',
  description:
    'Define a flow input variable with an optional default value. Use as the entry point of a flow to accept runtime data. If the caller supplies the named variable, that value is used; otherwise the configured default is emitted.',
  provider: CORE_PROVIDER,
  excludeFromTools: true,
  icon: 'LogIn',
  tags: ['input', 'entry', 'variable', 'flow', 'seed'],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'variableName',
        label: 'Variable Name',
        type: 'text',
        required: true,
        description: 'Flow input key to read from runtime inputs',
        placeholder: 'user_data',
      },
      {
        name: 'defaultValue',
        label: 'Default Value',
        type: 'textarea',
        required: false,
        description: 'Fallback value when runtime input is missing (JSON allowed)',
        placeholder: '{"name":"Alice"}',
      },
    ],
  },

  async execute(params, context) {
    const runtimeValue = context.flowInputs?.[params.variableName];
    const selectedValue = runtimeValue !== undefined ? runtimeValue : params.defaultValue;
    const outputValue = parseIfJson(selectedValue);

    return {
      success: true,
      output: outputValue,
      metadata: {
        variableName: params.variableName,
        source: runtimeValue !== undefined ? 'flow_input' : 'default_value',
      },
    };
  },
});
