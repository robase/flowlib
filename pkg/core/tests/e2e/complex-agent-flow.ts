/**
 * E2E Test: Complex Agent Flow
 *
 * A multi-step agent flow demonstrating advanced agent capabilities:
 *
 * Flow structure:
 *
 *   Input (analysis_request)
 *       ↓
 *   HTTP Request (fetch sample data)
 *       ↓
 *   Agent (data analyst with JQ, Math, JSON Logic tools)
 *       ↓
 *   Template (format final report)
 *       ↓
 *   Output (analysis_report)
 *
 * Tests:
 * - AGENT node with multiple tools: jq_query, math_eval, json_logic
 * - Agent receiving complex input data from HTTP request
 * - Agent performing multi-step analysis with multiple tool calls
 * - Template node formatting agent output
 */
import { strict as assert } from 'node:assert';
import { FlowRunStatus, BatchProvider } from '../../src';
import { defineFlow, input, output, agent, template, httpRequest } from '@flowlib/sdk';
import type { FlowlibInstance } from '../../src/api/types';
import { getOutputVariable, type AgentOutputLike, type FlowExample } from './example-types';

/**
 * Ensure we have an AI credential for Agent node.
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
    name: `E2E Complex Agent ${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Credential`,
    type: 'http-api',
    authType: 'bearer',
    config: {
      token: apiKey,
      provider: providerName,
    },
    description: `AI credential for complex agent E2E testing (${providerName})`,
  });

  return { id: created.id, name: created.name, isOpenAI };
}

/**
 * Build a complex agent flow that uses multiple tools for data analysis
 */
function buildComplexAgentFlowDefinition(credentialId: string, isOpenAI: boolean) {
  const modelName = isOpenAI ? 'gpt-4o-mini' : 'claude-3-haiku-20240307';

  const sampleSalesData = {
    company: 'TechCorp',
    quarter: 'Q4 2025',
    products: [
      { name: 'Widget A', units: 1500, pricePerUnit: 29.99, region: 'North' },
      { name: 'Widget B', units: 800, pricePerUnit: 49.99, region: 'South' },
      { name: 'Widget C', units: 2200, pricePerUnit: 19.99, region: 'East' },
      { name: 'Gadget X', units: 450, pricePerUnit: 99.99, region: 'West' },
      { name: 'Gadget Y', units: 1100, pricePerUnit: 79.99, region: 'North' },
    ],
    targets: {
      totalRevenue: 200000,
      topRegion: 'North',
      minUnitsPerProduct: 500,
    },
  };

  return defineFlow({
    name: 'Complex Agent Flow',
    nodes: [
      input('analysis_request', {
        variableName: 'request',
        defaultValue: JSON.stringify({
          analysisType: 'quarterly_sales',
          focus: 'revenue_by_product',
          includeTargetComparison: true,
        }),
      }),

      httpRequest('sales_data', {
        method: 'POST',
        url: 'https://httpbin.org/post',
        body: JSON.stringify(sampleSalesData),
        headers: {
          'Content-Type': 'application/json',
        },
      }),

      agent('analyst_agent', {
        credentialId,
        model: modelName,
        provider: isOpenAI ? BatchProvider.OPENAI : BatchProvider.ANTHROPIC,
        taskPrompt: `Analyze the sales data and provide insights.

Sales Data (from API response):
{{ sales_data.data.json | dump }}

Analysis Request:
{{ analysis_request.request | dump }}

Your task:
1. Use the jq_query tool to extract and summarize key data points
2. Use the math_eval tool to calculate:
   - Total revenue across all products
   - Average units sold per product  
   - Revenue contribution percentage for each product
3. Use the json_logic tool to check:
   - Whether total revenue meets the target
   - Which products are below the minimum units threshold

Provide a comprehensive analysis with specific numbers and insights.`,
        systemPrompt: `You are a data analyst assistant. You have access to these tools:
- jq_query: For extracting and filtering JSON data
- math_eval: For precise mathematical calculations
- json_logic: For conditional checks and rule evaluation

Always use tools for data operations rather than estimating. Show your analysis step by step.`,
        addedTools: [
          {
            instanceId: 'inst_jq',
            toolId: 'jq_query',
            name: 'JQ Query',
            description: 'Query JSON data using JQ',
            params: {},
          },
          {
            instanceId: 'inst_math',
            toolId: 'math_eval',
            name: 'Math Evaluate',
            description: 'Evaluate math expressions',
            params: {},
          },
          {
            instanceId: 'inst_json',
            toolId: 'json_logic',
            name: 'JSON Logic',
            description: 'Evaluate JSON logic rules',
            params: {},
          },
        ],
        maxIterations: 15,
        stopCondition: 'explicit_stop',
        temperature: 0.2,
      }),

      template('formatted_report', {
        template: `# Sales Analysis Report

## Analysis Summary
{{ analyst_agent.finalResponse }}

## Execution Metadata
- Agent Iterations: {{ analyst_agent.iterations }}
- Tools Used: {{ analyst_agent.toolResults | length }}
- Finish Reason: {{ analyst_agent.finishReason }}

---
*Generated by Flowlib AI Agent*`,
      }),

      output('analysis_report', {
        outputName: 'report',
        outputValue: '{{ formatted_report.output }}',
      }),
    ],
    edges: [
      { from: 'analysis_request', to: 'sales_data' },
      { from: 'sales_data', to: 'analyst_agent' },
      { from: 'analysis_request', to: 'analyst_agent' },
      { from: 'analyst_agent', to: 'formatted_report' },
      { from: 'formatted_report', to: 'analysis_report' },
    ],
  });
}

