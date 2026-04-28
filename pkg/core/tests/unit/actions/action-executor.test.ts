/**
 * Unit tests: action-executor — coerceJsonStringParams + executeActionAsNode
 *
 * Tests the JSON coercion layer that converts stringified JSON params
 * (from the UI config panel) back into real objects/arrays before Zod
 * validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { coerceJsonStringParams, executeActionAsNode } from '@flowlib/actions';
import { manualTriggerAction } from '@flowlib/actions';
import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '@flowlib/actions/providers';
import { NodeExecutionStatus } from 'src/types/base';
import { z } from 'zod/v4';
import type { ActionExecutionContext } from '@flowlib/action-kit';
import type { NodeExecutionContext } from 'src/types.internal';

// ---------------------------------------------------------------------------
// coerceJsonStringParams
// ---------------------------------------------------------------------------

describe('coerceJsonStringParams', () => {
  it('should parse a JSON object string into a real object', () => {
    const result = coerceJsonStringParams({
      defaultInputs: '{ "email": "test@example.com", "topic": "general" }',
    });
    expect(result.defaultInputs).toEqual({ email: 'test@example.com', topic: 'general' });
  });

  it('should parse a JSON array string into a real array', () => {
    const result = coerceJsonStringParams({
      config: '[1, 2, 3]',
    });
    expect(result.config).toEqual([1, 2, 3]);
  });

  it('should parse a JSON object string into a real object (generic)', () => {
    const result = coerceJsonStringParams({
      config: '{ "retries": 3, "timeout": 5000 }',
    });
    expect(result.config).toEqual({ retries: 3, timeout: 5000 });
  });

  it('should convert an empty string to undefined', () => {
    const result = coerceJsonStringParams({ defaultInputs: '' });
    expect(result.defaultInputs).toBeUndefined();
  });

  it('should convert a whitespace-only string to undefined', () => {
    const result = coerceJsonStringParams({ defaultInputs: '   ' });
    expect(result.defaultInputs).toBeUndefined();
  });

  it('should leave template expressions as strings', () => {
    const result = coerceJsonStringParams({
      query: '{{ upstream.data }}',
    });
    expect(result.query).toBe('{{ upstream.data }}');
  });

  it('should leave non-JSON strings as strings', () => {
    const result = coerceJsonStringParams({
      name: 'Hello World',
      prompt: 'Summarize the data',
    });
    expect(result.name).toBe('Hello World');
    expect(result.prompt).toBe('Summarize the data');
  });

  it('should leave numbers, booleans, and null unchanged', () => {
    const result = coerceJsonStringParams({
      count: 5,
      enabled: true,
      data: null,
    });
    expect(result.count).toBe(5);
    expect(result.enabled).toBe(true);
    expect(result.data).toBeNull();
  });

  it('should leave real arrays and objects unchanged', () => {
    const arr = [{ name: 'a' }];
    const obj = { key: 'value' };
    const result = coerceJsonStringParams({ arr, obj });
    expect(result.arr).toBe(arr);
    expect(result.obj).toBe(obj);
  });

  it('should handle invalid JSON strings gracefully', () => {
    const result = coerceJsonStringParams({
      bad: '[{ broken json',
    });
    expect(result.bad).toBe('[{ broken json');
  });

  it('should handle pretty-printed JSON (multiline)', () => {
    const json = `{
  "email": "test@example.com",
  "topic": "hello"
}`;
    const result = coerceJsonStringParams({ defaultInputs: json });
    expect(result.defaultInputs).toEqual({ email: 'test@example.com', topic: 'hello' });
  });

  it('should not parse strings containing {{ even if they look like JSON', () => {
    const result = coerceJsonStringParams({
      data: '{{ [1, 2, 3] }}',
    });
    expect(result.data).toBe('{{ [1, 2, 3] }}');
  });
});

// ---------------------------------------------------------------------------
// trigger.manual — execute with stringified vs real params
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    incomingData: {},
    credential: undefined,
    flowInputs: {},
    flowContext: { nodeId: 'trigger-1', flowRunId: 'run-1' },
    functions: {},
    flowRunState: undefined,
    ...overrides,
  } as ActionExecutionContext;
}

describe('trigger.manual with coerced params', () => {
  it('should use defaultInputs when no flowInputs are provided (manual run)', async () => {
    const ctx = makeContext({ flowInputs: {} });
    const result = await manualTriggerAction.execute(
      { defaultInputs: { topic: 'general', severity: 'medium' } },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ topic: 'general', severity: 'medium' });
  });

  it('should use flowInputs when provided, overriding defaults (code-triggered run)', async () => {
    const ctx = makeContext({
      flowInputs: { email: 'test@example.com', topic: 'bug' },
    });
    const result = await manualTriggerAction.execute(
      { defaultInputs: { topic: 'general', severity: 'medium' } },
      ctx,
    );
    expect(result.success).toBe(true);
    // flowInputs override defaults; severity falls back to default
    expect(result.output).toEqual({ email: 'test@example.com', topic: 'bug', severity: 'medium' });
  });

  it('should accept defaultInputs as a JSON string after coercion', async () => {
    const ctx = makeContext({ flowInputs: {} });
    const coerced = coerceJsonStringParams({
      defaultInputs: '{ "topic": "general", "count": 5 }',
    });
    const parsed = manualTriggerAction.params.schema.safeParse(coerced);
    expect(parsed.success).toBe(true);

    const result = await manualTriggerAction.execute(parsed.data!, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ topic: 'general', count: 5 });
  });

  it('should pass through all flowInputs when no defaultInputs are configured', async () => {
    const ctx = makeContext({ flowInputs: { anything: 'goes' } });
    const coerced = coerceJsonStringParams({ defaultInputs: '' });
    const parsed = manualTriggerAction.params.schema.safeParse(coerced);
    expect(parsed.success).toBe(true);

    const result = await manualTriggerAction.execute(parsed.data!, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ anything: 'goes' });
  });

  it('should return empty output when no defaults and no flowInputs', async () => {
    const ctx = makeContext({ flowInputs: {} });
    const result = await manualTriggerAction.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({});
  });

  it('should strip internal trigger keys from flowInputs', async () => {
    const ctx = makeContext({
      flowInputs: { email: 'test@example.com', __triggerData: 'internal', __triggerNodeId: 'n1' },
    });
    const result = await manualTriggerAction.execute({ defaultInputs: { severity: 'low' } }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ severity: 'low', email: 'test@example.com' });
    expect(result.output).not.toHaveProperty('__triggerData');
    expect(result.output).not.toHaveProperty('__triggerNodeId');
  });
});

// ---------------------------------------------------------------------------
// executeActionAsNode — batch submission detection
// ---------------------------------------------------------------------------

/** A fake action that returns a batch submitted metadata flag */
const batchAction = defineAction({
  id: 'test.batch_action',
  name: 'Test Batch Action',
  description: 'Action that simulates a batch submission',
  provider: CORE_PROVIDER,
  params: {
    schema: z.object({ prompt: z.string() }),
    fields: [{ name: 'prompt', label: 'Prompt', type: 'text', required: true }],
  },
  async execute(_params, _context) {
    return {
      success: true,
      output: undefined,
      metadata: {
        __batchSubmitted: true,
        batchJobId: 'batch-123',
        nodeId: 'node-1',
        flowRunId: 'run-1',
      },
    };
  },
});

