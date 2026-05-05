<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/http</h1>

<p align="center">
  Framework-agnostic HTTP route registry shared by Flowlib's Express, NestJS, and Next.js adapters.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Docs</strong></a>
</p>

---

Every first-party Flowlib HTTP route — `/flows/*`, `/flow-runs/*`, `/credentials/*`, `/triggers/*`, `/chat/*`, `/oauth2/*`, `/dashboard/*`, `/agent/*`, `/nodes/*`, `/node-data/*`, `/actions/*` — is declared once in this package as a `FlowlibHttpEndpoint` and consumed by every adapter (`@flowlib/express`, `@flowlib/nestjs`, `@flowlib/nextjs`).

If you're running Flowlib on an officially-supported framework, you don't import this package directly. It exists for **custom adapter authors**: walk `allFirstPartyEndpoints`, translate each `FlowlibHttpResult` to your host framework's response, and you have a complete fourth adapter — Hono, Fastify, Bun.serve, Cloudflare Workers, Deno — without re-implementing any route logic.

## Install

```bash
npm install @flowlib/http @flowlib/core
```

## Building a custom adapter

```ts
import { Hono } from 'hono';
import { createFlowlib } from '@flowlib/core';
import {
  allFirstPartyEndpoints,
  runEndpoint,
  matchHttpEndpoint,
  type FlowlibHttpResult,
} from '@flowlib/http';

const flowlib = await createFlowlib({
  /* config */
});

const app = new Hono();

app.all('/api/flowlib/*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/flowlib/, '');

  const matched = matchHttpEndpoint(allFirstPartyEndpoints, c.req.method, path);
  if (!matched) {
    return c.json({ error: 'not_found' }, 404);
  }

  const result: FlowlibHttpResult = await runEndpoint({
    endpoint: matched.endpoint,
    pathParams: matched.pathParams,
    request: c.req.raw, // standard Web Request
    flowlib,
    identity: null, // populate from your auth layer
  });

  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
});
```

Each endpoint declares its method, path, auth, parsing, and handler — the registry is the single source of truth. The first-party adapters are a few dozen lines of glue on top of this; see `pkg/express/src/mount-endpoints.ts` and `pkg/nextjs/src/index.ts` in the Flowlib repo.

## What's exported

- **`allFirstPartyEndpoints`** — canonical ordered registry array.
- **Per-slice exports**: `flowsEndpoints`, `flowRunsEndpoints`, `triggersEndpoints`, `credentialsEndpoints`, `oauth2Endpoints`, `chatEndpoints`, `agentEndpoints`, `dashboardEndpoints`, `flowExecutionEndpoints`, `runEventsEndpoints`, `nodeDataEndpoints`, `nodesEndpoints`.
- **`defineEndpoint`, `runEndpoint`, `matchHttpEndpoint`** — for declaring your own slices.
- **`dispatchPluginEndpoint`, `matchPluginEndpoint`** — plugin endpoint pipeline (separate from first-party routes).
- **Express bridge** (`toWebRequestFromExpress`, `writeFlowlibHttpResultToExpress`, `writeWebResponseToExpress`) — convert between Express's req/res and Web standards. Useful if your custom adapter wraps Express.
- **Shared parsers** (`parseJsonQueryParam`, `parsePagination`, `parseBooleanQueryParam`, `coerceSingleQueryValue`) and the error classifier (`classifyHttpError`).
- **Authorization helper** (`authorizeEndpoint`) — runs the same plugin-driven `onAuthorize` pipeline the first-party adapters use.

## Notes for adapter authors

- Endpoints that stream (SSE) return a `FlowlibHttpResult` whose `body` is a `ReadableStream`. The adapter is responsible for piping it back to the client; the Express bridge in this package does it for that adapter.
- Endpoints set their own `Set-Cookie` headers (e.g., the OAuth2 callback). Adapters must propagate every header — don't `JSON.stringify` the result and lose them.
- The plugin endpoint dispatcher (`dispatchPluginEndpoint`) is a **separate pipeline** from `runEndpoint`. Match `/plugins/*` first; everything else flows through `matchHttpEndpoint(allFirstPartyEndpoints, …)`.
- The package depends on `@flowlib/core` for endpoint handlers — handlers call into `flowlib.flows.*`, `flowlib.runs.*`, etc. You can't use `@flowlib/http` without an `FlowlibInstance`.

## License

[MIT](../../LICENSE)
