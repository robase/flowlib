import { defineAction } from '@flowlib/action-kit';
import { z } from 'zod/v4';

const PROVIDER = {
  id: 'primitives',
  name: 'Primitives',
  icon: 'GitFork',
  category: 'core' as const,
  nodeCategory: 'Logic' as const,
};

// The executor resolves callable params recursively — so by the time
// execute() runs, each case.condition is already a resolved boolean.
const switchCaseSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  condition: z.boolean(),
});

const paramsSchema = z.object({
  cases: z.array(switchCaseSchema).min(1).max(16),
  matchMode: z.enum(['first', 'all']).default('first'),
});

export const switchAction = defineAction({
  id: 'primitives.switch',
  name: 'Switch',
  description:
    'Multi-way conditional branching. Each case has a condition: (ctx) => boolean function.',
  provider: PROVIDER,
  icon: 'GitFork',
  excludeFromTools: true,
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
        options: [
          { label: 'First match', value: 'first' },
          { label: 'All matches', value: 'all' },
        ],
        defaultValue: 'first',
      },
      {
        name: 'cases',
        label: 'Cases',
        type: 'switch-cases' as const,
        required: true,
      },
    ],
  },

  async execute(params, context) {
    const { cases, matchMode = 'first' } = params;
    const passthroughValue = { value: context.incomingData ?? {} };

    const matchedSlugs: string[] = [];
    let firstMatchSlug: string | undefined;

    for (const c of cases) {
      if (c.condition) {
        if (!firstMatchSlug) {
          firstMatchSlug = c.slug;
        }
        matchedSlugs.push(c.slug);
        if (matchMode === 'first') {
          break;
        }
      }
    }

    const outputVariables: Record<string, { value: unknown; type: 'string' | 'object' }> = {};

    if (matchMode === 'all') {
      if (matchedSlugs.length > 0) {
        for (const slug of matchedSlugs) {
          outputVariables[slug] = { type: 'object', value: passthroughValue };
        }
      } else {
        outputVariables['default'] = { type: 'object', value: passthroughValue };
      }
    } else {
      const handle = firstMatchSlug ?? 'default';
      outputVariables[handle] = { type: 'object', value: passthroughValue };
    }

    return {
      success: true,
      output: passthroughValue,
      outputVariables,
      metadata: {
        matchMode,
        matchedSlugs:
          matchMode === 'all' ? matchedSlugs : firstMatchSlug ? [firstMatchSlug] : ['default'],
      },
    };
  },
});
