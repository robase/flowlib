import { setupServer } from 'msw/node';
import { delay, http, HttpResponse } from 'msw';

type MockServer = ReturnType<typeof setupServer>;

let mockServer: MockServer | null = null;

function parseJsonBody(bodyText: string | null) {
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

async function parseRequestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildAnthropicMessageText(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userMessage = messages.find(
    (message) =>
      message && typeof message === 'object' && (message as { role?: string }).role === 'user',
  ) as { content?: unknown } | undefined;

  const content = userMessage?.content;
  if (typeof content === 'string') {
    return `Mock Anthropic response for: ${content.slice(0, 120)}`;
  }

  if (Array.isArray(content)) {
    const textBlock = content.find(
      (block) => block && typeof block === 'object' && (block as { type?: string }).type === 'text',
    ) as { text?: string } | undefined;
    if (typeof textBlock?.text === 'string') {
      return `Mock Anthropic response for: ${textBlock.text.slice(0, 120)}`;
    }
  }

  return 'Mock Anthropic response';
}

function buildAnthropicStreamResponse(
  text: string,
  options?: { toolName?: string; toolInputJson?: string },
) {
  const encoder = new TextEncoder();
  const toolName = options?.toolName;
  const toolInputJson = options?.toolInputJson ?? '{"expression":"21*2"}';

  const events = toolName
    ? [
        {
          type: 'message_start',
          message: {
            id: 'msg_mock_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-opus-4-6',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_mock_1', name: toolName, input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: toolInputJson },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 12 },
        },
        { type: 'message_stop' },
      ]
    : [
        {
          type: 'message_start',
          message: {
            id: 'msg_mock_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-opus-4-6',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 32 },
        },
        { type: 'message_stop' },
      ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new HttpResponse(stream, {
    headers: {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'cache-control': 'no-cache',
    },
  });
}

function buildLinearGraphqlResponse(query: string) {
  if (query.includes('query ListTeams')) {
    return {
      data: {
        teams: {
          nodes: [
            {
              id: 'team_mock_ops',
              name: 'Operations',
              key: 'OPS',
              description: 'Mock Operations team',
              color: '#2563eb',
              icon: 'Radar',
              private: false,
              issueCount: 12,
              timezone: 'America/Los_Angeles',
              createdAt: '2026-03-14T00:00:00.000Z',
              updatedAt: '2026-03-14T00:00:00.000Z',
              states: {
                nodes: [
                  {
                    id: 'state_backlog',
                    name: 'Backlog',
                    color: '#64748b',
                    type: 'backlog',
                    position: 1,
                  },
                  {
                    id: 'state_in_progress',
                    name: 'In Progress',
                    color: '#f59e0b',
                    type: 'started',
                    position: 2,
                  },
                ],
              },
              labels: {
                nodes: [{ id: 'label_incident', name: 'Incident', color: '#ef4444' }],
              },
              members: {
                nodes: [
                  {
                    id: 'user_mock_1',
                    name: 'Jamie Rivera',
                    displayName: 'Jamie Rivera',
                    email: 'jamie@example.com',
                  },
                ],
              },
            },
          ],
        },
      },
    };
  }

  if (query.includes('query ListIssues')) {
    return {
      data: {
        issues: {
          nodes: [
            {
              id: 'issue_mock_1',
              identifier: 'OPS-101',
              title: 'Billing API latency spike',
              description: 'Investigate increased p95 latency in billing-api.',
              priority: 1,
              priorityLabel: 'Urgent',
              url: 'https://linear.app/mock/issue/OPS-101',
              createdAt: '2026-03-14T00:00:00.000Z',
              updatedAt: '2026-03-14T00:05:00.000Z',
              state: {
                id: 'state_in_progress',
                name: 'In Progress',
                color: '#f59e0b',
                type: 'started',
              },
              assignee: {
                id: 'user_mock_1',
                name: 'Jamie Rivera',
                email: 'jamie@example.com',
                displayName: 'Jamie Rivera',
              },
              team: { id: 'team_mock_ops', name: 'Operations', key: 'OPS' },
              labels: { nodes: [{ id: 'label_incident', name: 'Incident', color: '#ef4444' }] },
              estimate: 3,
              dueDate: '2026-03-15',
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
  }

  if (query.includes('mutation CreateIssue')) {
    return {
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: 'issue_mock_new',
            identifier: 'OPS-202',
            title: 'Mock created issue',
            description: 'Created through MSW Linear mock.',
            priority: 2,
            priorityLabel: 'High',
            url: 'https://linear.app/mock/issue/OPS-202',
            createdAt: '2026-03-14T00:10:00.000Z',
            state: { id: 'state_backlog', name: 'Backlog', color: '#64748b', type: 'backlog' },
            assignee: { id: 'user_mock_1', name: 'Jamie Rivera', displayName: 'Jamie Rivera' },
            team: { id: 'team_mock_ops', name: 'Operations', key: 'OPS' },
            labels: { nodes: [{ id: 'label_incident', name: 'Incident' }] },
            estimate: 3,
            dueDate: null,
            parent: null,
          },
        },
      },
    };
  }

  return {
    data: {
      viewer: {
        id: 'viewer_mock_1',
        name: 'Mock Linear Viewer',
      },
    },
  };
}

function createServer() {
  return setupServer(
    http.get('https://httpbin.org/get', ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json({
        args: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(request.headers.entries()),
        origin: '127.0.0.1',
        url: request.url,
      });
    }),
    http.post('https://httpbin.org/post', async ({ request }) => {
      const bodyText = await request.text();
      return HttpResponse.json({
        data: bodyText,
        json: parseJsonBody(bodyText),
        headers: Object.fromEntries(request.headers.entries()),
        origin: '127.0.0.1',
        url: request.url,
      });
    }),
    http.get('https://httpbin.org/delay/:seconds', async ({ request, params }) => {
      const seconds = Number(params.seconds ?? '0');
      if (Number.isFinite(seconds) && seconds > 0) {
        await delay(seconds * 1000);
      }

      const url = new URL(request.url);
      return HttpResponse.json({
        args: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(request.headers.entries()),
        origin: '127.0.0.1',
        url: request.url,
        delayed: true,
        seconds,
      });
    }),
    http.get('https://api.github.com/user', () => {
      return HttpResponse.json({
        login: 'flowlib-msw',
        id: 1001,
        name: 'Invect Mock User',
      });
    }),
    http.get('https://api.openai.com/v1/models', () => {
      return HttpResponse.json({
        object: 'list',
        data: [
          { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.4', object: 'model', owned_by: 'openai' },
        ],
      });
    }),
    http.get('https://api.stripe.com/v1/customers', () => {
      return HttpResponse.json({
        object: 'list',
        data: [{ id: 'cus_mock_123', object: 'customer', email: 'mock@example.com' }],
        has_more: false,
        url: '/v1/customers',
      });
    }),
    http.get('https://api.anthropic.com/v1/models', () => {
      return HttpResponse.json({
        data: [
          { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', type: 'model' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', type: 'model' },
        ],
        has_more: false,
      });
    }),
    http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
      const body = await parseRequestJson(request);
      const text = buildAnthropicMessageText(body);
      const acceptHeader = request.headers.get('accept') ?? '';
      const requestUrl = new URL(request.url);
      const shouldStream =
        body.stream === true ||
        acceptHeader.includes('text/event-stream') ||
        requestUrl.searchParams.get('stream') === 'true';
      const tools = Array.isArray(body.tools)
        ? (body.tools as Array<{ name?: string }>).filter((tool) => typeof tool?.name === 'string')
        : [];
      const includesMathToolPrompt =
        Array.isArray(body.messages) &&
        (body.messages as Array<{ role?: string; content?: unknown }>).some((message) => {
          if (message?.role !== 'user') {
            return false;
          }
          if (typeof message.content === 'string') {
            return message.content.toLowerCase().includes('math_eval');
          }
          if (Array.isArray(message.content)) {
            return (message.content as Array<{ type?: string; text?: string }>).some(
              (block) =>
                block?.type === 'text' &&
                typeof block.text === 'string' &&
                block.text.toLowerCase().includes('math_eval'),
            );
          }
          return false;
        });
      const hasToolResultsInMessages =
        Array.isArray(body.messages) &&
        (body.messages as Array<{ role?: string; content?: unknown }>).some(
          (message) =>
            message?.role === 'user' &&
            Array.isArray(message.content) &&
            (message.content as Array<{ type?: string }>).some(
              (block) => block?.type === 'tool_result',
            ),
        );

      if (shouldStream) {
        if ((tools.length > 0 || includesMathToolPrompt) && !hasToolResultsInMessages) {
          return buildAnthropicStreamResponse(text, {
            toolName: tools[0]?.name ?? 'math_eval',
            toolInputJson: '{"expression":"21*2"}',
          });
        }
        return buildAnthropicStreamResponse(text);
      }

      return HttpResponse.json({
        id: 'msg_mock_123',
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'claude-opus-4-6',
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [{ type: 'text', text }],
        usage: { input_tokens: 12, output_tokens: 32 },
      });
    }),
    http.post('https://api.anthropic.com/v1/messages/batches', () => {
      return HttpResponse.json({
        id: 'msgbatch_mock_123',
        type: 'message_batch',
        processing_status: 'in_progress',
        created_at: new Date().toISOString(),
        request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
      });
    }),
    http.get('https://api.anthropic.com/v1/messages/batches/:batchId', ({ params }) => {
      return HttpResponse.json({
        id: params.batchId,
        type: 'message_batch',
        processing_status: 'ended',
        created_at: new Date().toISOString(),
        request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
      });
    }),
    http.get('https://api.anthropic.com/v1/messages/batches/:batchId/results', () => {
      const lines = [
        JSON.stringify({
          custom_id: 'batch_mock_1',
          result: {
            type: 'succeeded',
            message: {
              id: 'msg_batch_result_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-4-6',
              stop_reason: 'end_turn',
              stop_sequence: null,
              content: [{ type: 'text', text: 'Mock Anthropic batch result' }],
              usage: { input_tokens: 10, output_tokens: 14 },
            },
          },
        }),
      ].join('\n');

      return new HttpResponse(lines, {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }),
    http.post('https://api.linear.app/oauth/token', () => {
      return HttpResponse.json({
        access_token: 'linear-mock-access-token',
        refresh_token: 'linear-mock-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write issues:create',
      });
    }),
    http.post('https://api.linear.app/graphql', async ({ request }) => {
      const body = await parseRequestJson(request);
      const query = typeof body.query === 'string' ? body.query : '';
      return HttpResponse.json(buildLinearGraphqlResponse(query));
    }),
  );
}

export function startExternalApiMocks() {
  if (mockServer) {
    return mockServer;
  }

  mockServer = createServer();
  mockServer.listen({ onUnhandledRequest: 'bypass' });
  return mockServer;
}

export function stopExternalApiMocks() {
  if (!mockServer) {
    return;
  }

  mockServer.close();
  mockServer = null;
}
