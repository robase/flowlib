/**
 * Chat assistant endpoint slice.
 *
 *   GET    /chat/status
 *   GET    /chat/models/:credentialId
 *   POST   /chat                            — SSE stream
 *   GET    /chat/stream/:sessionId          — SSE reattach
 *   GET    /chat/messages/:flowId
 *   PUT    /chat/messages/:flowId
 *   DELETE /chat/messages/:flowId
 */

import type { ChatMessage, ChatStreamEvent } from '@flowlib/core';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const chatStatus = defineEndpoint({
  id: 'chat.status',
  method: 'GET',
  path: '/chat/status',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib }) {
    return { kind: 'json', status: 200, body: { enabled: flowlib.chat.isEnabled() } };
  },
});

const chatModels = defineEndpoint({
  id: 'chat.models',
  method: 'GET',
  path: '/chat/models/:credentialId',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const q = request.searchParams.get('q') ?? undefined;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.chat.listModels(request.params.credentialId, q),
    };
  },
});

/**
 * Render `ChatStreamEvent`s as SSE frames into a `ReadableStream`. Errors
 * are emitted as `event: error` frames; the iterator close ends the stream.
 */
function streamChatEvents(
  iterable: AsyncIterable<ChatStreamEvent>,
  signal: AbortSignal | undefined,
  errorLabel: string,
): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of iterable) {
          if (signal?.aborted) {
            break;
          }
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : errorLabel;
        try {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
            ),
          );
        } catch {
          // Already closed.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
}

const chatStream = defineEndpoint({
  id: 'chat.stream',
  method: 'POST',
  path: '/chat',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    const { messages, context } = (request.body ?? {}) as {
      messages?: ChatMessage[];
      context?: Record<string, unknown>;
    };
    if (!messages || !Array.isArray(messages)) {
      return {
        kind: 'json',
        status: 400,
        body: {
          error: 'Validation Error',
          message: '"messages" must be an array of chat messages',
        },
      };
    }
    const events = await flowlib.chat.createStream({
      messages,
      context: context ?? {},
      identity: request.identity ?? undefined,
    });
    return {
      kind: 'stream',
      status: 200,
      stream: streamChatEvents(events, request.webRequest.signal, 'Chat stream failed'),
    };
  },
});

const chatReattach = defineEndpoint({
  id: 'chat.reattach',
  method: 'GET',
  path: '/chat/stream/:sessionId',
  auth: { kind: 'protected', permission: 'flow:update' },
  handle({ flowlib, request }) {
    const abortController = new AbortController();
    const upstream = request.webRequest.signal;
    if (upstream) {
      if (upstream.aborted) {
        abortController.abort();
      } else {
        upstream.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }
    const events = flowlib.chat.subscribeToSession(
      request.params.sessionId,
      abortController.signal,
    );
    return {
      kind: 'stream',
      status: 200,
      stream: streamChatEvents(events, abortController.signal, 'Chat reattach failed'),
    };
  },
});

const getMessages = defineEndpoint({
  id: 'chat.getMessages',
  method: 'GET',
  path: '/chat/messages/:flowId',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const sp = request.searchParams;
    const page = sp.get('page') ? parseInt(sp.get('page') as string, 10) : undefined;
    const limit = sp.get('limit') ? parseInt(sp.get('limit') as string, 10) : undefined;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.chat.getMessages(request.params.flowId, {
        ...(page ? { page } : {}),
        ...(limit ? { limit } : {}),
      }),
    };
  },
});

const saveMessages = defineEndpoint({
  id: 'chat.saveMessages',
  method: 'PUT',
  path: '/chat/messages/:flowId',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    const { messages } = (request.body ?? {}) as { messages?: ChatMessage[] };
    if (!messages || !Array.isArray(messages)) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Validation Error', message: '"messages" must be an array' },
      };
    }
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.chat.saveMessages(request.params.flowId, messages),
    };
  },
});

const deleteMessages = defineEndpoint({
  id: 'chat.deleteMessages',
  method: 'DELETE',
  path: '/chat/messages/:flowId',
  auth: { kind: 'protected', permission: 'flow:delete' },
  async handle({ flowlib, request }) {
    await flowlib.chat.deleteMessages(request.params.flowId);
    return { kind: 'json', status: 200, body: { success: true } };
  },
});

export const chatEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  chatStatus,
  chatModels,
  // /chat/stream/:sessionId before /chat/messages/:flowId — both are 3-segment paths
  chatReattach,
  getMessages,
  saveMessages,
  deleteMessages,
  chatStream,
] as readonly FlowlibHttpEndpoint<unknown>[];
