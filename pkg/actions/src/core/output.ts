/**
 * core.output — Flow Output action
 *
 * Returns data from the flow. The output value is expected to already be
 * template-resolved by the coordinator (or uses the template function directly).
 */

import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  outputValue: z.string().default(''),
  outputName: z.string().default('result'),
});

export const outputAction = defineAction({
  id: 'core.output',
  name: 'Flow Output',
  description:
    'Return a named output value from the flow. Use as the terminal node to define what data the flow produces for callers. The output value supports {{ expression }} template syntax to reference upstream node data.',
  provider: CORE_PROVIDER,
  excludeFromTools: true,
  icon: 'LogOut',
  tags: ['output', 'return', 'result', 'end', 'response', 'data'],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'outputValue',
        label: 'Output Value',
        type: 'textarea',
        required: true,
        description:
          'The value to output from the flow. Use {{ expression }} templates to reference upstream node data.',
        placeholder: '{{ model_node.data.variables.modelOutput.value }}',
      },
      {
        name: 'outputName',
        label: 'Output Name',
        type: 'text',
        description: 'Name for the output variable (default: result)',
        defaultValue: 'result',
      },
    ],
  },

  async execute(params, context) {
    const { outputName, outputValue } = params;

    context.logger.debug('Output action collected value', {
      outputName,
      valuePreview: outputValue.substring(0, 100),
    });

    return {
      success: true,
      output: outputValue,
      metadata: {
        outputName,
        nodeId: context.flowContext?.nodeId,
      },
    };
  },
});
