<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/nextjs</h1>

<p align="center">
  Next.js App Router handler for Invect.
  <br />
  <a href="https://flowlib.dev/docs/integrations/nextjs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

Add Invect to any Next.js app with a single catch-all API route. Handles all endpoints — flows, executions, credentials, agent tools, and OAuth2.

For production deployments on Vercel, add one dedicated Invect cron route as well. That single route runs Invect maintenance work for the app: batch polling, paused-flow resumption, stale-run cleanup, and Invect cron triggers.

## Install

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/core @flowlib/nextjs
```

## Usage

Create a catch-all route in your Next.js App Router:

```ts
// app/api/flowlib/[...flowlib]/route.ts
import { createInvectHandler } from '@flowlib/nextjs';

const handler = createInvectHandler({
  database: {
    type: 'sqlite',
    connectionString: process.env.DATABASE_URL || 'file:./dev.db',
  },
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY, // npx flowlib-cli secret
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const PATCH = handler.PATCH;
export const DELETE = handler.DELETE;
```

All Invect API endpoints are now available under `/api/flowlib/`.

## Vercel Cron

Create a dedicated maintenance route for production cron jobs:

```ts
// app/api/flowlib/cron/route.ts
import { createInvectCronHandler } from '@flowlib/nextjs';

const handleCron = createInvectCronHandler({
  database: {
    type: 'sqlite',
    connectionString: process.env.DATABASE_URL || 'file:./dev.db',
  },
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY,
  triggers: {
    cronEnabled: true,
    webhookBaseUrl: 'https://your-app.com/api/flowlib',
  },
});

export const GET = handleCron;
```

Then configure one Vercel cron in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/flowlib/cron", "schedule": "* * * * *" }]
}
```

This single Invect cron is the fan-out point for background work in the app.

## Frontend

Add the flow editor to any page:

```tsx
// app/flowlib/[[...slug]]/page.tsx
import { Invect } from '@flowlib/ui';
import '@flowlib/ui/styles';

export default function InvectPage() {
  return <Invect apiBaseUrl="/api/flowlib" basePath="/flowlib" />;
}
```

## License

[MIT](../../LICENSE)
