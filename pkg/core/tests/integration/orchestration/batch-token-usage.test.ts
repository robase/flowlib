/**
 * Integration tests: batch resumption surfaces token usage + fires plugin
 * hooks with the resolved real node type.
 *
 * Covers:
 *   1. OpenAI batch JSONL `usage` flows from adapter → batchJob.responseData
 *      → resumed node output metadata
 *   2. `afterNodeExecute` fires on batch resumption with the persisted
 *      node type (not hardcoded `core.model`)
 *   3. `afterAgentExecute` fires for agent-batch resumption with token
 *      totals from the batch's usage field, toolCallCount = 0
 *   4. When the batch usage is missing, the node still resumes successfully
 *      and hooks fire with tokens defaulting to 0
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { FlowlibPlugin } from '../../../src/types/plugin.types';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// OpenAI batch fixtures
// ---------------------------------------------------------------------------

type BatchState = {
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  input_file_id: string;
  output_file_id?: string;
  request_counts: { total: number; completed: number; failed: number };
};

let currentBatch: BatchState | null = null;
let outputFileContent = '';
let fileUploads: string[] = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/files', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (file && typeof (file as File).text === 'function') {
      fileUploads.push(await (file as File).text());
    }
    return HttpResponse.json({
      id: 'file-input',
      object: 'file',
      bytes: 100,
      created_at: 1,
      filename: 'batch.jsonl',
      purpose: 'batch',
    });
  }),
  http.post('https://api.openai.com/v1/batches', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    currentBatch = {
      id: 'batch-tok-001',
      status: 'in_progress',
      input_file_id: String(body.input_file_id),
      request_counts: { total: 1, completed: 0, failed: 0 },
    };
    return HttpResponse.json(currentBatch);
  }),
  http.get('https://api.openai.com/v1/batches/:id', ({ params }) => {
    if (!currentBatch || currentBatch.id !== params.id) {
      return HttpResponse.json({ error: 'not found' }, { status: 404 });
    }
    return HttpResponse.json(currentBatch);
  }),
  http.get('https://api.openai.com/v1/files/:id/content', () =>
    HttpResponse.text(outputFileContent),
  ),
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({ object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model' }] }),
  ),
);

// ---------------------------------------------------------------------------
// Hook spies (reset between tests)
// ---------------------------------------------------------------------------

const afterNodeExecuteSpy = vi.fn();
const afterAgentExecuteSpy = vi.fn();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let flowlib: FlowlibInstance;
let credentialId: string;

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });

  const meteringPlugin: FlowlibPlugin = {
    id: 'test-batch-metering',
    hooks: {
      afterNodeExecute: async (ctx) => {
        afterNodeExecuteSpy(ctx);
      },
      afterAgentExecute: async (ctx) => {
        afterAgentExecuteSpy(ctx);
      },
    },
  };

  flowlib = await createTestFlowlib({ plugins: [meteringPlugin] });

  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI batch',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'mock',
  });
  credentialId = cred.id;
});

afterAll(async () => {
  mswServer.close();
  await flowlib.shutdown();
});

beforeEach(() => {
  currentBatch = null;
  outputFileContent = '';
  fileUploads = [];
  afterNodeExecuteSpy.mockReset();
  afterAgentExecuteSpy.mockReset();
});

afterEach(() => mswServer.resetHandlers());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createFlow(definition: FlowlibDefinition) {
  const flow = await flowlib.flows.create({ name: `bt-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flow;
}

function getUploadedCustomId(): string {
  expect(fileUploads).toHaveLength(1);
  const line = JSON.parse(fileUploads[0].trim());
  expect(typeof line.custom_id).toBe('string');
  return line.custom_id as string;
}

function makeCompletedJsonl(
  customId: string,
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number },
): string {
  return (
    JSON.stringify({
      id: 'req-1',
      custom_id: customId,
      response: {
        status_code: 200,
        body: {
          id: 'chatcmpl-x',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          ...(usage
            ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }
            : {}),
        },
      },
    }) + '\n'
  );
}

function modelNode(id: string): FlowlibDefinition['nodes'][number] {
  return {
    id,
    type: 'core.model',
    referenceId: id,
    params: {
      credentialId,
      model: 'gpt-4o-mini',
      provider: 'OPENAI',
      prompt: 'summarize',
      systemPrompt: '',
      useBatchProcessing: true,
      temperature: 0,
    },
    position: { x: 0, y: 0 },
  };
}

function agentBatchNode(id: string): FlowlibDefinition['nodes'][number] {
  return {
    id,
    type: 'core.agent',
    referenceId: id,
    label: 'Agent (batch)',
    params: {
      credentialId,
      model: 'gpt-4o-mini',
      provider: 'OPENAI',
      taskPrompt: 'do the thing',
      systemPrompt: '',
      addedTools: [],
      maxIterations: 1,
      stopCondition: 'explicit_stop',
      temperature: 0,
      enableParallelTools: false,
      useBatchProcessing: true,
    },
    position: { x: 0, y: 0 },
  };
}

async function progressBatchToCompleted(
  customId: string,
  body: string,
  usage?: { prompt_tokens: number; completion_tokens: number },
) {
  outputFileContent = makeCompletedJsonl(customId, body, usage);
  if (currentBatch) {
    currentBatch = {
      ...currentBatch,
      status: 'completed',
      output_file_id: 'file-output',
      request_counts: { total: 1, completed: 1, failed: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Batch resumption — token usage + hooks', () => {
  it('surfaces batch usage in resumed core.model output metadata', async () => {
    const flow = await createFlow({ nodes: [modelNode('m')], edges: [] });
    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });
    expect(paused.status).toBe(FlowRunStatus.PAUSED_FOR_BATCH);

    await progressBatchToCompleted(getUploadedCustomId(), 'the summary', {
      prompt_tokens: 250,
      completion_tokens: 80,
    });

    await flowlib.runMaintenance();

    const finalRun = await flowlib.runs.get(paused.flowRunId);
    expect(finalRun.status).toBe(FlowRunStatus.SUCCESS);

    // Resumed node output should carry the usage in metadata.
    const traces = await flowlib.runs.getNodeExecutions(paused.flowRunId);
    const trace = traces.data.find((t) => t.nodeId === 'm');
    expect(trace?.status).toBe('SUCCESS');

    const meta = (trace?.outputs as { data?: { metadata?: Record<string, unknown> } } | undefined)
      ?.data?.metadata;
    expect(meta).toBeDefined();
    expect(meta?.['usage']).toEqual({ inputTokens: 250, outputTokens: 80 });
    expect(meta?.['tokenUsage']).toEqual({ inputTokens: 250, outputTokens: 80 });
  });

  it('resolves the real node type on resumption (not hardcoded core.model)', async () => {
    const flow = await createFlow({ nodes: [modelNode('m')], edges: [] });
    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });

    await progressBatchToCompleted(getUploadedCustomId(), 'x', {
      prompt_tokens: 10,
      completion_tokens: 2,
    });
    await flowlib.runMaintenance();

    const traces = await flowlib.runs.getNodeExecutions(paused.flowRunId);
    const trace = traces.data.find((t) => t.nodeId === 'm');
    const persistedType = (trace?.outputs as { nodeType?: string } | undefined)?.nodeType;
    expect(persistedType).toBe('core.model');
  });

  it('fires afterNodeExecute on resumed core.model nodes', async () => {
    const flow = await createFlow({ nodes: [modelNode('m')], edges: [] });
    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });

    afterNodeExecuteSpy.mockReset();
    afterAgentExecuteSpy.mockReset();

    await progressBatchToCompleted(getUploadedCustomId(), 'ok', {
      prompt_tokens: 33,
      completion_tokens: 7,
    });
    await flowlib.runMaintenance();

    expect(afterNodeExecuteSpy).toHaveBeenCalled();
    const modelHookCalls = afterNodeExecuteSpy.mock.calls.filter((c) => c[0]?.nodeId === 'm');
    expect(modelHookCalls.length).toBeGreaterThanOrEqual(1);
    const ctx = modelHookCalls[0][0];
    expect(ctx.nodeType).toBe('core.model');
    expect(ctx.status).toBe('SUCCESS');
    // afterAgentExecute must NOT fire for a core.model node.
    expect(afterAgentExecuteSpy).not.toHaveBeenCalled();
  });

  it('fires afterAgentExecute when a core.agent batch resumes, with token totals', async () => {
    const flow = await createFlow({ nodes: [agentBatchNode('agent-batch')], edges: [] });
    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });
    expect(paused.status).toBe(FlowRunStatus.PAUSED_FOR_BATCH);

    afterNodeExecuteSpy.mockReset();
    afterAgentExecuteSpy.mockReset();

    await progressBatchToCompleted(getUploadedCustomId(), 'agent answer', {
      prompt_tokens: 500,
      completion_tokens: 120,
    });
    await flowlib.runMaintenance();

    const finalRun = await flowlib.runs.get(paused.flowRunId);
    expect(finalRun.status).toBe(FlowRunStatus.SUCCESS);

    expect(afterAgentExecuteSpy).toHaveBeenCalledTimes(1);
    const ctx = afterAgentExecuteSpy.mock.calls[0][0];
    expect(ctx.nodeId).toBe('agent-batch');
    expect(ctx.tokensIn).toBe(500);
    expect(ctx.tokensOut).toBe(120);
    // Agent batches are single-shot (no tool calling in batch mode).
    expect(ctx.toolCallCount).toBe(0);

    // afterNodeExecute also fires with the resolved nodeType.
    const agentHook = afterNodeExecuteSpy.mock.calls.find((c) => c[0]?.nodeId === 'agent-batch');
    expect(agentHook).toBeDefined();
    expect(agentHook?.[0].nodeType).toBe('core.agent');
  });

  it('still resumes + fires hooks (with 0 tokens) when the batch result has no usage', async () => {
    const flow = await createFlow({ nodes: [agentBatchNode('agent-no-usage')], edges: [] });
    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });

    afterNodeExecuteSpy.mockReset();
    afterAgentExecuteSpy.mockReset();

    // No usage field on the batch line item.
    await progressBatchToCompleted(getUploadedCustomId(), 'silent answer');
    await flowlib.runMaintenance();

    const finalRun = await flowlib.runs.get(paused.flowRunId);
    expect(finalRun.status).toBe(FlowRunStatus.SUCCESS);

    expect(afterAgentExecuteSpy).toHaveBeenCalledTimes(1);
    const ctx = afterAgentExecuteSpy.mock.calls[0][0];
    expect(ctx.tokensIn).toBe(0);
    expect(ctx.tokensOut).toBe(0);

    // Output metadata should NOT have a usage block when no usage was reported.
    const traces = await flowlib.runs.getNodeExecutions(paused.flowRunId);
    const trace = traces.data.find((t) => t.nodeId === 'agent-no-usage');
    const meta = (trace?.outputs as { data?: { metadata?: Record<string, unknown> } } | undefined)
      ?.data?.metadata;
    expect(meta?.['usage']).toBeUndefined();
  });
});
