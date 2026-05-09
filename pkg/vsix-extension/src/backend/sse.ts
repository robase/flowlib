/**
 * SSE parser for `/runs/:id/events` — produced by L14.
 *
 * Wire format (matches the existing UI consumer
 * `pkg/ui/src/api/use-flow-run-stream.ts`):
 *
 *   event: <type>\n
 *   data: <json>\n\n
 *
 * `consumeRunEventStream(response, onEvent)` returns a `Promise<void>` that
 * resolves on stream end and rejects on transport error. The optional
 * `signal` aborts fetching cleanly.
 *
 * Kept minimal — no auto-reconnect, no heartbeat handling beyond logging.
 * The host re-establishes the stream on reconnect; the run id stays valid
 * for the lifetime of the run on the backend.
 */

export interface SseEvent {
  event: string;
  data: unknown;
}

export type SseHandler = (event: SseEvent) => void;

/** Parse a single SSE message block (without the trailing blank line). */
function parseBlock(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
    // ignore `id:` / `retry:` / comments — we don't use them
  }
  if (dataLines.length === 0) {
    return null;
  }
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // Leave as raw string — the handler can decide how to cope.
  }
  return { event, data };
}

export async function consumeRunEventStream(
  response: Response,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new Error('SSE response missing body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // SSE blocks are separated by a blank line (\n\n).
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseBlock(raw);
        if (evt) {
          onEvent(evt);
        }
      }
    }
    // Flush any trailing block (no terminating blank line).
    const tail = buffer.trim();
    if (tail) {
      const evt = parseBlock(tail);
      if (evt) {
        onEvent(evt);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
