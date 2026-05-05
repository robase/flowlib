---
'@flowlib/http': minor
---

# Publish `@flowlib/http` to npm

The package was previously marked `private: true` despite being on changesets. It now ships to npm so third-party adapter authors can build a fourth framework adapter (Hono, Fastify, Bun.serve, Cloudflare Workers, Deno) on top of `allFirstPartyEndpoints` without re-implementing route logic — exactly the use case the previous changeset (`shared-http-adapter-catch-all`) called out as the public-surface motivation.

## What changed

- `pkg/http/package.json` — removed `private: true`, added `publishConfig.access: "public"`, plus the standard package metadata (homepage, bugs, repository, keywords, author).
- Added `./package.json` to `exports` so consumers can resolve it (e.g., for build-tool version detection).
- Updated the in-source comment block to reflect public-surface status.
- New `README.md` with a Hono adapter example.

## What did not change

- The exported surface itself (`allFirstPartyEndpoints`, `defineEndpoint`, `runEndpoint`, `matchHttpEndpoint`, `dispatchPluginEndpoint`, the parsers, the Express bridge) is unchanged from the previous internal version.
- Adapter packages (`@flowlib/express`, `@flowlib/nestjs`, `@flowlib/nextjs`) keep depending on `@flowlib/http` via `workspace:*`; pnpm will substitute the published version at pack time.

## Why

Having the package on changesets but `private: true` was a parity bug — the changelog described it as "a deliberate public surface" but `pnpm publish` would skip it, breaking any adapter package that declared it as a runtime dependency once installed from npm. Publishing is the simpler fix.
