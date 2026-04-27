<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/express</h1>

<p align="center">
  Express adapter for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/integrations/express"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

Mount Flowlib into any Express app with a single router. All API endpoints — flows, executions, credentials, agent tools, OAuth2 — are handled automatically.

## Install

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/core @flowlib/express
```

## Usage

```ts
import express from 'express';
import { createFlowlibRouter } from '@flowlib/express';

const app = express();

const flowlibRouter = await createFlowlibRouter({
  database: {
    type: 'sqlite',
    connectionString: 'file:./dev.db',
  },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY, // npx flowlib-cli secret
});

app.use('/flowlib', flowlibRouter);
app.listen(3000);
```

That's it. The router handles initialization, batch polling, and all API routes.

## With Plugins

```ts
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [auth({ globalAdmins: [{ email: 'admin@example.com', pw: 'secret' }] }), rbac()],
});

app.use('/flowlib', flowlibRouter);
```

## Frontend

Pair with [`@flowlib/ui`](../ui) for the visual flow editor:

```tsx
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';

<Flowlib apiBaseUrl="http://localhost:3000/flowlib" />;
```

## License

[MIT](../../LICENSE)
