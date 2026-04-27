/**
 * E2E Test: Simple Agent Flow
 *
 * A minimal agent flow that demonstrates the AI Agent node with tool use:
 *
 * Flow structure:
 *
 *   Input (user_question)
 *       ↓
 *   Agent (answer with math calculations)
 *       ↓
 *   Output (final_answer)
 *
 * Tests:
 * - AGENT node with math_eval tool enabled
 * - Agent using tool to perform calculation
 * - Agent producing final response
 */
import { strict as assert } from 'node:assert';
import { FlowRunStatus } from '../../src';
import { defineFlow, input, output, agent } from '@flowlib/sdk';
import type { InvectInstance } from '../../src/api/types';
import { getOutputVariable, type AgentOutputLike, type FlowExample } from './example-types';

/**
 * Ensure we have an AI credential for Agent node.
 */
async function ensureAICredential(
  flowlib: InvectInstance,
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
    name: `E2E Simple Agent ${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Credential`,
    type: 'http-api',
    authType: 'bearer',
    config: {
      token: apiKey,
      provider: providerName,
    },
    description: `AI credential for simple agent E2E testing (${providerName})`,
  });

  return { id: created.id, name: created.name, isOpenAI };
}

/**
 * Build a simple agent flow that uses the math tool
 */
function buildSimpleAgentFlowDefinition(credentialId: string, isOpenAI: boolean) {
  const modelName = isOpenAI ? 'gpt-4o-mini' : 'claude-3-haiku-20240307';

  return defineFlow({
    name: 'Simple Agent Flow',
    nodes: [
      input('user_question', {
        variableName: 'question',
        defaultValue: 'What is 15% of 847? Please calculate the exact value.',
      }),

      agent('calculator_agent', {
        credentialId,
        model: modelName,
        provider: isOpenAI ? 'OPENAI' : 'ANTHROPIC',
        taskPrompt: `Answer the following question: {{ user_question }}

Use the math_eval tool if you need to perform any calculations. Be precise and show your work.`,
        systemPrompt:
          'You are a helpful math assistant. Use the math_eval tool to perform accurate calculations. Always show your reasoning.',
        addedTools: [
          {
            instanceId: 'inst_math',
            toolId: 'math_eval',
            name: 'Math Evaluate',
            description: 'Evaluate math expressions',
            params: {},
          },
        ],
        maxIterations: 5,
        stopCondition: 'explicit_stop',
        temperature: 0.1,
      }),

      output('final_answer', {
        outputName: 'result',
        outputValue: '{{ calculator_agent.finalResponse }}',
      }),
    ],
    edges: [
      { from: 'user_question', to: 'calculator_agent' },
      { from: 'calculator_agent', to: 'final_answer' },
    ],
  });
}

/**
 * Simple Agent Flow Example
 */
export const simpleAgentFlowExample: FlowExample = {
  name: 'Simple Agent Flow - Math Calculator',
  description: 'Tests AI Agent node with math_eval tool to perform calculations',

  async execute(flowlib: InvectInstance) {
    const { id: credentialId, isOpenAI } = await ensureAICredential(flowlib);

    const definition = buildSimpleAgentFlowDefinition(credentialId, isOpenAI);

    const flow = await flowlib.flows.create({
      name: 'E2E Simple Agent Flow',
    });

    await flowlib.versions.create(flow.id, { invectDefinition: definition });

    const result = await flowlib.runs.start(
      flow.id,
      {},
      {
        useBatchProcessing: false,
      },
    );

    console.log('\n📊 Simple Agent Flow Result:');
    console.log(`   Status: ${result.status}`);
    console.log(`   Duration: ${result.duration}ms`);

    const agentTrace = result.traces?.find((t) => t.nodeId === 'node-calculator_agent');
    if (agentTrace?.outputs) {
      const agentOutput = getOutputVariable(agentTrace.outputs) as AgentOutputLike | undefined;
      if (agentOutput) {
        console.log(`   Iterations: ${agentOutput.iterations || 'N/A'}`);
        console.log(`   Finish Reason: ${agentOutput.finishReason || 'N/A'}`);
        console.log(`   Tools Used: ${agentOutput.toolResults?.length || 0}`);
        if (agentOutput.toolResults && agentOutput.toolResults.length > 0) {
          for (const toolResult of agentOutput.toolResults) {
            console.log(
              `     - ${toolResult.toolName}: ${toolResult.success ? 'success' : 'failed'}`,
            );
            if (toolResult.output !== undefined) {
              console.log(`       Output: ${JSON.stringify(toolResult.output)}`);
            }
          }
        }
        console.log(`   Final Response: ${(agentOutput.finalResponse || '').substring(0, 200)}...`);
      }
    }

    if (result.outputs?.result) {
      console.log(
        `\n   📄 Flow Output (result): ${String(result.outputs.result).substring(0, 200)}...`,
      );
    }

    // Cleanup
    await flowlib.credentials.delete(credentialId);

    return result;
  },

  expected(result) {
    assert.equal(result.status, FlowRunStatus.SUCCESS, 'Flow should complete successfully');
    assert.ok(result.outputs, 'Flow should have outputs');

    const agentTrace = result.traces?.find((t) => t.nodeId === 'node-calculator_agent');
    assert.ok(agentTrace, 'Should have agent node trace');

    const agentOutput = getOutputVariable(agentTrace!.outputs) as AgentOutputLike | undefined;
    assert.ok(agentOutput, 'Agent should have output');

    assert.ok(agentOutput.finalResponse, 'Agent should have a final response');
    assert.ok(typeof agentOutput.iterations === 'number', 'Agent should track iterations');
    assert.ok(agentOutput.finishReason, 'Agent should have a finish reason');
    assert.ok(Array.isArray(agentOutput.toolResults), 'Agent should have tool results array');

    // The agent should have used the math tool at least once
    const mathToolUsed = agentOutput.toolResults.some(
      (resultItem) => resultItem.toolId === 'math_eval' && resultItem.success,
    );
    assert.ok(mathToolUsed, 'Agent should have successfully used the math_eval tool');

    const finalResult = getOutputVariable(result.outputs?.['node-final_answer']);
    assert.ok(finalResult, 'Output node should have result value');

    // Verify the calculation result is somewhere in the output
    // 15% of 847 = 127.05
    const finalResponse = String(finalResult);
    const responseContainsResult =
      finalResponse.includes('127.05') || finalResponse.includes('127');
    assert.ok(
      responseContainsResult,
      'Agent response should contain the correct calculation result',
    );

    console.log('   ✅ All assertions passed');
  },
};
