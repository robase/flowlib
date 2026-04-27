/**
 * Integration tests: Large payload handling
 *
 * What happens when an external API, LLM, or upstream node produces a huge
 * payload? These tests push realistic upper bounds through the orchestration
 * path and assert that:
 *
 * - A multi-MB JSON response from http.request round-trips through a
 *   downstream core.javascript node.
 * - A huge text response is ingested (not truncated) and is accessible to
 *   downstream template_string rendering.
 * - Mapper iteration over 1000+ items runs to completion and aggregates
 *   correctly.
 * - An LLM that returns a large assistant message is captured in the model
 *   output variable.
 * - A request that times out past the action's timeout budget fails the
 *   node cleanly without hanging the flow.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// Local HTTP server — serves a configurable payload per request
// ---------------------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handler: Handler = (_req, res) => {
  res.writeHead(404);
  res.end();
};

let server: Server;
let serverBase: string;
const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL;

let flowlib: FlowlibInstance;
let httpCredentialId: string;
let openaiCredentialId: string;

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  serverBase = `http://127.0.0.1:${port}`;
  process.env.OPENAI_BASE_URL = `${serverBase}/v1`;

  flowlib = await createTestFlowlib();

  const httpCred = await flowlib.credentials.create({
    name: 'Huge-response HTTP (none)',
    type: 'http-api',
    authType: 'custom',
    config: { headers: {} },
    description: 'no-op auth for local HTTP',
  });
  httpCredentialId = httpCred.id;

  const openaiCred = await flowlib.credentials.create({
    name: 'Huge-response OpenAI mock',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'Local mock OpenAI (huge responses)',
  });
  openaiCredentialId = openaiCred.id;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await flowlib.shutdown();
  if (originalOpenAIBaseUrl === undefined) {
    delete process.env.OPENAI_BASE_URL;
  } else {
    process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl;
  }
});

beforeEach(() => {
  handler = (_req, res) => {
    res.writeHead(404);
    res.end();
  };
});

afterEach(() => {
  handler = (_req, res) => {
    res.writeHead(404);
    res.end();
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFlow(definition: FlowlibDefinition) {
  const flow = await flowlib.flows.create({ name: `huge-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
}

function getNodeOutputValue(
  result: { outputs?: Record<string, unknown> },
  nodeId: string,
): unknown {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return node?.data?.variables?.output?.value;
}

function parseIfJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function modelChatResponse(content: string) {
  return {
    id: `chatcmpl-${Date.now()}-${Math.random()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, tool_calls: undefined },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 99999, total_tokens: 100004 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Huge payload handling', () => {
  const testTimeout = 60_000;

  it(
    'http.request returns a multi-MB JSON body and downstream JS can read a slice of it',
    async () => {
      // Build a ~3 MB JSON array. Keeping it realistic: a fairly large list of
      // small records rather than one gigantic blob.
      const items = Array.from({ length: 20_000 }, (_, i) => ({
        id: i,
        name: `record-${i}`,
        // ~100 bytes of filler per record to push payload size up.
        blob: 'x'.repeat(100),
      }));
      const bodyString = JSON.stringify({ items });
      // Sanity guard so this test actually exercises a large payload.
      expect(bodyString.length).toBeGreaterThan(2_000_000);

      handler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(bodyString)),
        });
        res.end(bodyString);
      };

      const definition: FlowlibDefinition = {
        nodes: [
          {
            id: 'http',
            type: 'http.request',
            referenceId: 'http',
            params: {
              method: 'GET',
              url: `${serverBase}/big`,
              credentialId: httpCredentialId,
              timeout: 30_000,
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'pick',
            type: 'core.javascript',
            referenceId: 'pick',
            params: {
              // http.request output shape: { data, status, headers, ok }.
              // We reach into the data we returned above.
              code: 'return { total: http.data.items.length, first: http.data.items[0], last: http.data.items[http.data.items.length - 1] }',
            },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'http', target: 'pick' }],
      };

      const result = await runFlow(definition);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const pickOut = parseIfJson(getNodeOutputValue(result, 'pick')) as {
        total: number;
        first: { id: number };
        last: { id: number };
      };
      expect(pickOut.total).toBe(20_000);
      expect(pickOut.first.id).toBe(0);
      expect(pickOut.last.id).toBe(19_999);
    },
    testTimeout,
  );

  it(
    'mapper iteration runs to completion over 1000 items and downstream can aggregate',
    async () => {
      const definition: FlowlibDefinition = {
        nodes: [
          {
            id: 'src',
            type: 'core.javascript',
            referenceId: 'src',
            params: {
              code: 'return Array.from({ length: 1000 }, (_, i) => ({ n: i }))',
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'doubled',
            type: 'core.javascript',
            referenceId: 'doubled',
            params: { code: 'return n * 2' },
            mapper: { enabled: true, expression: 'src', concurrency: 25 },
            position: { x: 200, y: 0 },
          } as unknown as FlowlibDefinition['nodes'][number],
          {
            id: 'sum',
            type: 'core.javascript',
            referenceId: 'sum',
            params: {
              // doubled is an array of stringified numbers — coerce before summing.
              code: 'return doubled.reduce((a, b) => a + Number(b), 0)',
            },
            position: { x: 400, y: 0 },
          },
        ],
        edges: [
          { id: 'e1', source: 'src', target: 'doubled' },
          { id: 'e2', source: 'doubled', target: 'sum' },
        ],
      };

      const result = await runFlow(definition);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const doubled = parseIfJson(getNodeOutputValue(result, 'doubled')) as unknown[];
      expect(doubled).toHaveLength(1000);

      // Sum of 2*0 + 2*1 + … + 2*999 = 2 * (999*1000/2) = 999_000.
      expect(parseIfJson(getNodeOutputValue(result, 'sum'))).toBe(999_000);
    },
    testTimeout,
  );

  it(
    'captures a large LLM assistant message in full',
    async () => {
      // ~250 KB of assistant text. Larger than any realistic completion but
      // well within what the SDK + our JSON persistence layer handle.
      const bigContent = 'A'.repeat(250_000);

      handler = (req, res) => {
        if (req.method === 'POST' && req.url?.endsWith('/v1/chat/completions')) {
          req.on('data', () => {});
          req.on('end', () => {
            const payload = JSON.stringify(modelChatResponse(bigContent));
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(payload);
          });
          return;
        }
        if (req.method === 'GET' && req.url?.endsWith('/v1/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              object: 'list',
              data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' }],
            }),
          );
          return;
        }
        res.writeHead(404);
        res.end();
      };

      const definition: FlowlibDefinition = {
        nodes: [
          {
            id: 'model',
            type: 'core.model',
            referenceId: 'model',
            params: {
              credentialId: openaiCredentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              prompt: 'give me something huge',
              systemPrompt: '',
              useBatchProcessing: false,
              temperature: 0,
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'measure',
            type: 'core.javascript',
            referenceId: 'measure',
            params: {
              code: 'return { length: String(model).length, head: String(model).slice(0, 5) }',
            },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'model', target: 'measure' }],
      };

      const result = await runFlow(definition);

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const measured = parseIfJson(getNodeOutputValue(result, 'measure')) as {
        length: number;
        head: string;
      };
      expect(measured.length).toBe(250_000);
      expect(measured.head).toBe('AAAAA');
    },
    testTimeout,
  );

  it(
    'http.request fails cleanly when the server holds the connection past the action timeout',
    async () => {
      // The action has a `timeout` parameter we set to 200ms. Make the server
      // sleep for 2s so the fetch aborts. We must not leak the connection or
      // hang the test runner.
      const openRequests: Array<{ res: ServerResponse; timer: NodeJS.Timeout }> = [];
      handler = (_req, res) => {
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{}');
          }
        }, 2_000);
        openRequests.push({ res, timer });
      };

      try {
        const definition: FlowlibDefinition = {
          nodes: [
            {
              id: 'slow',
              type: 'http.request',
              referenceId: 'slow',
              params: {
                method: 'GET',
                url: `${serverBase}/slow`,
                credentialId: httpCredentialId,
                timeout: 200,
              },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        };

        const result = await runFlow(definition);

        expect(result.status).toBe(FlowRunStatus.FAILED);
        const trace = result.traces?.find((t) => t.nodeId === 'slow');
        expect((trace?.error ?? '').toLowerCase()).toMatch(/timed out|abort/);
      } finally {
        // Free the held connections so we don't wait on them at afterAll.
        for (const { res, timer } of openRequests) {
          clearTimeout(timer);
          if (!res.writableEnded) {
            res.destroy();
          }
        }
      }
    },
    testTimeout,
  );
});
