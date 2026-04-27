/**
 * E2E Test: Comprehensive Multi-Stage Flow
 *
 * This flow tests ALL node types with complex, realistic logic:
 *
 * Flow structure:
 *
 *   Input (user_request)
 *       ↓
 *   HTTP Request (fetch user profile from API)
 *       ↓
 *   JavaScript (extract user data + determine tier)
 *       ↓
 *   If-Else (premium user?)
 *     ↓ True                    ↓ False
 *   Template (premium prompt)    Template (basic prompt)
 *     ↓                              ↓
 *   Model (detailed analysis)   Model (brief summary)
 *     ↓                              ↓
 *   JavaScript (format premium)  JavaScript (format basic)
 *     └──────────┬───────────────────┘
 *                ↓
 *   Template (combine results)
 *       ↓
 *   Model (final polish/review)
 *       ↓
 *   Output (final result)
 *
 * This demonstrates:
 * - Multiple LLM calls in sequence
 * - Conditional branching with different LLM behaviors per branch
 * - Data transformation between nodes
 * - Merging data from parallel branches
 * - Complex template interpolation
 */
import { strict as assert } from 'node:assert';
import { FlowRunStatus, type NodeOutput } from '../../src';
import {
  defineFlow,
  input,
  output,
  model,
  javascript,
  ifElse,
  template,
  httpRequest,
} from '@flowlib/sdk';
import type { InvectInstance } from '../../src/api/types';
import type { FlowExample } from './example-types';

/**
 * Ensure we have an AI credential for Model nodes.
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
    name: `E2E Comprehensive ${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Credential`,
    type: 'http-api',
    authType: 'bearer',
    config: {
      token: apiKey,
      provider: providerName,
    },
    description: `AI credential for comprehensive E2E testing (${providerName})`,
  });

  return { id: created.id, name: created.name, isOpenAI };
}

/**
 * Build the comprehensive flow definition
 */
