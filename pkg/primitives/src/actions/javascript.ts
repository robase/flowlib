import { defineAction } from '@flowlib/action-kit';
import { z } from 'zod/v4';

const PROVIDER = {
  id: 'primitives',
  name: 'Primitives',
  icon: 'Code',
  category: 'core' as const,
  nodeCategory: 'Logic' as const,
};

// The executor resolves the `code` callable param before calling execute().
// The result of calling code(ctx) is passed here as the resolved `result`.
const paramsSchema = z.object({
  result: z.unknown(),
});

export const javascriptAction = defineAction({
  id: 'primitives.javascript',
  name: 'JavaScript',
  description:
    'Execute arbitrary logic via a TypeScript function. Use the code param as (ctx) => your_value.',
  provider: PROVIDER,
  icon: 'Code',
  excludeFromTools: true,

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'result',
        label: 'Result',
        type: 'json',
        required: true,
        description:
          'Pass a function (ctx) => value as the code param. The resolved result is the node output.',
      },
    ],
  },

  async execute(params, context) {
    context.logger.debug('primitives.javascript returning resolved result', {
      resultType: typeof params.result,
    });

    return {
      success: true,
      output: params.result,
    };
  },
});
