<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/webhooks</h1>

<p align="center">
  Webhook trigger plugin for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Adds webhook management, ingestion, signature verification, and rate limiting to Flowlib. Create webhook endpoints that trigger flow runs when external services send events.

## Install

```bash
pnpm add @flowlib/webhooks
```

## Backend

```ts
import { webhooks } from '@flowlib/webhooks';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [webhooks()],
});

app.use('/flowlib', flowlibRouter);
```

### Options

```ts
webhooks({
  webhookBaseUrl: 'https://example.com/api/flowlib', // Base URL for webhook endpoints
  rateLimitMaxRequests: 60, // Max requests per window (default: 60)
  rateLimitWindowMs: 60_000, // Rate limit window in ms (default: 60s)
  dedupTtlMs: 86_400_000, // Deduplication TTL in ms (default: 24h)
});
```

## Frontend

```tsx
import { Flowlib } from '@flowlib/ui';
import { webhooksFrontend } from '@flowlib/webhooks/ui';

<Flowlib apiBaseUrl="/api/flowlib" plugins={[webhooksFrontend]} />;
```

The plugin adds a Webhooks page to the sidebar for managing webhook triggers.

## Features

- **Signature verification** — HMAC validation for GitHub, GitLab, Slack, and generic providers.
- **Rate limiting** — Per-IP/path rate limiting with configurable windows.
- **Deduplication** — Idempotency via event deduplication (24h TTL default).
- **IP allowlisting** — Restrict webhook sources by IP address.

## Exports

| Entry Point              | Content                                              |
| ------------------------ | ---------------------------------------------------- |
| `@flowlib/webhooks`       | Backend plugin (Node.js)                             |
| `@flowlib/webhooks/ui`    | Frontend plugin — `webhooksFrontend`, `WebhooksPage` |
| `@flowlib/webhooks/types` | Shared types                                         |

## License

[MIT](../../../LICENSE)
