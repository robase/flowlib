/**
 * core.switch — Multi-way conditional branching action
 *
 * Evaluates multiple JavaScript expressions against incoming data and routes
 * execution to the first matching branch. Like core.if_else but with N
 * configurable output branches plus a default fallback.
 *
 * This is a flow-control node — the execution coordinator owns all
 * branch-skipping logic based on the outputVariables returned here.
 */

import { defineAction, JsExpressionError, JsExpressionEvaluationError } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const switchCaseSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  expression: z.string().min(1),
});

const paramsSchema = z.object({
  cases: z.array(switchCaseSchema).min(1).max(4),
  matchMode: z.enum(['first', 'all']).default('first'),
});

export const switchAction = defineAction({
  id: 'core.switch',
  name: 'Switch',
  description:
    'Multi-way conditional branching. Evaluates JS expressions top-to-bottom. In "first match" mode, routes to the first match or default. In "all matches" mode, activates every matching branch.',
  provider: CORE_PROVIDER,
  icon: 'GitFork',
  excludeFromTools: true,
  tags: ['switch', 'branch', 'condition', 'route', 'case', 'multi', 'conditional'],

  dynamicOutputs: true,
  outputs: [
    { id: 'case_0', label: 'Case 0', type: 'any' },
    { id: 'default', label: 'Default', type: 'any' },
  ],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'matchMode',
        label: 'Match Mode',
        type: 'select' as const,
        required: false,
        description:
          'How to handle multiple matching cases. "First match" stops at the first truthy case. "All matches" activates every truthy branch.',
        options: [
          {
            label: 'First match',
            value: 'first',
            description: 'Stops at the first truthy case and routes execution to that branch only.',
          },
          {
            label: 'All matches',
            value: 'all',
            description: 'Activates every branch whose expression evaluates to true.',
          },
        ],
        defaultValue: 'first',
      },
      {
        name: 'cases',
        label: 'Cases',
        type: 'switch-cases' as const,
        required: true,
        description:
          'Each case has a label and a JS expression. Upstream data available as local variables by reference ID.',
      },
    ],
  },

  async execute(params, context) {
    const { cases, matchMode = 'first' } = params;
    const evaluationData = (context.incomingData as Record<string, unknown>) ?? {};

    context.logger.debug('Switch evaluating cases', {
      caseCount: cases.length,
      incomingDataKeys: Object.keys(evaluationData),
    });

    const evaluator = context.functions?.evaluator;
    if (!evaluator) {
      return {
        success: false,
        error:
          'JavaScript evaluator not available in execution context. Configure ctx.functions.evaluator.',
      };
    }
    await evaluator.initialize?.();

    let matchedSlug: string | undefined;
    let matchedLabel: string | undefined;
    const matchedSlugs: string[] = [];
    const caseResults: Array<{
      slug: string;
      label: string;
      matched: boolean;
      error?: string;
    }> = [];

    for (const c of cases) {
      try {
        const result = await evaluator.evaluate(c.expression, evaluationData);
        const matched = Boolean(result);
        caseResults.push({ slug: c.slug, label: c.label, matched });

        if (matched) {
          if (!matchedSlug) {
            matchedSlug = c.slug;
            matchedLabel = c.label;
          }
          if (matchMode === 'all') {
            matchedSlugs.push(c.slug);
          }
        }
      } catch (error) {
        const msg =
          error instanceof JsExpressionError || error instanceof JsExpressionEvaluationError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        caseResults.push({ slug: c.slug, label: c.label, matched: false, error: msg });
        context.logger.warn(`Switch case "${c.label}" evaluation failed`, {
          expression: c.expression,
          error: msg,
        });
      }
    }

    // Passthrough — switch output equals input
    const passthroughData = JSON.stringify(evaluationData);

    // Build outputVariables based on match mode.
    // The coordinator uses the absence of a handle key to skip branches.
    const outputVariables: Record<string, { value: unknown; type: 'string' | 'object' }> = {};

    if (matchMode === 'all') {
      if (matchedSlugs.length > 0) {
        for (const slug of matchedSlugs) {
          outputVariables[slug] = { type: 'object', value: passthroughData };
        }
      } else {
        outputVariables['default'] = { type: 'object', value: passthroughData };
      }
    } else {
      const matchedHandle = matchedSlug ?? 'default';
      outputVariables[matchedHandle] = { type: 'object', value: passthroughData };
    }

    return {
      success: true,
      output: passthroughData,
      outputVariables,
      metadata: {
        caseResults,
        matchMode,
        matchedSlug:
          matchMode === 'all'
            ? matchedSlugs.length > 0
              ? matchedSlugs.join(', ')
              : 'default'
            : (matchedSlug ?? 'default'),
        matchedLabel:
          matchMode === 'all'
            ? matchedSlugs.length > 0
              ? `${matchedSlugs.length} matches`
              : 'default'
            : (matchedLabel ?? 'default'),
      },
    };
  },
});