function buildComprehensiveFlowDefinition(
  credentialId: string,
  isOpenAI: boolean,
  isPremiumUser: boolean,
) {
  const modelName = isOpenAI ? 'gpt-4o-mini' : 'claude-3-haiku-20240307';

  const mockUserData = {
    userId: isPremiumUser ? 'user_premium_123' : 'user_basic_456',
    name: isPremiumUser ? 'Alice Premium' : 'Bob Basic',
    tier: isPremiumUser ? 'premium' : 'basic',
    credits: isPremiumUser ? 1000 : 10,
    preferences: {
      language: 'en',
      detailLevel: isPremiumUser ? 'comprehensive' : 'brief',
    },
  };

  return defineFlow({
    name: 'Comprehensive Multi-Stage Flow',
    description:
      'Tests all node types with complex branching, multiple LLM calls, and data transformation',
    nodes: [
      // Stage 1: Input
      input('user_request', {
        variableName: 'request',
        defaultValue: JSON.stringify({
          topic: 'artificial intelligence in healthcare',
          analysisType: 'trends',
        }),
      }),

      // Stage 2: Fetch User Profile via HTTP
      httpRequest('user_profile_response', {
        method: 'POST',
        url: 'https://httpbin.org/post',
        body: JSON.stringify(mockUserData),
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': 'e2e-test-comprehensive',
        },
      }),

      // Stage 3: Extract & Transform User Data
      javascript(
        'user_data',
        {
          code: `const r = user_profile_response.data.json;
return {
  userId: r.userId,
  name: r.name,
  tier: r.tier,
  credits: r.credits,
  isPremium: r.tier === "premium",
  detailLevel: r.preferences.detailLevel
}`,
        },
        { label: 'Extract User Data' },
      ),

      // Stage 4: Branch on User Tier
      ifElse(
        'tier_check',
        {
          condition: { '==': [{ var: 'user_data.isPremium' }, true] },
        },
        { label: 'Is Premium User?' },
      ),

      // Stage 5A: Premium Branch
      template('premium_prompt', {
        template: `You are providing a PREMIUM analysis for {{ tier_check.user_data.name }}.

Topic: {{ user_request.topic }}
Analysis Type: {{ user_request.analysisType }}
Detail Level: {{ tier_check.user_data.detailLevel }}

Please provide a comprehensive analysis including:
1. Executive Summary
2. Current State Analysis
3. Key Trends and Developments
4. Future Predictions
5. Recommendations

Be thorough and detailed - this is for a premium subscriber with {{ tier_check.user_data.credits }} credits.`,
      }),

      model('premium_analysis', {
        credentialId,
        model: modelName,
        prompt: '{{ premium_prompt }}',
        systemPrompt:
          'You are an expert analyst providing premium-tier, comprehensive research reports. Be detailed and thorough.',
        temperature: 0.7,
        maxTokens: 800,
      }),

      javascript(
        'formatted_premium',
        {
          code: `return {
  tier: "premium",
  userName: tier_check.user_data.name,
  analysis: premium_analysis,
  wordCount: String(premium_analysis).split(" ").length,
  quality: "comprehensive"
}`,
        },
        { label: 'Format Premium Result' },
      ),

      // Stage 5B: Basic Branch
      template('basic_prompt', {
        template: `Provide a brief summary for {{ tier_check.user_data.name }}.

Topic: {{ user_request.topic }}

Give a concise 2-3 sentence overview. Keep it simple - this user has limited credits ({{ tier_check.user_data.credits }}).`,
      }),

      model('basic_summary', {
        credentialId,
        model: modelName,
        prompt: '{{ basic_prompt }}',
        systemPrompt:
          'You are a helpful assistant providing brief, easy-to-understand summaries. Be concise.',
        temperature: 0.5,
        maxTokens: 200,
      }),

      javascript(
        'formatted_basic',
        {
          code: `return {
  tier: "basic",
  userName: tier_check.user_data.name,
  analysis: basic_summary,
  wordCount: String(basic_summary).split(" ").length,
  quality: "brief"
}`,
        },
        { label: 'Format Basic Result' },
      ),

      // Stage 6: Merge & Final Processing
      template('combined_result', {
        template: `{% if formatted_premium %}
PREMIUM REPORT
==============
User: {{ formatted_premium.userName }}
Quality: {{ formatted_premium.quality }}
Word Count: {{ formatted_premium.wordCount }}

{{ formatted_premium.analysis }}
{% elif formatted_basic %}
BASIC SUMMARY
=============
User: {{ formatted_basic.userName }}
Quality: {{ formatted_basic.quality }}
Word Count: {{ formatted_basic.wordCount }}

{{ formatted_basic.analysis }}
{% endif %}

---
Generated by Invect E2E Test`,
      }),

      // Stage 7: Final Polish
      model('polished_result', {
        credentialId,
        model: modelName,
        prompt: `Review and add a brief closing thought to this report. Keep the original content but add a 1-2 sentence professional closing:

{{ combined_result }}`,
        systemPrompt:
          'You are an editor adding a professional touch to reports. Add a brief, insightful closing thought.',
        temperature: 0.6,
        maxTokens: 400,
      }),

      // Stage 8: Output
      output('final_report', {
        outputValue: '{{ polished_result }}',
        outputName: 'report',
      }),
    ],
    edges: [
      // Main pipeline
      { from: 'user_request', to: 'user_profile_response' },
      { from: 'user_profile_response', to: 'user_data' },
      { from: 'user_data', to: 'tier_check' },

      // Premium branch
      { from: 'tier_check', to: 'premium_prompt', handle: 'true_output' },
      { from: 'premium_prompt', to: 'premium_analysis' },
      { from: 'premium_analysis', to: 'formatted_premium' },
      { from: 'formatted_premium', to: 'combined_result' },

      // Basic branch
      { from: 'tier_check', to: 'basic_prompt', handle: 'false_output' },
      { from: 'basic_prompt', to: 'basic_summary' },
      { from: 'basic_summary', to: 'formatted_basic' },
      { from: 'formatted_basic', to: 'combined_result' },

      // Final stage
      { from: 'combined_result', to: 'polished_result' },
      { from: 'polished_result', to: 'final_report' },
    ],
  });
}

