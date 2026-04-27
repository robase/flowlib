import { defineAction } from '@flowlib/action-kit';
import { z } from 'zod/v4';

const PROVIDER = {
  id: 'primitives',
  name: 'Primitives',
  icon: 'LogOut',
  category: 'core' as const,
  nodeCategory: 'IO' as const,
};

// Uses z.unknown() instead of z.string() so callable params that return
// non-string values (objects, arrays, numbers) pass validation.
const paramsSchema = z.object({
  outputValue: z.unknown(),
  outputName: z.string().default('result'),
});

export const outputAction = defineAction({
  id: 'primitives.output',
  name: 'Flow Output',
  description: 'Return a named output value from the flow. outputValue accepts any type.',
  provider: PROVIDER,
  icon: 'LogOut',
  excludeFromTools: true,

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'outputValue',
        label: 'Output Value',
        type: 'json',
        required: true,
      },
      {
        name: 'outputName',
        label: 'Output Name',
        type: 'text',
        defaultValue: 'result',
      },
    ],
  },

  async execute(params, context) {
    const { outputName, outputValue } = params;

    context.logger.debug('primitives.output collected value', { outputName });

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
