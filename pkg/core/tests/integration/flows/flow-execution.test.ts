/**
 * Integration tests: Flow Execution
 *
 * Tests executing flows through the Invect core with a real in-memory
 * SQLite database. Covers input→node→output data flow, JavaScript transformations,
 * template strings, and if/else branching.
 *
 * No AI/LLM calls are needed — these tests use deterministic node types only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type { InvectInstance } from '../../../src/api/types';
import type { InvectDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { NodeOutput } from '../../../src/types/node-io-types';
import { createTestInvect } from '../helpers/test-flowlib';

describe('Flow Execution', () => {
  let flowlib: InvectInstance;

  beforeAll(async () => {
    flowlib = await createTestInvect();
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  /** Helper: create a flow, save a version, and execute it */
  async function runFlow(name: string, definition: InvectDefinition) {
    const flow = await flowlib.flows.create({ name: `exec-${name}-${Date.now()}` });
    await flowlib.versions.create(flow.id, { invectDefinition: definition });
    return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
  }

  /** Helper to extract a node's output value */
  function getNodeOutput(result: { outputs?: Record<string, unknown> }, nodeId: string) {
    const node = result.outputs?.[nodeId] as NodeOutput | undefined;
    if (!node) {
      return undefined;
    }
    const vars = node.data.variables as Record<string, { value?: unknown }>;
    const raw = vars.output?.value;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  // ---------------------------------------------------------------------------
  // Basic: Input → Output
  // ---------------------------------------------------------------------------

  it('should execute a single input node', async () => {
    const result = await runFlow('single-input', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Data',
          referenceId: 'data',
          params: { variableName: 'greeting', defaultValue: '"hello world"' },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'input-1')).toBe('hello world');
  });

  // ---------------------------------------------------------------------------
  // Input → JQ Transformation
  // ---------------------------------------------------------------------------

  it('should pass data through Input → JavaScript', async () => {
    const result = await runFlow('input-js', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'User',
          referenceId: 'user',
          params: {
            variableName: 'user',
            defaultValue: JSON.stringify({ name: 'Alice', age: 30 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'js-1',
          type: 'core.javascript',
          label: 'Extract Name',
          referenceId: 'extracted',
          params: {
            code: '$input.user.name',
          },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'input-1', target: 'js-1' }],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'js-1')).toBe('Alice');
  });

  // ---------------------------------------------------------------------------
  // Input → Template String
  // ---------------------------------------------------------------------------

  it('should resolve template strings with upstream data', async () => {
    const result = await runFlow('input-template', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'User',
          referenceId: 'user',
          params: {
            variableName: 'user',
            defaultValue: JSON.stringify({ name: 'Bob' }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'tmpl-1',
          type: 'core.template_string',
          label: 'Greeting',
          referenceId: 'greeting',
          params: {
            template: 'Hello {{ user.name }}, welcome!',
          },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'input-1', target: 'tmpl-1' }],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-1')).toBe('Hello Bob, welcome!');
  });

  // ---------------------------------------------------------------------------
  // If/Else Branching — True branch
  // ---------------------------------------------------------------------------

  it('should take the true branch of an if/else node', async () => {
    const result = await runFlow('if-else-true', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Data',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ score: 90 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Check Score',
          referenceId: 'score_check',
          params: {
            expression: 'data.score >= 80',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-pass',
          type: 'core.template_string',
          label: 'Pass',
          referenceId: 'pass_msg',
          params: { template: 'Passed!' },
          position: { x: 400, y: -100 },
        },
        {
          id: 'tmpl-fail',
          type: 'core.template_string',
          label: 'Fail',
          referenceId: 'fail_msg',
          params: { template: 'Failed.' },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'if-1' },
        { id: 'e-true', source: 'if-1', target: 'tmpl-pass', sourceHandle: 'true_output' },
        { id: 'e-false', source: 'if-1', target: 'tmpl-fail', sourceHandle: 'false_output' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // True branch should have executed
    expect(getNodeOutput(result, 'tmpl-pass')).toBe('Passed!');

    // False branch should be skipped (no output or undefined)
    const failNode = result.outputs?.['tmpl-fail'] as NodeOutput | undefined;
    if (failNode) {
      const vars = failNode.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // If/Else Branching — False branch
  // ---------------------------------------------------------------------------

  it('should take the false branch of an if/else node', async () => {
    const result = await runFlow('if-else-false', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Data',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ score: 50 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Check Score',
          referenceId: 'score_check',
          params: {
            expression: 'data.score >= 80',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-pass',
          type: 'core.template_string',
          label: 'Pass',
          referenceId: 'pass_msg',
          params: { template: 'Passed!' },
          position: { x: 400, y: -100 },
        },
        {
          id: 'tmpl-fail',
          type: 'core.template_string',
          label: 'Fail',
          referenceId: 'fail_msg',
          params: { template: 'Failed.' },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'if-1' },
        { id: 'e-true', source: 'if-1', target: 'tmpl-pass', sourceHandle: 'true_output' },
        { id: 'e-false', source: 'if-1', target: 'tmpl-fail', sourceHandle: 'false_output' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // False branch should have executed
    expect(getNodeOutput(result, 'tmpl-fail')).toBe('Failed.');

    // True branch should be skipped
    const passNode = result.outputs?.['tmpl-pass'] as NodeOutput | undefined;
    if (passNode) {
      const vars = passNode.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // Multi-step chain: Input → JQ → If-Else → Template
  // ---------------------------------------------------------------------------

  it('should execute a full Input → JavaScript → If-Else → Template chain', async () => {
    const definition: InvectDefinition = {
      nodes: [
        {
          id: 'input-user',
          type: 'core.input',
          label: 'User Data',
          referenceId: 'user_data',
          params: {
            variableName: 'user',
            defaultValue: JSON.stringify({ name: 'Alice', age: 25, email: 'alice@example.com' }),
          },
          position: { x: 100, y: 200 },
        },
        {
          id: 'js-extract',
          type: 'core.javascript',
          label: 'Extract User Info',
          referenceId: 'user_info',
          params: {
            code: '({ name: $input.user_data.name, age: $input.user_data.age, isAdult: $input.user_data.age >= 18 })',
          },
          position: { x: 300, y: 200 },
        },
        {
          id: 'if-adult',
          type: 'core.if_else',
          label: 'Is Adult?',
          referenceId: 'age_check',
          params: {
            expression: 'user_info.isAdult === true',
          },
          position: { x: 500, y: 200 },
        },
        {
          id: 'template-adult',
          type: 'core.template_string',
          label: 'Adult Message',
          referenceId: 'adult_message',
          params: {
            template:
              'Welcome {{ age_check.user_info.name }}! You have full access to all features.',
          },
          position: { x: 700, y: 100 },
        },
        {
          id: 'template-minor',
          type: 'core.template_string',
          label: 'Minor Message',
          referenceId: 'minor_message',
          params: {
            template:
              'Hi {{ age_check.user_info.name }}! Some features are restricted for users under 18.',
          },
          position: { x: 700, y: 300 },
        },
      ],
      edges: [
        { id: 'e-input-to-js', source: 'input-user', target: 'js-extract' },
        { id: 'e-js-to-ifelse', source: 'js-extract', target: 'if-adult' },
        {
          id: 'e-ifelse-true',
          source: 'if-adult',
          target: 'template-adult',
          sourceHandle: 'true_output',
        },
        {
          id: 'e-ifelse-false',
          source: 'if-adult',
          target: 'template-minor',
          sourceHandle: 'false_output',
        },
      ],
    };

    const result = await runFlow('full-chain-adult', definition);

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // JS should have produced the transformed data
    const jsOutput = getNodeOutput(result, 'js-extract');
    expect(jsOutput).toMatchObject({ name: 'Alice', isAdult: true });

    // Adult template should have executed
    const adultMsg = getNodeOutput(result, 'template-adult');
    expect(adultMsg).toContain('Welcome');
    expect(adultMsg).toContain('Alice');

    // Minor template should NOT have executed
    const minorNode = result.outputs?.['template-minor'] as NodeOutput | undefined;
    if (minorNode) {
      const vars = minorNode.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // Flow run records are persisted
  // ---------------------------------------------------------------------------

  it('should persist flow run records', async () => {
    const flow = await flowlib.flows.create({ name: `run-record-${Date.now()}` });
    await flowlib.versions.create(flow.id, {
      invectDefinition: {
        nodes: [
          {
            id: 'input-1',
            type: 'core.input',
            label: 'X',
            referenceId: 'x',
            params: { variableName: 'x', defaultValue: '1' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    });

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
    expect(result.flowRunId).toBeTruthy();

    // Verify the run is persisted
    const runs = await flowlib.runs.listByFlowId(flow.id);
    expect(runs.data.length).toBeGreaterThanOrEqual(1);
    expect(runs.data.some((r) => r.id === result.flowRunId)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Node execution traces are persisted
  // ---------------------------------------------------------------------------

  it('should persist node execution traces', async () => {
    const flow = await flowlib.flows.create({ name: `trace-test-${Date.now()}` });
    await flowlib.versions.create(flow.id, {
      invectDefinition: {
        nodes: [
          {
            id: 'input-1',
            type: 'core.input',
            label: 'A',
            referenceId: 'a',
            params: { variableName: 'a', defaultValue: '"test"' },
            position: { x: 0, y: 0 },
          },
          {
            id: 'js-1',
            type: 'core.javascript',
            label: 'B',
            referenceId: 'b',
            params: { code: '$input.a' },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'input-1', target: 'js-1' }],
      },
    });

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
    const tracesResult = await flowlib.runs.getNodeExecutions(result.flowRunId);

    expect(tracesResult.data.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // trigger.manual — defaultInputs (manual run defaults + code-triggered override)
  // ---------------------------------------------------------------------------

  describe('trigger.manual defaultInputs', () => {
    it('should use defaultInputs when no flowInputs are provided (manual run)', async () => {
      const result = await runFlow('trigger-manual-defaults', {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger.manual',
            label: 'Start',
            referenceId: 'start',
            params: {
              defaultInputs: { topic: 'general', severity: 'medium' },
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'trigger-1')).toEqual({ topic: 'general', severity: 'medium' });
    });

    it('should accept defaultInputs as a JSON string (from UI config panel)', async () => {
      const result = await runFlow('trigger-defaults-json-string', {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger.manual',
            label: 'Start',
            referenceId: 'start',
            params: {
              // UI config panel stores this as a stringified JSON object
              defaultInputs: '{ "topic": "general", "severity": "medium" }',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'trigger-1')).toEqual({ topic: 'general', severity: 'medium' });
    });

    it('should override defaults with caller inputs (code-triggered run)', async () => {
      const flow = await flowlib.flows.create({ name: `trigger-code-override-${Date.now()}` });
      await flowlib.versions.create(flow.id, {
        invectDefinition: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger.manual',
              label: 'Start',
              referenceId: 'start',
              params: {
                defaultInputs: { topic: 'general', severity: 'medium' },
              },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });

      const result = await flowlib.runs.start(
        flow.id,
        { topic: 'billing', email: 'user@example.com' },
        { useBatchProcessing: false },
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      // topic overridden by caller; severity falls back to default; email added by caller
      expect(getNodeOutput(result, 'trigger-1')).toEqual({
        topic: 'billing',
        severity: 'medium',
        email: 'user@example.com',
      });
    });

    it('should pass through all flowInputs when no defaultInputs configured', async () => {
      const flow = await flowlib.flows.create({ name: `trigger-passthrough-${Date.now()}` });
      await flowlib.versions.create(flow.id, {
        invectDefinition: {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger.manual',
              label: 'Start',
              referenceId: 'start',
              params: { defaultInputs: '' },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });

      const result = await flowlib.runs.start(
        flow.id,
        { anything: 'works' },
        { useBatchProcessing: false },
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'trigger-1')).toEqual({ anything: 'works' });
    });
  });
});
