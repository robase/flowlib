/**
 * core.template_string — Template String action
 *
 * Processes a template against incoming upstream data.
 * Requires the `runTemplateReplacement` function from flow context.
 */

import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  template: z.string().default(''),
});

export const templateStringAction = defineAction({
  id: 'core.template_string',
  name: 'Template String',
  description:
    'Replace variables in a text template using {{ expression }} syntax. Use to compose strings from upstream node outputs, flow inputs, and global config. Full JavaScript expressions are supported inside {{ }}.',
  provider: CORE_PROVIDER,
  excludeFromTools: true,
  icon: 'FileCode2',
  tags: ['template', 'string', 'text', 'format', 'interpolate', 'replace', 'render', 'message'],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'template',
        label: 'Template',
        type: 'textarea',
        required: true,
        description:
          'Text with template syntax. Access incoming node data via {{ nodeId.data.variables.outputName.value }}',
        placeholder: 'Hello {{ input_node.data.variables.name.value }}!',
      },
    ],
  },

  async execute(params, context) {
    const { template } = params;

    if (template === '') {
      return {
        success: true,
        output: '',
        metadata: {
          templateLength: 0,
          outputLength: 0,
        },
      };
    }

    const incomingData = context.incomingData ?? {};
    const flowInputs = context.flowInputs ?? {};
    const globalConfig = context.flowRunState?.globalConfig ?? {};

    // Build variables for template resolution
    // Priority: incoming data (upstream nodes) > flow inputs > global config
    const availableVariables: Record<string, unknown> = {
      global: globalConfig,
      flow: flowInputs,
      ...incomingData,
    };

    const runTemplate = context.functions?.runTemplateReplacement;
    if (!runTemplate) {
      return {
        success: false,
        error: 'Template replacement function not available. This action requires flow context.',
      };
    }

    try {
      const processedText = await runTemplate(template, availableVariables);

      return {
        success: true,
        output: processedText,
        metadata: {
          templateLength: template.length,
          outputLength: processedText.length,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Template processing failed: ${msg}` };
    }
  },
});
