/**
 * In-container HTTP wrapper for `@anthropic-ai/claude-agent-sdk`.
 *
 * Runs inside the Cloudflare Sandbox container so Workers can talk to
 * Claude Code without spawning child processes themselves (Workers
 * can't). The host (`@flowlib/agents`'s claude-code provider) reaches
 * this server via `sandbox.containerFetch()` — no public DNS or
 * exposePort is required for SDK traffic.
 *
 * The transport mirrors the SDK contract:
 *
 *   POST   /sessions               { apiKey, systemPrompt, defaultModel,
 *                                    permissionMode, allowedTools,
 *                                    disallowedTools, cwd? }
 *                                  → { sessionId }
 *
 *   POST   /sessions/:id/prompt    { text, model? }
 *                                  → SSE stream of `{ type: 'sdk-message',
 *                                                     message: <SDKMessage> }`
 *                                    plus a terminal `{ type: 'end' }`.
 *
 *   DELETE /sessions/:id           closes the session
 *
 *   GET    /health                 liveness probe — returns 200 once the
 *                                  SDK has loaded
 *
 * Per-session state is held in a Map keyed by the SDK-assigned session
 * id (synthesised before the first message lands). Each session owns a
 * streaming-input queue + a single SDK Query so multi-turn conversations
 * stay coherent within a single TCP-less channel.
 *
 * v1 caveats:
 *   - permissionMode is fixed at session-create time; canUseTool round-
 *     trips back to the host are NOT plumbed (the host's HIL flow only
 *     fires for the in-process claude-code provider). Default is
 *     'acceptEdits' so Claude proceeds without prompting.
 *   - mcpServers / hooks are accepted on the wire but only forwarded
 *     when serialisable. The host doesn't currently send them for the
 *     sandbox path.
 *   - SSE events use `data: <JSON>\n\n` framing without retry hints.
 *     Reconnect/resume is the host's responsibility.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.CLAUDE_SERVER_PORT ?? 4097);
const HOST = process.env.CLAUDE_SERVER_HOST ?? '0.0.0.0';

// Lazy SDK load — same pattern as the in-process runtime so a missing
// peer dep produces a clear error at first use, not at boot.
let cachedSdk;
async function loadSdk() {
  if (cachedSdk) {
    return cachedSdk;
  }
  cachedSdk = await import('@anthropic-ai/claude-agent-sdk');
  return cachedSdk;
}

// sessionId → Session
const sessions = new Map();

/**
 * Streaming-input adapter — buffered async iterator the SDK consumes
 * one message at a time. Mirrors the host-side `runtime.ts` queue but
 * inlined so this file stays single-source.
 */
function createUserMessageQueue() {
  const buffer = [];
  const waiters = [];
  let closed = false;

  function deliver(value) {
    const w = waiters.shift();
    if (w) {
      w({ value, done: false });
    } else {
      buffer.push(value);
    }
  }

  function deliverDone() {
    while (waiters.length > 0) {
      const w = waiters.shift();
      w({ value: undefined, done: true });
    }
  }

  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (buffer.length > 0) {
              return Promise.resolve({ value: buffer.shift(), done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => waiters.push(resolve));
          },
          return() {
            closed = true;
            deliverDone();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
    push(msg) {
      if (closed) {
        return;
      }
      deliver(msg);
    },
    close() {
      closed = true;
      deliverDone();
    },
  };
}

function asUserMessage(text) {
  return { type: 'user', message: { role: 'user', content: text } };
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function createSession(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid json body', message: String(err?.message ?? err) });
  }

  if (!body.apiKey || typeof body.apiKey !== 'string') {
    return sendJson(res, 400, { error: 'apiKey is required' });
  }

  const sdk = await loadSdk();

  const queue = createUserMessageQueue();

  const options = {
    cwd: body.cwd ?? '/workspace',
    systemPrompt: body.systemPrompt
      ? { type: 'preset', preset: 'claude_code', append: body.systemPrompt }
      : undefined,
    permissionMode: body.permissionMode ?? 'acceptEdits',
    model: body.defaultModel,
    allowedTools: Array.isArray(body.allowedTools) ? [...body.allowedTools] : undefined,
    disallowedTools: Array.isArray(body.disallowedTools) ? [...body.disallowedTools] : undefined,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: body.apiKey,
      CLAUDE_AGENT_SDK_CLIENT_APP: '@flowlib/agents-claude-server/0.0.1',
    },
  };

  const query = sdk.query({ prompt: queue.iterable, options });

  const sessionId = `cc-${randomUUID()}`;
  sessions.set(sessionId, {
    queue,
    query,
    cwd: options.cwd,
    closed: false,
  });

  return sendJson(res, 201, { sessionId });
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function promptSession(req, res, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return sendJson(res, 404, { error: 'unknown sessionId' });
  }
  if (session.closed) {
    return sendJson(res, 410, { error: 'session is closed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid json body', message: String(err?.message ?? err) });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text) {
    return sendJson(res, 400, { error: 'text is required' });
  }

  // Optional per-turn model override.
  if (body.model && typeof body.model === 'string') {
    try {
      await session.query.setModel(body.model);
    } catch {
      // SDK rejects setModel outside streaming-input mode — ignore.
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });

  // Wire HTTP request abort → SDK interrupt. The host closes its fetch
  // when the user cancels, which fires `aborted` here.
  let aborted = false;
  req.on('close', () => {
    aborted = true;
    session.query.interrupt?.().catch(() => {});
  });

  session.queue.push(asUserMessage(text));

  try {
    while (true) {
      if (aborted) {
        break;
      }
      const next = await session.query.next();
      if (next.done) {
        break;
      }
      const msg = next.value;
      writeSseEvent(res, { type: 'sdk-message', message: msg });
      if (msg && typeof msg === 'object' && msg.type === 'result') {
        // Turn boundary — the SDK keeps the generator open across
        // turns, so we slice it manually.
        break;
      }
    }
  } catch (err) {
    writeSseEvent(res, {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  writeSseEvent(res, { type: 'end' });
  res.end();
}

async function closeSession(req, res, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return sendJson(res, 404, { error: 'unknown sessionId' });
  }
  session.closed = true;
  sessions.delete(sessionId);
  session.queue.close();
  try {
    await session.query.return?.(undefined);
  } catch {
    // SDK throws on double-return; ignore.
  }
  return sendJson(res, 200, { ok: true });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  try {
    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { ok: true, sessions: sessions.size });
    }

    if (method === 'POST' && url === '/sessions') {
      return await createSession(req, res);
    }

    const promptMatch = /^\/sessions\/([^/]+)\/prompt$/.exec(url);
    if (method === 'POST' && promptMatch) {
      return await promptSession(req, res, decodeURIComponent(promptMatch[1]));
    }

    const sessionMatch = /^\/sessions\/([^/]+)$/.exec(url);
    if (method === 'DELETE' && sessionMatch) {
      return await closeSession(req, res, decodeURIComponent(sessionMatch[1]));
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    } else {
      try {
        res.end();
      } catch {
        // socket already torn down
      }
    }
  }
});

server.listen(PORT, HOST, () => {
  // Stable, parseable line the host can log-tail to confirm readiness.
  // The cloudflareSandboxClaude provider polls /health rather than
  // grepping logs, but this stays useful when debugging by hand.
  // eslint-disable-next-line no-console
  console.log(`[agents/claude-code-server] listening on ${HOST}:${PORT}`);
});
