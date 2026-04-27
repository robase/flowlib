/**
 * Integration tests: Branching Flows
 *
 * Tests if/else branching, node skipping, and data passthrough
 * in branching scenarios through the real Flowlib core.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { NodeOutput } from '../../../src/types/node-io-types';
import { createTestFlowlib } from '../helpers/test-flowlib';

describe('Branching Flows', () => {
  let flowlib: FlowlibInstance;

  beforeAll(async () => {
    flowlib = await createTestFlowlib();
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

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

  async function runFlow(name: string, definition: FlowlibDefinition) {
    const flow = await flowlib.flows.create({ name: `branch-${name}-${Date.now()}` });
    await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
    return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
  }

  /** Builds an if/else flow with configurable input data */
  function buildBranchFlow(value: number): FlowlibDefinition {
    return {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Input',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ value }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Check Value',
          referenceId: 'check',
          params: {
            expression: 'data.value > 50',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-high',
          type: 'core.template_string',
          label: 'High',
          referenceId: 'high',
          params: { template: 'HIGH' },
          position: { x: 400, y: -100 },
        },
        {
          id: 'tmpl-low',
          type: 'core.template_string',
          label: 'Low',
          referenceId: 'low',
          params: { template: 'LOW' },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'if-1' },
        { id: 'e-true', source: 'if-1', target: 'tmpl-high', sourceHandle: 'true_output' },
        { id: 'e-false', source: 'if-1', target: 'tmpl-low', sourceHandle: 'false_output' },
      ],
    };
  }

  it('should correctly route to the true branch when condition is met', async () => {
    const result = await runFlow('true-branch', buildBranchFlow(100));

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-high')).toBe('HIGH');
  });

  it('should correctly route to the false branch when condition is not met', async () => {
    const result = await runFlow('false-branch', buildBranchFlow(10));

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-low')).toBe('LOW');
  });

  it('should skip nodes on the inactive branch', async () => {
    const result = await runFlow('skip-check', buildBranchFlow(100));

    expect(result.status).toBe(FlowRunStatus.SUCCESS);

    // The active branch node should have an output
    expect(getNodeOutput(result, 'tmpl-high')).toBe('HIGH');

    // The inactive branch node should either be absent or have no output
    const lowNode = result.outputs?.['tmpl-low'] as NodeOutput | undefined;
    if (lowNode) {
      const vars = lowNode.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  it('should handle if/else with boolean condition directly', async () => {
    const result = await runFlow('boolean-condition', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Flags',
          referenceId: 'flags',
          params: {
            variableName: 'flags',
            defaultValue: JSON.stringify({ isEnabled: true }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Enabled?',
          referenceId: 'enabled_check',
          params: {
            expression: 'flags.isEnabled === true',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-yes',
          type: 'core.template_string',
          label: 'Enabled',
          referenceId: 'yes',
          params: { template: 'Feature is ON' },
          position: { x: 400, y: -100 },
        },
        {
          id: 'tmpl-no',
          type: 'core.template_string',
          label: 'Disabled',
          referenceId: 'no',
          params: { template: 'Feature is OFF' },
          position: { x: 400, y: 100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'if-1' },
        { id: 'e-true', source: 'if-1', target: 'tmpl-yes', sourceHandle: 'true_output' },
        { id: 'e-false', source: 'if-1', target: 'tmpl-no', sourceHandle: 'false_output' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-yes')).toBe('Feature is ON');
  });

  it('should pass data through if/else node to downstream templates', async () => {
    // The if/else node acts as a passthrough — downstream nodes should
    // access the data that was passed INTO the if/else node.
    const result = await runFlow('passthrough-data', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'User',
          referenceId: 'user',
          params: {
            variableName: 'user',
            defaultValue: JSON.stringify({ name: 'Alice', age: 21 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Is Adult?',
          referenceId: 'adult_check',
          params: {
            expression: 'user.age >= 18',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-greeting',
          type: 'core.template_string',
          label: 'Greeting',
          referenceId: 'greeting',
          params: {
            template: 'Welcome {{ adult_check.user.name }}!',
          },
          position: { x: 400, y: -100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'if-1' },
        {
          id: 'e-true',
          source: 'if-1',
          target: 'tmpl-greeting',
          sourceHandle: 'true_output',
        },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-greeting')).toContain('Alice');
  });

  // ------- core.switch tests -------

  function buildSwitchFlow(priority: string): FlowlibDefinition {
    return {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Input',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ priority }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'switch-1',
          type: 'core.switch',
          label: 'Route',
          referenceId: 'route',
          params: {
            cases: [
              { slug: 'high', label: 'High', expression: 'data.priority === "high"' },
              { slug: 'medium', label: 'Medium', expression: 'data.priority === "medium"' },
              { slug: 'low', label: 'Low', expression: 'data.priority === "low"' },
            ],
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-high',
          type: 'core.template_string',
          label: 'High',
          referenceId: 'high_out',
          params: { template: 'HIGH' },
          position: { x: 400, y: -150 },
        },
        {
          id: 'tmpl-medium',
          type: 'core.template_string',
          label: 'Medium',
          referenceId: 'medium_out',
          params: { template: 'MEDIUM' },
          position: { x: 400, y: 0 },
        },
        {
          id: 'tmpl-low',
          type: 'core.template_string',
          label: 'Low',
          referenceId: 'low_out',
          params: { template: 'LOW' },
          position: { x: 400, y: 150 },
        },
        {
          id: 'tmpl-default',
          type: 'core.template_string',
          label: 'Default',
          referenceId: 'default_out',
          params: { template: 'DEFAULT' },
          position: { x: 400, y: 300 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'switch-1' },
        { id: 'e-high', source: 'switch-1', target: 'tmpl-high', sourceHandle: 'high' },
        { id: 'e-medium', source: 'switch-1', target: 'tmpl-medium', sourceHandle: 'medium' },
        { id: 'e-low', source: 'switch-1', target: 'tmpl-low', sourceHandle: 'low' },
        { id: 'e-default', source: 'switch-1', target: 'tmpl-default', sourceHandle: 'default' },
      ],
    };
  }

  it('switch: should route to the matching case (high)', async () => {
    const result = await runFlow('switch-high', buildSwitchFlow('high'));
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-high')).toBe('HIGH');
  });

  it('switch: should route to the matching case (medium)', async () => {
    const result = await runFlow('switch-medium', buildSwitchFlow('medium'));
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-medium')).toBe('MEDIUM');
  });

  it('switch: should fall through to default when no case matches', async () => {
    const result = await runFlow('switch-default', buildSwitchFlow('critical'));
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-default')).toBe('DEFAULT');
  });

  it('switch: should skip inactive branches', async () => {
    const result = await runFlow('switch-skip', buildSwitchFlow('low'));
    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-low')).toBe('LOW');

    // Non-matched branches should be skipped (no output)
    const highNode = result.outputs?.['tmpl-high'] as NodeOutput | undefined;
    if (highNode) {
      const vars = highNode.data.variables as Record<string, { value?: unknown }>;
      expect(vars.output?.value).toBeUndefined();
    }
  });

  // ------- Diamond merge: multiple switch branches → same node -------

  it('diamond merge: node reachable via active and inactive branches should execute', async () => {
    const result = await runFlow('diamond-merge', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Input',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ value: 'A' }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'switch-1',
          type: 'core.switch',
          label: 'Route',
          referenceId: 'route',
          params: {
            cases: [
              { slug: 'case_a', label: 'A', expression: 'data.value === "A"' },
              { slug: 'case_b', label: 'B', expression: 'data.value === "B"' },
            ],
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'merge-node',
          type: 'core.template_string',
          label: 'Merge',
          referenceId: 'merge',
          params: { template: 'MERGED' },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'switch-1' },
        // Both branches point to the same merge node
        { id: 'e-a', source: 'switch-1', target: 'merge-node', sourceHandle: 'case_a' },
        { id: 'e-b', source: 'switch-1', target: 'merge-node', sourceHandle: 'case_b' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    // Merge node should execute because case_a (active) feeds into it
    expect(getNodeOutput(result, 'merge-node')).toBe('MERGED');
  });

  // ------- if_else with JS expression (new format) -------

  it('if_else with JS expression: should evaluate correctly', async () => {
    const result = await runFlow('if-else-js-expr', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Input',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ score: 85 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if-1',
          type: 'core.if_else',
          label: 'Check Score',
          referenceId: 'check',
          params: {
            expression: 'data.score >= 70',
          },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-pass',
          type: 'core.template_string',
          label: 'Pass',
          referenceId: 'pass',
          params: { template: 'PASS' },
          position: { x: 400, y: -100 },
        },
        {
          id: 'tmpl-fail',
          type: 'core.template_string',
          label: 'Fail',
          referenceId: 'fail',
          params: { template: 'FAIL' },
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
    expect(getNodeOutput(result, 'tmpl-pass')).toBe('PASS');
  });
});