// =========================================
// Test Case 1: Premium User Path
// =========================================
export const comprehensiveFlowPremiumExample: FlowExample = {
  name: 'Comprehensive Flow (Premium User)',
  description: 'Full flow with HTTP→JS→If-Else→Model(x2)→Output, testing premium user branch.',

  async execute(flowlib) {
    const credential = await ensureAICredential(flowlib);
    console.log(`  📝 Using credential: ${credential.name}`);
    console.log(`  🤖 Provider: ${credential.isOpenAI ? 'OpenAI' : 'Anthropic'}`);

    const flow = await flowlib.flows.create({
      name: `e2e-comprehensive-premium-${Date.now()}`,
    });
    console.log(`  📁 Created flow: ${flow.name} (${flow.id})`);

    const flowDefinition = buildComprehensiveFlowDefinition(
      credential.id,
      credential.isOpenAI,
      true,
    );
    await flowlib.versions.create(flow.id, {
      invectDefinition: flowDefinition,
    });
    console.log(
      `  💾 Saved flow version with ${flowDefinition.nodes.length} nodes, ${flowDefinition.edges.length} edges`,
    );

    console.log(`  🚀 Executing comprehensive flow (premium path)...`);
    console.log(`  ⏳ This involves HTTP request + 2 LLM calls, may take 30-60 seconds...`);

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
    console.log(`  ✅ Flow completed with status: ${result.status}`);

    return result;
  },

  expected(result) {
    assert.equal(
      result.status,
      FlowRunStatus.SUCCESS,
      `Flow should succeed, got: ${result.status}${result.error ? ` - ${result.error}` : ''}`,
    );

    // Verify INPUT node
    const inputNode = result.outputs?.['node-user_request'] as NodeOutput | undefined;
    assert(inputNode, 'Input node should have executed');
    console.log(`  ✓ Input node executed`);

    // Verify HTTP_REQUEST node
    const httpNode = result.outputs?.['node-user_profile_response'] as NodeOutput | undefined;
    assert(httpNode, 'HTTP node should have executed');
    const httpVars = httpNode.data.variables as Record<
      string,
      { value?: { status?: number; ok?: boolean } }
    >;
    const httpOutput = httpVars.output?.value;
    assert(httpOutput?.ok === true, `HTTP request should succeed, got ok: ${httpOutput?.ok}`);
    console.log(`  ✓ HTTP request executed (status: ${httpOutput?.status})`);

    // Verify JS Extract node
    const jsExtractNode = result.outputs?.['node-user_data'] as NodeOutput | undefined;
    assert(jsExtractNode, 'JS extract node should have executed');
    console.log(`  ✓ JS extract node executed`);

    // Verify If-Else took the premium (true) branch
    const ifElseNode = result.outputs?.['node-tier_check'] as NodeOutput | undefined;
    assert(ifElseNode, 'If-Else node should have executed');
    const ifElseVars = ifElseNode.data.variables as Record<string, { value?: unknown }>;
    const trueBranchTaken = ifElseVars.true_output?.value !== undefined;
    assert(trueBranchTaken, 'If-Else should take TRUE (premium) branch');
    console.log(`  ✓ If-Else branched to premium path`);

    // Verify Premium branch nodes executed
    const premiumTemplateNode = result.outputs?.['node-premium_prompt'] as NodeOutput | undefined;
    assert(premiumTemplateNode, 'Premium template should have executed');
    console.log(`  ✓ Premium template executed`);

    const premiumModelNode = result.outputs?.['node-premium_analysis'] as NodeOutput | undefined;
    assert(premiumModelNode, 'Premium model should have executed');
    const premiumModelVars = premiumModelNode.data.variables as Record<string, { value?: unknown }>;
    const premiumAnalysis = premiumModelVars.output?.value as string;
    assert(
      premiumAnalysis && premiumAnalysis.length > 50,
      'Premium analysis should be substantial',
    );
    console.log(`  ✓ Premium model executed (${premiumAnalysis.length} chars)`);

    const premiumJsNode = result.outputs?.['node-formatted_premium'] as NodeOutput | undefined;
    assert(premiumJsNode, 'Premium JS format should have executed');
    console.log(`  ✓ Premium JS format executed`);

    // Verify Basic branch did NOT execute
    const basicModelNode = result.outputs?.['node-basic_summary'] as NodeOutput | undefined;
    if (basicModelNode) {
      const basicVars = basicModelNode.data.variables as Record<string, { value?: unknown }>;
      assert(!basicVars.output?.value, 'Basic model should NOT have executed for premium user');
    }
    console.log(`  ✓ Basic branch correctly skipped`);

    // Verify Final stages
    const combineNode = result.outputs?.['node-combined_result'] as NodeOutput | undefined;
    assert(combineNode, 'Combine template should have executed');
    console.log(`  ✓ Final combine template executed`);

    const polishNode = result.outputs?.['node-polished_result'] as NodeOutput | undefined;
    assert(polishNode, 'Final polish model should have executed');
    const polishVars = polishNode.data.variables as Record<string, { value?: unknown }>;
    const polishedResult = polishVars.output?.value as string;
    assert(polishedResult && polishedResult.length > 50, 'Polished result should have content');
    console.log(`  ✓ Final polish model executed (${polishedResult.length} chars)`);

    // Verify OUTPUT node
    const outputNode = result.outputs?.['node-final_report'] as NodeOutput | undefined;
    assert(outputNode, 'Output node should have executed');
    const outputVars = outputNode.data.variables as Record<string, { value?: unknown }>;
    const finalReport = outputVars.report?.value || outputVars.output?.value;
    assert(finalReport, 'Final report should have content');
    console.log(`  ✓ Output node executed`);

    const preview = String(finalReport).substring(0, 200);
    console.log(`\n  📄 Final Report Preview:\n  "${preview}..."`);
  },
};

