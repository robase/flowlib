/**
 * core.javascript — JavaScript data transformation action
 *
 * Evaluates arbitrary JavaScript against incoming upstream node data.
 * Uses the JsExpressionService (sandboxed QuickJS runtime) for safe execution.
 *
 * Upstream node outputs are available as local variables (by reference ID).
 * `$input` is always available as the full context object.
 *
 * For one-liners, `return` is auto-prepended.
 * For multi-statement code, use explicit `return`.
 */

import { defineAction, JsExpressionError, JsExpressionEvaluationError } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  code: z.string().min(1, 'JavaScript code is required'),
});

export const javascriptAction = defineAction({
  id: 'core.javascript',
  name: 'JavaScript',
  description:
    'Transform and process data using JavaScript in a sandboxed QuickJS runtime. Use when you need to filter, map, reshape, or compute values from upstream node outputs. Upstream variables are available by their reference ID; `$input` holds the full context object. Single expressions auto-return; use explicit `return` for multi-line code.',
  provider: CORE_PROVIDER,
  icon: 'Braces',
  tags: [
    'javascript',
    'js',
    'transform',
    'code',
    'filter',
    'map',
    'script',
    'data',
    'function',
    'compute',
  ],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'code',
        label: 'JavaScript Code',
        type: 'code',
        required: true,
        description:
          'JavaScript to execute. Upstream data is available as local variables by reference ID. Use `return` for multi-line; single expressions auto-return.',
        placeholder: 'items.filter(x => x.active).map(x => x.name)',
      },
    ],
  },

  async execute(params, context) {
    const { code } = params;
    const data = context.incomingData ?? {};

    context.logger.debug('Executing JavaScript action', {
      codeLength: code.length,
      incomingDataKeys: Object.keys(data),
    });

    const evaluator = context.functions?.evaluator;
    if (!evaluator) {
      return {
        success: false,
        error:
          'JavaScript evaluator not available in execution context. Configure ctx.functions.evaluator (e.g. QuickJsEvaluator or DirectEvaluator).',
      };
    }

    try {
      await evaluator.initialize?.();
      const result = await evaluator.evaluate(code, data);

      // Stringify non-string results for the output variable
      const outputValue =
        typeof result === 'object' && result !== null
          ? JSON.stringify(result)
          : String(result ?? '');

      return {
        success: true,
        output: outputValue,
        metadata: {
          resultType: Array.isArray(result) ? 'array' : typeof result,
          executedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg =
        error instanceof JsExpressionError || error instanceof JsExpressionEvaluationError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return { success: false, error: `JavaScript Error: ${msg}` };
    }
  },
});
