import * as assert from 'node:assert';
import { consumeRunEventStream, type SseEvent } from '../../src/backend/sse';

function streamFrom(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

suite('sse — parser', () => {
  test('parses single event-data block', async () => {
    const events: SseEvent[] = [];
    await consumeRunEventStream(streamFrom(['event: snapshot\ndata: {"foo":1}\n\n']), (e) =>
      events.push(e),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'snapshot');
    assert.deepEqual(events[0].data, { foo: 1 });
  });

  test('handles multi-event stream split across chunks', async () => {
    const events: SseEvent[] = [];
    await consumeRunEventStream(
      streamFrom(['event: a\ndata: {"x":', '1}\n\nevent: b\ndata: ', '{"y":2}\n\n']),
      (e) => events.push(e),
    );
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'a');
    assert.deepEqual(events[0].data, { x: 1 });
    assert.equal(events[1].event, 'b');
    assert.deepEqual(events[1].data, { y: 2 });
  });

  test('flushes trailing block without terminating blank line', async () => {
    const events: SseEvent[] = [];
    await consumeRunEventStream(streamFrom(['event: end\ndata: {"done":true}']), (e) =>
      events.push(e),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'end');
  });

  test('falls back to raw string when data is not JSON', async () => {
    const events: SseEvent[] = [];
    await consumeRunEventStream(streamFrom(['event: heartbeat\ndata: tick\n\n']), (e) =>
      events.push(e),
    );
    assert.equal(events[0].data, 'tick');
  });
});
