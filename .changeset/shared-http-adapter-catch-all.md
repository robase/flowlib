---
'@flowlib/nestjs': minor
'@flowlib/express': minor
'@flowlib/nextjs': minor
'@flowlib/http': minor
---

# Shared HTTP adapter — first-party routes now run through `@flowlib/http`

All first-party Flowlib routes (`/flows/*`, `/flow-runs/*`, `/credentials/*`, `/triggers/*`, `/chat/*`, `/oauth2/*`, `/dashboard/*`, `/agent/*`, `/nodes/*`, `/node-data/*`, `/node-config/*`, `/node-definition/*`, `/actions/*`) are now declared once in `@flowlib/http/endpoints/*` and consumed by all three adapter packages. See `plans/shared-http-adapter-plan.md` for the full design.

## Behaviour-preserving for HTTP consumers

For anyone calling Flowlib over HTTP, the surface is unchanged: paths, methods, status codes, body shapes, headers, SSE framing, and `Set-Cookie` propagation all match the previous adapter implementations. This was a pure refactor of how the routes are wired internally.

Two minor places where behaviour is now strictly _more correct_ than before:

- **204 No Content responses** (`DELETE /flows/:id`, `DELETE /credentials/:id`, etc.) now send an empty body uniformly. Some adapters previously emitted the literal string `null` due to `res.json(null)` calls; the new writer detects null/undefined bodies and sends nothing.
- **Permission checks fire on every adapter.** The previous Next.js handler had no permission enforcement on first-party routes — a documented parity gap with Express. With the default `auth.enabled: false`, behaviour is unchanged. With `auth.enabled: true`, Next.js will now return 401/403 on routes that previously returned 200. This affects only hosts that explicitly opted into auth enforcement; if you run Flowlib without the `@flowlib/user-auth` plugin (or with `auth.enabled: false`), nothing changes.

## ⚠️ NestJS — per-route decorator metadata is gone

The Nest controller previously had ~68 per-route methods (`@Get('flows/:id')`, `@Post('flow-runs/:flowRunId/cancel')`, etc.). It now has two `@All` decorators:

- `@All('plugins/*')` — plugin endpoint dispatch (separate pipeline)
- `@All('*')` — first-party route catch-all

If you were attaching per-route Nest features to the Flowlib controller, they no longer match individual routes. The catch-all method receives every first-party request, so:

| Per-route feature                                   | Status                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@UseGuards(...)` on a specific method              | **Lost** — apply at controller or global level if you need it everywhere                     |
| `@UseInterceptors(...)` on a specific method        | **Lost** — apply at controller or global level                                               |
| `@SetMetadata(...)` + `Reflector.get()` on a method | **Lost** — `Reflector` will return the catch-all method's metadata, not the original route's |
| Per-route swagger (`@ApiOperation`, `@ApiTags`)     | **Lost** — first-party routes no longer appear individually in generated swagger             |
| `@HttpCode(...)` on a method                        | Not needed — registry handlers set their own status                                          |
| `@Header(...)` on a method                          | Not needed — registry handlers set their own headers                                         |
| `@UseGuards(...)` on the **controller class**       | **Still works** — applies to both `@All` methods                                             |
| Global guards (`app.useGlobalGuards`)               | **Still works**                                                                              |
| Global interceptors (`app.useGlobalInterceptors`)   | **Still works**                                                                              |
| Global exception filters                            | **Still works**                                                                              |

The trade-off was deliberate: every per-route method body became a one-line delegation to `runEndpoint`, and the registry's auth/parse/handle pipeline runs _before_ Nest's per-method pipeline could observe anything useful. Per-route metadata was carrying decorative information at that point, not real semantics.

If your app depends on per-route Nest metadata, you have two options:

1. Pin to `@flowlib/nestjs@<version-before-this-change>` and migrate when you can adapt to the catch-all model.
2. Wrap the Flowlib controller in your own controller that re-declares the routes you care about and forwards to Flowlib's API, attaching whatever decorators you need.

## Express + Next.js — no breaking changes

Express's `Router` still mounts each route individually (`router.get`, `router.post`, etc.) under the hood — the adapter just iterates `allFirstPartyEndpoints` and calls the right verb for each. Anything you attached to the returned `Router` (other middleware, additional routes) keeps working.

Next.js's catch-all handler signature is unchanged. Everything else (lazy init, build-phase detection, `createFlowlibCronHandler`, `createFlowlibEndpoint`) is untouched.

## What's exported from `@flowlib/http`

The package was previously not in the README package tables, install docs, or examples — it was internal to the adapter packages. It's now a deliberate public surface:

- `allFirstPartyEndpoints` — canonical ordered registry array (single source of truth)
- Per-slice exports (`flowsEndpoints`, `flowRunsEndpoints`, `triggersEndpoints`, `credentialsEndpoints`, `oauth2Endpoints`, `chatEndpoints`, `agentEndpoints`, `dashboardEndpoints`, `flowExecutionEndpoints`, `runEventsEndpoints`, `nodeDataEndpoints`, `nodesEndpoints`)
- `defineEndpoint`, `runEndpoint`, `matchHttpEndpoint` — for declaring custom slices
- `dispatchPluginEndpoint` — plugin endpoint pipeline
- `toWebRequestFromExpress`, `writeFlowlibHttpResultToExpress`, `writeWebResponseToExpress` — Express bridge helpers
- Shared parsers and error classifier (`parseJsonQueryParam`, `parsePagination`, `classifyHttpError`, etc.)

Custom adapter authors can now build a fourth framework adapter (Hono, Fastify, etc.) by walking `allFirstPartyEndpoints` and translating `FlowlibHttpResult` to the host framework's response — no need to re-implement any of the route logic.
