<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-light.svg">
    <img alt="Flowlib" src=".github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">flowlib</h1>

<p align="center">
  Drop-in AI workflows for your Node.js app.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Documentation</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a> · <a href="https://github.com/robase/flowlib"><strong>GitHub</strong></a>
</p>
 
<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://flowlib.dev/demo">
    <img src=".github/assets/flow-screenshot.png" alt="Flowlib Flow Editor" width="800" />
  </a>
</p>

<p align="center">
  <a href="https://flowlib.dev/demo"><strong>Try the live demo →</strong></a>
</p>

---

Flowlib is an open-source workflow orchestration library you mount directly into your existing Express, NestJS, or Next.js app. Visual flow editor, AI agent nodes, 50+ built-in integrations, and batch processing — all as a library, not a platform.

## Quick Start

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/core @flowlib/express @flowlib/ui
```

### Backend

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

### Frontend

```tsx
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';

export default () => <Flowlib apiBaseUrl="http://localhost:3000/flowlib" />;
```

## Features

- **Visual Flow Editor** — Drag-and-drop workflow builder with real-time execution monitoring.
- **AI Agent Nodes** — Iterative tool-calling loops with OpenAI and Anthropic APIs.
- **100+ Built-in Actions** — Gmail, Slack, GitHub, Google Drive, Linear, Postgres, and more.
- **Batch Processing** — Cut AI costs 50% with native OpenAI and Anthropic batch APIs.
- **AI-Assisted Builder** — Describe what you need in plain language and the assistant wires up nodes for you.
- **Multi-Database** — SQLite, PostgreSQL, and MySQL. Works with Drizzle ORM, Prisma, or raw SQL migrations.
- **Framework Agnostic** — One core, thin adapters for Express, NestJS, and Next.js.

## Packages

| Package                                                       | Description                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| [`@flowlib/core`](pkg/core)                                   | Framework-agnostic engine — flows, execution, actions, database |
| [`@flowlib/express`](pkg/express)                             | Express router adapter                                          |
| [`@flowlib/nestjs`](pkg/nestjs)                               | NestJS module adapter                                           |
| [`@flowlib/nextjs`](pkg/nextjs)                               | Next.js App Router handler                                      |
| [`@flowlib/ui`](pkg/ui)                                       | React flow editor and dashboard                                 |
| [`@flowlib/cli`](pkg/cli)                                     | CLI for schema generation, migrations, and project setup        |
| [`@flowlib/user-auth`](pkg/plugins/auth)                      | Authentication plugin (Better Auth)                             |
| [`@flowlib/rbac`](pkg/plugins/rbac)                           | Role-based access control plugin                                |
| [`@flowlib/webhooks`](pkg/plugins/webhooks)                   | Webhook triggers with signature verification and rate limiting  |
| [`@flowlib/version-control`](pkg/plugins/version-control)     | Sync flows to GitHub/GitLab/Bitbucket as `.flow.ts` files       |
| [`@flowlib/cloudflare-agents`](pkg/plugins/cloudflare-agents) | Compile flows to Cloudflare Workers & Workflows                 |
| [`@flowlib/mcp`](pkg/plugins/mcp)                             | Model Context Protocol server for AI coding agents              |

## Examples

| Example                                                         | Stack                 | Purpose                                 |
| --------------------------------------------------------------- | --------------------- | --------------------------------------- |
| [`express-drizzle`](examples/express-drizzle)                   | Express + SQLite      | Primary backend dev server              |
| [`vite-react-frontend`](examples/vite-react-frontend)           | Vite + React          | Standalone frontend for the flow editor |
| [`nest-prisma`](examples/nest-prisma)                           | NestJS + Prisma       | NestJS adapter example                  |
| [`nextjs-app-router`](examples/nextjs-app-router)               | Next.js 15            | Self-contained Next.js example          |
| [`nextjs-drizzle-auth-rbac`](examples/nextjs-drizzle-auth-rbac) | Next.js + Auth + RBAC | Full-featured example with plugins      |

## Development

```bash
pnpm install
pnpm dev           # Interactive menu
pnpm dev:fullstack # Express backend + Vite frontend
pnpm test          # Unit + integration tests
pnpm test:pw       # Playwright tests
pnpm typecheck     # Type-check all packages
```

## License

[MIT](LICENSE)
