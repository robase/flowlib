/**
 * E2E Test: Input → Template String → Model Flow
 *
 * Simulates a user building a simple flow:
 * 1. Input node that takes a "topic" variable
 * 2. Template String node that creates a prompt using the topic
 * 3. Model node that generates a response using the prompt
 */
import { strict as assert } from 'node:assert';
import { FlowRunStatus, type NodeOutput } from '../../src';
import { defineFlow, input, template, model } from '@flowlib/sdk';
import type { FlowlibInstance } from '../../src/api/types';
import type { FlowExample } from './example-types';

/**
 * Ensure we have an OpenAI or Anthropic credential for the Model node.
 * Creates a credential with proper provider metadata for detection.
 */
async function ensureAICredential(
  flowlib: FlowlibInstance,
): Promise<{ id: string; name: string; isOpenAI: boolean }> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openaiKey && !anthropicKey) {
    throw new Error(
      'No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable.',
    );
  }

  const isOpenAI = !!openaiKey;
  const apiKey = openaiKey || anthropicKey!;
  const providerName = isOpenAI ? 'openai' : 'anthropic';

  const created = await flowlib.credentials.create({
    name: `E2E ${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Credential`,
    type: 'http-api',
    authType: 'bearer',
    config: {
      token: apiKey,
      provider: providerName,
    },
    description: `AI credential for E2E testing (${providerName})`,
  });

  return { id: created.id, name: created.name, isOpenAI };
}

/**
 * Build the flow definition for: Input → Template String → Model
 */
function buildFlowDefinition(credentialId: string, isOpenAI: boolean) {
  return defineFlow({
    name: 'Input Template Model Flow',
    description: 'Simple flow: Input topic → Build prompt → Generate AI response',
    nodes: [
      input('topic_input', {
        variableName: 'topic',
        defaultValue: 'the history of computers',
      }),

      template('prompt_builder', {
        template: 'Write a short, 2-sentence summary about: {{ topic_input }}',
      }),

      model('ai_generator', {
        credentialId,
        model: isOpenAI ? 'gpt-4o-mini' : 'claude-3-haiku-20240307',
        prompt: '{{ prompt_builder }}',
        systemPrompt: 'You are a helpful assistant that provides concise summaries.',
        temperature: 0.7,
        maxTokens: 150,
      }),
    ],
    edges: [
      { from: 'topic_input', to: 'prompt_builder' },
      { from: 'prompt_builder', to: 'ai_generator' },
    ],
  });
}

export const inputTemplateModelExample: FlowExample = {
  name: 'Input → Template String → Model Flow',
  description:
    'User builds a flow that takes a topic, creates a prompt, and generates an AI response.',

  async execute(flowlib) {
    const credential = await ensureAICredential(flowlib);
    console.log(`  📝 Using credential: ${credential.name} (${credential.id})`);
    console.log(`  🤖 Provider: ${credential.isOpenAI ? 'OpenAI' : 'Anthropic'}`);

    const flow = await flowlib.flows.create({
      name: `e2e-input-template-model-${Date.now()}`,
    });
    console.log(`  📁 Created flow: ${flow.name} (${flow.id})`);

    const flowDefinition = buildFlowDefinition(credential.id, credential.isOpenAI);
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: flowDefinition,
    });
    console.log(`  💾 Saved flow version with ${flowDefinition.nodes.length} nodes`);

    console.log(`  🚀 Executing flow...`);
    const result = await flowlib.runs.start(
      flow.id,
      { topic: 'the invention of the telephone' },
      { useBatchProcessing: false },
    );
    console.log(`  ✅ Flow completed with status: ${result.status}`);

    return result;
  },

  expected(result) {
    assert.equal(
      result.status,
      FlowRunStatus.SUCCESS,
      `Flow should succeed, got: ${result.status}${result.error ? ` - ${result.error}` : ''}`,
    );

    // Verify Input node executed
    const inputNode = result.outputs?.['node-topic_input'] as NodeOutput | undefined;
    assert(inputNode, 'Input node outputs should be present');
    const inputVars = inputNode.data.variables as Record<string, { value?: unknown }>;
    assert.equal(
      inputVars.output?.value,
      'the invention of the telephone',
      'Input node should output the provided topic',
    );

    // Verify Template String node executed
    const templateNode = result.outputs?.['node-prompt_builder'] as NodeOutput | undefined;
    assert(templateNode, 'Template String node outputs should be present');
    const templateVars = templateNode.data.variables as Record<string, { value?: unknown }>;
    const templateOutput = templateVars.output?.value as string;
    assert(templateOutput, 'Template node should have output');
    assert(
      templateOutput.includes('the invention of the telephone'),
      `Template output should contain the topic, got: ${templateOutput}`,
    );

    // Verify Model node executed
    const modelNode = result.outputs?.['node-ai_generator'] as NodeOutput | undefined;
    assert(modelNode, 'Model node outputs should be present');
    const modelVars = modelNode.data.variables as Record<string, { value?: unknown }>;
    const modelOutput = modelVars.output?.value as string;
    assert(modelOutput, 'Model node should have generated output');
    assert(
      modelOutput.length > 20,
      `Model should generate a meaningful response, got: ${modelOutput}`,
    );

    console.log(`  📄 Model output preview: "${modelOutput.substring(0, 100)}..."`);
  },
};
