import { defineAction } from '@flowlib/action-kit';
import { z } from 'zod/v4';

const PROVIDER = {
  id: 'primitives',
  name: 'Primitives',
  icon: 'GitBranch',
  category: 'core' as const,
  nodeCategory: 'Logic' as const,
};

// The executor resolves the callable condition param before calling execute(),
// so by the time execute() is invoked, condition is already a plain boolean.
const paramsSchema = z.object({
  condition: z.boolean(),
});

export const ifElseAction = defineAction({
  id: 'primitives.if_else',
  name: 'If / Else',
  description: 'Conditional branching. The condition param is a function (ctx) => boolean.',
  provider: PROVIDER,
  icon: 'GitBranch',
  excludeFromTools: true,

  outputs: [
    { id: 'true_output', label: 'True', type: 'any' },
    { id: 'false_output', label: 'False', type: 'any' },
  ],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'condition',
        label: 'Condition',
        type: 'boolean',
        required: true,
      },
    ],
  },

  async execute(params, context) {
    const conditionResult = params.condition;

    context.logger.debug('primitives.if_else evaluating condition', { conditionResult });

    const passthroughValue = {
      branch: conditionResult ? 'true' : 'false',
      value: context.incomingData ?? {},
    };

    const outputVariables: Record<string, { value: unknown; type: 'string' | 'object' }> = {};
    if (conditionResult) {
      outputVariables.true_output = { type: 'object', value: passthroughValue };
    } else {
      outputVariables.false_output = { type: 'object', value: passthroughValue };
    }

    return {
      success: true,
      output: passthroughValue,
      outputVariables,
      metadata: { conditionResult, branchTaken: conditionResult ? 'true_branch' : 'false_branch' },
    };
  },
});
