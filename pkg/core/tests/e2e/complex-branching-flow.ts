/**
 * E2E Test: Complex Branching Flow
 *
 * Tests a more complex flow with multiple node types:
 *
 * Flow structure:
 *   Input (user_data)
 *       ↓
 *   JavaScript (extract/transform data)
 *       ↓
 *   If-Else (age >= 18?)
 *      ↓ True          ↓ False
 *   Template         Template
 *   (adult msg)      (minor msg)
 *
 * This tests:
 * - Input node with JSON data
 * - JavaScript node for data transformation
 * - If-Else conditional branching using incomingData for condition evaluation
 * - Template String nodes on different branches
 * - Proper branch execution (only one path should execute)
 */
import { strict as assert } from 'node:assert';
import { FlowRunStatus, type NodeOutput } from '../../src';
import { defineFlow, input, javascript, ifElse, template } from '@flowlib/sdk';
import type { FlowExample } from './example-types';

/**
 * Build the complex branching flow definition using the SDK
 */
function buildFlowDefinition(isAdult: boolean) {
  const userData = {
    name: isAdult ? 'Alice' : 'Bobby',
    age: isAdult ? 25 : 15,
    email: isAdult ? 'alice@example.com' : 'bobby@example.com',
  };

  return defineFlow({
    name: 'Complex Branching Flow',
    description: 'Tests JavaScript transformation and If-Else branching',
    nodes: [
      input('user_data', {
        variableName: 'user',
        defaultValue: JSON.stringify(userData),
      }),

      javascript(
        'user_info',
        {
          code: 'const d = user_data; return { name: d.name, age: d.age, isAdult: d.age >= 18 }',
        },
        { label: 'Extract User Info' },
      ),

      ifElse(
        'age_check',
        {
          condition: { '==': [{ var: 'user_info.isAdult' }, true] },
        },
        { label: 'Is Adult?' },
      ),

      template('adult_message', {
        template: 'Welcome {{ age_check.user_info.name }}! You have full access to all features.',
      }),

      template('minor_message', {
        template:
          'Hi {{ age_check.user_info.name }}! Some features are restricted for users under 18.',
      }),
    ],
    edges: [
      { from: 'user_data', to: 'user_info' },
      { from: 'user_info', to: 'age_check' },
      { from: 'age_check', to: 'adult_message', handle: 'true_output' },
      { from: 'age_check', to: 'minor_message', handle: 'false_output' },
    ],
  });
}

export const complexBranchingFlowExample: FlowExample = {
  name: 'Complex Branching Flow (Adult Path)',
  description: 'Tests Input → JS → If-Else → Template with conditional branching (adult user).',

  async execute(flowlib) {
    const flow = await flowlib.flows.create({
      name: `e2e-complex-branching-adult-${Date.now()}`,
    });
    console.log(`  📁 Created flow: ${flow.name} (${flow.id})`);

    const flowDefinition = buildFlowDefinition(true);
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: flowDefinition,
    });
    console.log(`  💾 Saved flow version with ${flowDefinition.nodes.length} nodes`);

    console.log(`  🚀 Executing flow with adult user (age 25)...`);
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

    // Verify Input node executed
    const inputNode = result.outputs?.['node-user_data'] as NodeOutput | undefined;
    assert(inputNode, 'Input node outputs should be present');
    const inputVars = inputNode.data.variables as Record<string, { value?: unknown }>;
    const inputValue = inputVars.output?.value;
    assert(inputValue, 'Input node should have output value');

    const userData = typeof inputValue === 'string' ? JSON.parse(inputValue) : inputValue;
    assert.equal(userData.name, 'Alice', 'User name should be Alice');
    assert.equal(userData.age, 25, 'User age should be 25');
    console.log(`  📄 Input: ${JSON.stringify(userData)}`);

    // Verify JavaScript node executed
    const jsNode = result.outputs?.['node-user_info'] as NodeOutput | undefined;
    assert(jsNode, 'JavaScript node outputs should be present');
    const jsVars = jsNode.data.variables as Record<string, { value?: unknown }>;
    const jsOutputRaw = jsVars.output?.value;
    assert(jsOutputRaw, 'JavaScript node should have output');
    const jsOutput = typeof jsOutputRaw === 'string' ? JSON.parse(jsOutputRaw) : jsOutputRaw;
    assert.equal(jsOutput.isAdult, true, 'JavaScript should identify user as adult');
    console.log(`  📄 JS output: ${JSON.stringify(jsOutput)}`);

    // Verify If-Else node executed
    const ifElseNode = result.outputs?.['node-age_check'] as NodeOutput | undefined;
    assert(ifElseNode, 'If-Else node outputs should be present');
    const ifElseVars = ifElseNode.data.variables as Record<string, { value?: unknown }>;
    const trueBranchTaken = ifElseVars.true_output?.value !== undefined;
    assert(trueBranchTaken, 'If-Else should have executed True branch (true_output)');
    console.log(`  📄 If-Else result: True branch taken`);

    // Verify Adult Template executed (True branch)
    const adultTemplate = result.outputs?.['node-adult_message'] as NodeOutput | undefined;
    assert(adultTemplate, 'Adult template node should have executed');
    const adultVars = adultTemplate.data.variables as Record<string, { value?: unknown }>;
    const adultMessage = adultVars.output?.value as string;
    assert(adultMessage, 'Adult template should have output');
    assert(
      adultMessage.includes('Welcome') && adultMessage.includes('Alice'),
      `Adult message should welcome Alice, got: ${adultMessage}`,
    );
    console.log(`  📄 Adult message: "${adultMessage}"`);

    // Verify Minor Template did NOT execute (False branch should be skipped)
    const minorTemplate = result.outputs?.['node-minor_message'] as NodeOutput | undefined;
    if (minorTemplate) {
      const minorVars = minorTemplate.data.variables as Record<string, { value?: unknown }>;
      const minorExecuted = minorVars.output?.value !== undefined;
      assert(!minorExecuted, 'Minor template should NOT have executed for adult user');
    }
    console.log(`  ✓ Minor branch correctly skipped`);
  },
};