/** A fake action that returns a normal success result */
const normalAction = defineAction({
  id: 'test.normal_action',
  name: 'Test Normal Action',
  description: 'Action that returns normally',
  provider: CORE_PROVIDER,
  params: {
    schema: z.object({ prompt: z.string() }),
    fields: [{ name: 'prompt', label: 'Prompt', type: 'text', required: true }],
  },
  async execute(_params, _context) {
    return { success: true, output: 'hello' };
  },
});

function makeNodeContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    nodeId: 'node-1',
    flowRunId: 'run-1',
    flowId: 'flow-1',
    traceId: 'trace-1',
    incomingData: {},
    flowInputs: {},
    functions: {},
    edges: [],
    nodes: [],
    skippedNodeIds: new Set(),
    flowParams: {},
    ...overrides,
  } as unknown as NodeExecutionContext;
}

describe('executeActionAsNode — batch detection', () => {
  it('should return PENDING status when action signals batch submission', async () => {
    const result = await executeActionAsNode(batchAction, { prompt: 'test' }, makeNodeContext());

    expect(result.state).toBe(NodeExecutionStatus.PENDING);
    if (result.state === NodeExecutionStatus.PENDING) {
      expect(result.type).toBe('batch_submitted');
      expect(result.batchJobId).toBe('batch-123');
      expect(result.nodeId).toBe('node-1');
      expect(result.executionId).toBe('run-1');
    }
  });

  it('should return SUCCESS status for normal action results', async () => {
    const result = await executeActionAsNode(normalAction, { prompt: 'test' }, makeNodeContext());

    expect(result.state).toBe(NodeExecutionStatus.SUCCESS);
  });
});
