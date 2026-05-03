<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/core</h1>

<p align="center">
  Framework-agnostic workflow orchestration engine.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

The core engine behind Flowlib. Contains all business logic — flows, execution, actions, agents, credentials, and database — independent of any web framework.

Framework packages ([`@flowlib/express`](../express), [`@flowlib/nestjs`](../nestjs), [`@flowlib/nextjs`](../nextjs)) are thin adapters that wrap this core.

## Install

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/core
```

## Usage

```ts
import { createFlowlib } from '@flowlib/core';

const flowlib = await createFlowlib({
  database: {
    type: 'sqlite',
    connectionString: 'file:./dev.db',
  },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY, // npx flowlib-cli secret
});

// Create and run flows programmatically
const flow = await flowlib.flows.create({ name: 'My Workflow' });
const result = await flowlib.runs.start(flow.id, { message: 'Hello' });
```

## What's Inside

- **Flow engine** — Topological execution with dependency resolution, branching, loops, and pause/resume.
- **50+ actions** — Gmail, Slack, GitHub, Google Drive, Linear, Postgres, HTTP, JQ, and more. Each action works as both a flow node and an agent tool.
- **AI agents** — Iterative tool-calling loops with OpenAI and Anthropic APIs.
- **Batch processing** — Native OpenAI and Anthropic batch API support with automatic pause/resume.
- **Credentials** — AES-256-GCM encrypted storage with full OAuth2 flow support.
- **Multi-database** — SQLite, PostgreSQL, and MySQL. Works with Drizzle ORM, Prisma, or raw SQL migrations.
- **Plugin system** — Composable plugins for auth, RBAC, and custom extensions.

## Types

Import types for frontend consumption from the `/types` subpath (no runtime code):

```ts
import type { FlowDefinition, FlowRunResult } from '@flowlib/core/types';
```

## License

[MIT](../../LICENSE)
