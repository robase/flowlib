/**
 * Run-events SSE endpoint slice.
 *
 *   GET /flow-runs/:flowRunId/stream  — canonical
 *   GET /runs/:flowRunId/events       — alias for external clients
 *
 * Both paths produce the same SSE stream. Permission: `flow-run:read`.
 *
 * Stream framing matches the previous adapter-side implementations:
 *   - Each event is `event: <type>\ndata: <json>\n\n`
 *   - On error, an `event: error` frame with `{ type: 'error', message }`
 *   - The stream ends when `flowlib.runs.createEventStream` finishes (a
 *     terminal event closes the iterator)
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const buildEventStream: FlowlibHttpEndpoint<unknown>['handle'] = ({ flowlib, request }) => {
  const events = flowlib.runs.createEventStream(request.params.flowRunId);
  const encoder = new TextEncoder();
  const clientSignal = request.webRequest.signal;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          if (clientSignal?.aborted) {
            break;
          }
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Stream failed';
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', message })}\n\n`),
          );
        } catch {
          // Controller already closed by client disconnect — ignore.
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

  return { kind: 'stream', status: 200, stream };
};

const flowRunStream = defineEndpoint({
  id: 'run-events.flowRunStream',
  method: 'GET',
  path: '/flow-runs/:flowRunId/stream',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  handle: buildEventStream,
});

const runEventsAlias = defineEndpoint({
  id: 'run-events.runEventsAlias',
  method: 'GET',
  path: '/runs/:flowRunId/events',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  handle: buildEventStream,
});

export const runEventsEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  flowRunStream,
  runEventsAlias,
] as readonly FlowlibHttpEndpoint<unknown>[];