export const complexBranchingFlowMinorExample: FlowExample = {
  name: 'Complex Branching Flow (Minor Path)',
  description: 'Tests Input → JS → If-Else → Template with conditional branching (minor user).',

  async execute(flowlib) {
    const flow = await flowlib.flows.create({
      name: `e2e-complex-branching-minor-${Date.now()}`,
    });
    console.log(`  📁 Created flow: ${flow.name} (${flow.id})`);

    const flowDefinition = buildFlowDefinition(false);
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: flowDefinition,
    });
    console.log(`  💾 Saved flow version with ${flowDefinition.nodes.length} nodes`);

    console.log(`  🚀 Executing flow with minor user (age 15)...`);
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

    // Verify Input node executed
    const inputNode = result.outputs?.['node-user_data'] as NodeOutput | undefined;
    assert(inputNode, 'Input node outputs should be present');
    const inputVars = inputNode.data.variables as Record<string, { value?: unknown }>;
    const inputValue = inputVars.output?.value;
    const userData = typeof inputValue === 'string' ? JSON.parse(inputValue) : inputValue;
    assert.equal(userData.name, 'Bobby', 'User name should be Bobby');
    assert.equal(userData.age, 15, 'User age should be 15');
    console.log(`  📄 Input: ${JSON.stringify(userData)}`);

    // Verify JavaScript node executed
    const jsNode = result.outputs?.['node-user_info'] as NodeOutput | undefined;
    assert(jsNode, 'JavaScript node outputs should be present');
    const jsVars = jsNode.data.variables as Record<string, { value?: unknown }>;
    const jsOutputRaw = jsVars.output?.value;
    assert(jsOutputRaw, 'JavaScript node should have output');
    const jsOutput = typeof jsOutputRaw === 'string' ? JSON.parse(jsOutputRaw) : jsOutputRaw;
    assert.equal(jsOutput.isAdult, false, 'JavaScript should identify user as minor');
    console.log(`  📄 JS output: ${JSON.stringify(jsOutput)}`);

    // Verify If-Else node took false branch
    const ifElseNode = result.outputs?.['node-age_check'] as NodeOutput | undefined;
    assert(ifElseNode, 'If-Else node outputs should be present');
    const ifElseVars = ifElseNode.data.variables as Record<string, { value?: unknown }>;
    const falseBranchTaken = ifElseVars.false_output?.value !== undefined;
    assert(falseBranchTaken, 'If-Else should have executed False branch (false_output)');
    console.log(`  📄 If-Else result: False branch taken`);

    // Verify Minor Template executed (False branch)
    const minorTemplate = result.outputs?.['node-minor_message'] as NodeOutput | undefined;
    assert(minorTemplate, 'Minor template node should have executed');
    const minorVars = minorTemplate.data.variables as Record<string, { value?: unknown }>;
    const minorMessage = minorVars.output?.value as string;
    assert(minorMessage, 'Minor template should have output');
    assert(
      minorMessage.includes('Hi') && minorMessage.includes('Bobby'),
      `Minor message should greet Bobby, got: ${minorMessage}`,
    );
    console.log(`  📄 Minor message: "${minorMessage}"`);

    // Verify Adult Template did NOT execute (True branch should be skipped)
    const adultTemplate = result.outputs?.['node-adult_message'] as NodeOutput | undefined;
    if (adultTemplate) {
      const adultVars = adultTemplate.data.variables as Record<string, { value?: unknown }>;
      const adultExecuted = adultVars.output?.value !== undefined;
      assert(!adultExecuted, 'Adult template should NOT have executed for minor user');
    }
    console.log(`  ✓ Adult branch correctly skipped`);
  },
};