/**
 * Complex Agent Flow Example
 */
export const complexAgentFlowExample: FlowExample = {
  name: 'Complex Agent Flow - Data Analyst',
  description: 'Tests AI Agent node with multiple tools (JQ, Math, JSON Logic) for data analysis',

  async execute(flowlib: FlowlibInstance) {
    const { id: credentialId, isOpenAI } = await ensureAICredential(flowlib);

    const definition = buildComplexAgentFlowDefinition(credentialId, isOpenAI);

    const flow = await flowlib.flows.create({
      name: 'E2E Complex Agent Flow',
    });

    await flowlib.versions.create(flow.id, { flowlibDefinition: definition });

    const result = await flowlib.runs.start(
      flow.id,
      {},
      {
        useBatchProcessing: false,
      },
    );

    console.log('\n📊 Complex Agent Flow Result:');
    console.log(`   Status: ${result.status}`);
    console.log(`   Duration: ${result.duration}ms`);

    const agentTrace = result.traces?.find((t) => t.nodeId === 'node-analyst_agent');
    if (agentTrace?.outputs) {
      const agentOutput = getOutputVariable(agentTrace.outputs) as AgentOutputLike | undefined;
      if (agentOutput) {
        console.log(`   Agent Iterations: ${agentOutput.iterations || 'N/A'}`);
        console.log(`   Finish Reason: ${agentOutput.finishReason || 'N/A'}`);
        console.log(`   Total Tool Calls: ${agentOutput.toolResults?.length || 0}`);

        const toolCounts: Record<string, number> = {};
        for (const toolResult of agentOutput.toolResults || []) {
          const id = toolResult.toolId ?? 'unknown';
          toolCounts[id] = (toolCounts[id] || 0) + 1;
        }
        console.log(`   Tool Usage:`);
        for (const [toolId, count] of Object.entries(toolCounts)) {
          console.log(`     - ${toolId}: ${count} calls`);
        }
      }
    }

    if (result.outputs?.report) {
      console.log(`\n   📄 Generated Report Preview:`);
      const reportPreview = String(result.outputs.report).substring(0, 500);
      console.log(`   ${reportPreview}...`);
    }

    // Cleanup
    await flowlib.credentials.delete(credentialId);

    return result;
  },

  expected(result) {
    assert.equal(result.status, FlowRunStatus.SUCCESS, 'Flow should complete successfully');
    assert.ok(result.outputs, 'Flow should have outputs');

    const agentTrace = result.traces?.find((t) => t.nodeId === 'node-analyst_agent');
    assert.ok(agentTrace, 'Should have agent node trace');

    const agentOutput = getOutputVariable(agentTrace!.outputs) as AgentOutputLike | undefined;
    assert.ok(agentOutput, 'Agent should have output');

    assert.ok(agentOutput.finalResponse, 'Agent should have a final response');
    assert.ok(typeof agentOutput.iterations === 'number', 'Agent should track iterations');
    assert.ok(agentOutput.finishReason, 'Agent should have a finish reason');
    assert.ok(Array.isArray(agentOutput.toolResults), 'Agent should have tool results array');

    // Verify tools were used
    const toolIds = new Set(agentOutput.toolResults.map((resultItem) => resultItem.toolId));
    console.log(`   Tools actually used: ${Array.from(toolIds).join(', ')}`);

    assert.ok(
      toolIds.size >= 1,
      `Agent should use tools, but used: ${Array.from(toolIds).join(', ')}`,
    );

    const report = getOutputVariable(result.outputs?.['node-analysis_report']);
    if (report) {
      const reportStr = String(report);
      assert.ok(reportStr.length > 0, 'Report should have content');
    }

    console.log('   ✅ All assertions passed');
  },
};
