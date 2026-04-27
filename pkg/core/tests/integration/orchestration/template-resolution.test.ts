/**
 * Integration tests: Template Resolution in Flow Execution
 *
 * Tests that {{ expression }} template params are correctly resolved against
 * upstream node outputs (incomingData) during real flow execution.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { NodeOutput } from '../../../src/types/node-io-types';
import { createTestFlowlib } from '../helpers/test-flowlib';

describe('Template Resolution', () => {
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
    const flow = await flowlib.flows.create({ name: `tmpl-${name}-${Date.now()}` });
    await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
    return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
  }

  it('should resolve nested object property access in templates', async () => {
    const result = await runFlow('nested-access', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'User',
          referenceId: 'user',
          params: {
            variableName: 'user',
            defaultValue: JSON.stringify({
              profile: { firstName: 'Jane', lastName: 'Doe' },
            }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'tmpl-1',
          type: 'core.template_string',
          label: 'Full Name',
          referenceId: 'full_name',
          params: {
            template: '{{ user.profile.firstName }} {{ user.profile.lastName }}',
          },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'input-1', target: 'tmpl-1' }],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-1')).toBe('Jane Doe');
  });

  it('should resolve templates with multiple upstream sources', async () => {
    const result = await runFlow('multi-upstream', {
      nodes: [
        {
          id: 'input-first',
          type: 'core.input',
          label: 'First',
          referenceId: 'first',
          params: {
            variableName: 'first',
            defaultValue: JSON.stringify({ value: 'Hello' }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'input-second',
          type: 'core.input',
          label: 'Second',
          referenceId: 'second',
          params: {
            variableName: 'second',
            defaultValue: JSON.stringify({ value: 'World' }),
          },
          position: { x: 0, y: 200 },
        },
        {
          id: 'tmpl-merge',
          type: 'core.template_string',
          label: 'Merged',
          referenceId: 'merged',
          params: {
            template: '{{ first.value }} {{ second.value }}',
          },
          position: { x: 300, y: 100 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-first', target: 'tmpl-merge' },
        { id: 'e2', source: 'input-second', target: 'tmpl-merge' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-merge')).toBe('Hello World');
  });

  it('should handle JavaScript output feeding into a template', async () => {
    const result = await runFlow('js-to-template', {
      nodes: [
        {
          id: 'input-1',
          type: 'core.input',
          label: 'Data',
          referenceId: 'data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({ items: ['a', 'b', 'c'], count: 3 }),
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'js-1',
          type: 'core.javascript',
          label: 'Count',
          referenceId: 'count',
          params: { code: '$input.data.count' },
          position: { x: 200, y: 0 },
        },
        {
          id: 'tmpl-1',
          type: 'core.template_string',
          label: 'Summary',
          referenceId: 'summary',
          params: { template: 'There are {{ count }} items' },
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'input-1', target: 'js-1' },
        { id: 'e2', source: 'js-1', target: 'tmpl-1' },
      ],
    });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(getNodeOutput(result, 'tmpl-1')).toBe('There are 3 items');
  });
});