// =========================================
// Test Case 2: Basic User Path
// =========================================
export const comprehensiveFlowBasicExample: FlowExample = {
  name: 'Comprehensive Flow (Basic User)',
  description: 'Full flow with HTTP→JS→If-Else→Model(x2)→Output, testing basic user branch.',

  async execute(flowlib) {
    const credential = await ensureAICredential(flowlib);
    console.log(`  📝 Using credential: ${credential.name}`);
    console.log(`  🤖 Provider: ${credential.isOpenAI ? 'OpenAI' : 'Anthropic'}`);

    const flow = await flowlib.flows.create({
      name: `e2e-comprehensive-basic-${Date.now()}`,
    });
    console.log(`  📁 Created flow: ${flow.name} (${flow.id})`);

    const flowDefinition = buildComprehensiveFlowDefinition(
      credential.id,
      credential.isOpenAI,
      false,
    );
    await flowlib.versions.create(flow.id, {
      invectDefinition: flowDefinition,
    });
    console.log(
      `  💾 Saved flow version with ${flowDefinition.nodes.length} nodes, ${flowDefinition.edges.length} edges`,
    );

    console.log(`  🚀 Executing comprehensive flow (basic path)...`);
    console.log(`  ⏳ This involves HTTP request + 2 LLM calls, may take 20-40 seconds...`);

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
    console.log(`  ✅ Flow completed with status: ${result.status}`);

    return result;
  },

  expected(result) {
    assert.equal(
      result.status,
      FlowRunStatus.SUCCESS,
      `Flow should succeed, got: ${result.status}${result.error ? ` - ${result.error}` : ''}`,
    );

    // Verify INPUT node
    const inputNode = result.outputs?.['node-user_request'] as NodeOutput | undefined;
    assert(inputNode, 'Input node should have executed');
    console.log(`  ✓ Input node executed`);

    // Verify HTTP_REQUEST node
    const httpNode = result.outputs?.['node-user_profile_response'] as NodeOutput | undefined;
    assert(httpNode, 'HTTP node should have executed');
    console.log(`  ✓ HTTP request executed`);

    // Verify JS Extract node
    const jsExtractNode = result.outputs?.['node-user_data'] as NodeOutput | undefined;
    assert(jsExtractNode, 'JS extract node should have executed');
    console.log(`  ✓ JS extract node executed`);

    // Verify If-Else took the basic (false) branch
    const ifElseNode = result.outputs?.['node-tier_check'] as NodeOutput | undefined;
    assert(ifElseNode, 'If-Else node should have executed');
    const ifElseVars = ifElseNode.data.variables as Record<string, { value?: unknown }>;
    const falseBranchTaken = ifElseVars.false_output?.value !== undefined;
    assert(falseBranchTaken, 'If-Else should take FALSE (basic) branch');
    console.log(`  ✓ If-Else branched to basic path`);

    // Verify Basic branch nodes executed
    const basicTemplateNode = result.outputs?.['node-basic_prompt'] as NodeOutput | undefined;
    assert(basicTemplateNode, 'Basic template should have executed');
    console.log(`  ✓ Basic template executed`);

    const basicModelNode = result.outputs?.['node-basic_summary'] as NodeOutput | undefined;
    assert(basicModelNode, 'Basic model should have executed');
    const basicModelVars = basicModelNode.data.variables as Record<string, { value?: unknown }>;
    const basicSummary = basicModelVars.output?.value as string;
    assert(basicSummary && basicSummary.length > 20, 'Basic summary should have content');
    console.log(`  ✓ Basic model executed (${basicSummary.length} chars)`);

    const basicJsNode = result.outputs?.['node-formatted_basic'] as NodeOutput | undefined;
    assert(basicJsNode, 'Basic JS format should have executed');
    console.log(`  ✓ Basic JS format executed`);

    // Verify Premium branch did NOT execute
    const premiumModelNode = result.outputs?.['node-premium_analysis'] as NodeOutput | undefined;
    if (premiumModelNode) {
      const premiumVars = premiumModelNode.data.variables as Record<string, { value?: unknown }>;
      assert(!premiumVars.output?.value, 'Premium model should NOT have executed for basic user');
    }
    console.log(`  ✓ Premium branch correctly skipped`);

    // Verify Final stages
    const combineNode = result.outputs?.['node-combined_result'] as NodeOutput | undefined;
    assert(combineNode, 'Combine template should have executed');
    console.log(`  ✓ Final combine template executed`);

    const polishNode = result.outputs?.['node-polished_result'] as NodeOutput | undefined;
    assert(polishNode, 'Final polish model should have executed');
    console.log(`  ✓ Final polish model executed`);

    // Verify OUTPUT node
    const outputNode = result.outputs?.['node-final_report'] as NodeOutput | undefined;
    assert(outputNode, 'Output node should have executed');
    const outputVars = outputNode.data.variables as Record<string, { value?: unknown }>;
    const finalReport = outputVars.report?.value || outputVars.output?.value;
    assert(finalReport, 'Final report should have content');
    console.log(`  ✓ Output node executed`);

    const reportStr = String(finalReport);
    assert(
      reportStr.includes('BASIC') || reportStr.includes('basic') || reportStr.length < 2000,
      'Basic report should be brief or clearly marked as basic',
    );

    const preview = reportStr.substring(0, 200);
    console.log(`\n  📄 Final Report Preview:\n  "${preview}..."`);
  },
};
