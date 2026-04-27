/**
 * Integration tests: Batch processing lifecycle
 *
 * Exercises the core.model batch path end-to-end:
 *   1. submitPrompt with useBatchProcessing=true → OpenAI Files+Batches APIs
 *   2. Node execution returns state: PENDING + batchJobId
 *   3. Flow enters PAUSED_FOR_BATCH status (runs.start returns early)
 *   4. Maintenance pass polls OpenAI → batch marked COMPLETED in DB
 *   5. Resumption sweep continues the flow from the batch node
 *   6. Downstream nodes execute with the batch result as upstream data
 *
 * Covers edge cases:
 *   - Batch submission failure (upload error)
 *   - Batch completes with an error file (per-request failure)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// OpenAI batch-API fixtures
// ---------------------------------------------------------------------------

type BatchState = {
  id: string;
  status: 'validating' | 'in_progress' | 'completed' | 'failed';
  input_file_id: string;
  output_file_id?: string;
  error_file_id?: string;
  request_counts: { total: number; completed: number; failed: number };
};

/** Mutable state per test — each test sets up a new batch and progresses it. */
let currentBatch: BatchState | null = null;
/** JSONL content returned for the output file download. */
let outputFileContent = '';
/** Captured requests for assertions. */
let fileUploads: string[] = [];
let batchCreates: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  // File upload (multipart). Just return a fake file id.
  http.post('https://api.openai.com/v1/files', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (file && typeof (file as File).text === 'function') {
      fileUploads.push(await (file as File).text());
    }
    return HttpResponse.json({
      id: 'file-input-123',
      object: 'file',
      bytes: 100,
      created_at: Math.floor(Date.now() / 1000),
      filename: 'batch_requests.jsonl',
      purpose: 'batch',
    });
  }),

  // Batch create
  http.post('https://api.openai.com/v1/batches', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    batchCreates.push(body);
    currentBatch = {
      id: 'batch-abc-001',
      status: 'in_progress',
      input_file_id: String(body.input_file_id),
      request_counts: { total: 1, completed: 0, failed: 0 },
    };
    return HttpResponse.json(currentBatch);
  }),

  // Batch retrieve (status poll)
  http.get('https://api.openai.com/v1/batches/:id', ({ params }) => {
    if (!currentBatch || currentBatch.id !== params.id) {
      return HttpResponse.json({ error: 'not found' }, { status: 404 });
    }
    return HttpResponse.json(currentBatch);
  }),

  // Output file content download
  http.get('https://api.openai.com/v1/files/:id/content', () =>
    HttpResponse.text(outputFileContent),
  ),

  // Credential validation / model list
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({
      object: 'list',
      data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' }],
    }),
  ),
);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let flowlib: FlowlibInstance;
let credentialId: string;

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
  flowlib = await createTestFlowlib();
  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI Batch',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'MSW OpenAI (batch)',
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
  batchCreates = [];
});

