/**
 * Helper for test MSW handlers that mock OpenAI chat.completions. Converts a
 * chat.completion-shaped body into an SSE payload so the OpenAI SDK's
 * streaming parser (enabled when the adapter sets `stream: true`) can read
 * it. Emits one chunk per choice-delta plus a final `[DONE]` terminator.
 *
 * The `core.agent` path always requests streaming; the `core.model` path
 * does not. Handlers should inspect the incoming request body and only
 * wrap with SSE when `stream === true`.
 *
 * When the response body has a `usage` field, an extra usage-only chunk
 * (empty `choices` array) is emitted just before `[DONE]`, mirroring the
 * format OpenAI uses when callers pass `stream_options.include_usage: true`.
 */
export function toOpenAiSseStream(body: Record<string, unknown>): string {
  const choices = (body.choices as Array<{ message?: Record<string, unknown> }>) ?? [];
  const message = choices[0]?.message ?? {};
  const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
  const content = (message as { content?: string | null }).content ?? null;
  const reasoning =
    (message as { reasoning?: string | null }).reasoning ??
    (message as { reasoning_content?: string | null }).reasoning_content ??
    null;
  const baseChunk = {
    id: body.id,
    object: 'chat.completion.chunk',
    created: body.created,
    model: body.model,
  };
  const lines: string[] = [];

  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    toolCalls.forEach((tc, idx) => {
      const t = tc as { id: string; function: { name: string; arguments: string } };
      lines.push(
        `data: ${JSON.stringify({
          ...baseChunk,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: t.id,
                    function: { name: t.function.name, arguments: t.function.arguments },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    });
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      })}\n\n`,
    );
  } else {
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      lines.push(
        `data: ${JSON.stringify({
          ...baseChunk,
          choices: [{ index: 0, delta: { reasoning }, finish_reason: null }],
        })}\n\n`,
      );
    }
    if (typeof content === 'string' && content.length > 0) {
      lines.push(
        `data: ${JSON.stringify({
          ...baseChunk,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`,
      );
    }
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    );
  }
  // Usage chunk: OpenAI emits this just before [DONE] when callers set
  // `stream_options.include_usage: true`. The chunk has empty `choices`
  // and a top-level `usage` field. Mirroring it here lets adapter tests
  // assert on captured token counts without separate fixtures.
  const usage = body.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (usage) {
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [],
        usage,
      })}\n\n`,
    );
  }
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

/**
 * Return a Response suitable for a `chat.completions` mock, auto-selecting
 * SSE vs JSON based on the request body's `stream` flag.
 */
export function respondWithChatCompletion(
  requestBody: Record<string, unknown>,
  responseBody: Record<string, unknown>,
): Response {
  if (requestBody.stream === true) {
    return new Response(toOpenAiSseStream(responseBody), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