afterEach(() => {
  mswServer.resetHandlers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createFlow(definition: FlowlibDefinition) {
  const flow = await flowlib.flows.create({ name: `batch-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flow;
}

function batchModelNode(id: string): FlowlibDefinition['nodes'][number] {
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

/** Extract the custom_id OpenAI was handed in the uploaded JSONL. This is the
 *  internal batch-job row id that will appear in the output JSONL. */
function getUploadedCustomId(): string {
  expect(fileUploads).toHaveLength(1);
  const line = JSON.parse(fileUploads[0].trim());
  expect(typeof line.custom_id).toBe('string');
  return line.custom_id as string;
}

/** Build the JSONL payload OpenAI would return for a completed batch. */
function makeCompletedJsonl(customId: string, content: string): string {
  return (
    JSON.stringify({
      id: 'req-1',
      custom_id: customId,
      response: {
        status_code: 200,
        body: {
          id: 'chatcmpl-x',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
        },
      },
    }) + '\n'
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Batch processing lifecycle', () => {
  it('pauses the flow when a batch is submitted and uploads a JSONL request', async () => {
    const flow = await createFlow({
      nodes: [batchModelNode('model')],
      edges: [],
    });

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });

    // Flow should pause — the model node is waiting for the batch.
    expect(result.status).toBe(FlowRunStatus.PAUSED_FOR_BATCH);

    // The JSONL upload must contain a single prompt line addressed to the
    // batch chat endpoint.
    expect(fileUploads).toHaveLength(1);
    const uploadLine = JSON.parse(fileUploads[0].trim());
    expect(uploadLine.method).toBe('POST');
    expect(uploadLine.url).toBe('/v1/chat/completions');
    expect(uploadLine.body.model).toBe('gpt-4o-mini');
    expect(typeof uploadLine.custom_id).toBe('string');

    // A batch-create call should have happened, pointing at the uploaded file.
    expect(batchCreates).toHaveLength(1);
    expect(batchCreates[0].input_file_id).toBe('file-input-123');
  });

  it('resumes the flow after maintenance polling sees the batch completed', async () => {
    const flow = await createFlow({
      nodes: [
        batchModelNode('model'),
        {
          id: 'after',
          type: 'core.template_string',
          referenceId: 'after',
          params: { template: 'model said: {{ model }}' },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'model', target: 'after' }],
    });

    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });
    expect(paused.status).toBe(FlowRunStatus.PAUSED_FOR_BATCH);

    // Downstream should not have run yet.
    expect(paused.outputs?.['after']).toBeUndefined();

    // Progress the batch to "completed" with a real-looking result file.
    const customId = getUploadedCustomId();
    outputFileContent = makeCompletedJsonl(customId, 'the summary is hello');
    currentBatch = {
      ...currentBatch!,
      status: 'completed',
      output_file_id: 'file-output-456',
      request_counts: { total: 1, completed: 1, failed: 0 },
    };

    // One maintenance pass polls + resumes.
    await flowlib.runMaintenance();

    const finalRun = await flowlib.runs.get(paused.flowRunId);
    expect(finalRun.status).toBe(FlowRunStatus.SUCCESS);

    // The batch result should flow through to the template_string node.
    const tracesPage = await flowlib.runs.getNodeExecutions(paused.flowRunId);
    const afterTrace = tracesPage.data.find((t) => t.nodeId === 'after');
    expect(afterTrace?.status).toBe('SUCCESS');
    const afterValue = (
      afterTrace?.outputs as { data?: { variables?: { output?: { value?: unknown } } } } | undefined
    )?.data?.variables?.output?.value;
    expect(String(afterValue ?? '')).toContain('the summary is hello');
  });

  it('marks the batch job FAILED and the flow FAILED when the batch errors out', async () => {
    const flow = await createFlow({
      nodes: [batchModelNode('model')],
      edges: [],
    });

    const paused = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });
    expect(paused.status).toBe(FlowRunStatus.PAUSED_FOR_BATCH);

    // Simulate a batch failure: completed status but every request failed and
    // no output file was produced (error_file_id set, output_file_id absent).
    currentBatch = {
      ...currentBatch!,
      status: 'completed',
      error_file_id: 'file-err-789',
      request_counts: { total: 1, completed: 0, failed: 1 },
    };
    // Error file returns an error payload.
    mswServer.use(
      http.get('https://api.openai.com/v1/files/:id/content', ({ params }) => {
        if (params.id === 'file-err-789') {
          return HttpResponse.text(
            JSON.stringify({
              id: 'req-1',
              error: { message: 'token limit exceeded' },
            }) + '\n',
          );
        }
        return HttpResponse.text('');
      }),
    );

    await flowlib.runMaintenance();

    const finalRun = await flowlib.runs.get(paused.flowRunId);
    expect(finalRun.status).toBe(FlowRunStatus.FAILED);
  });

  it('fails the node cleanly when batch submission itself errors', async () => {
    // Make file upload return 401 unauthorized — SDK does not retry 4xx.
    mswServer.use(
      http.post('https://api.openai.com/v1/files', () =>
        HttpResponse.json(
          { error: { message: 'invalid api key', type: 'invalid_request_error' } },
          { status: 401 },
        ),
      ),
    );

    const flow = await createFlow({
      nodes: [batchModelNode('model')],
      edges: [],
    });

    const result = await flowlib.runs.start(flow.id, {}, { useBatchProcessing: true });

    expect(result.status).toBe(FlowRunStatus.FAILED);
    // No batch create should have happened — submission aborted at upload.
    expect(batchCreates).toHaveLength(0);
  });
});
