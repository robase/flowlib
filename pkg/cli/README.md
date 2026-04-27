<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/cli</h1>

<p align="center">
  CLI for managing Flowlib projects.
  <br />
  <a href="https://flowlib.dev/docs/cli"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
</p>

---

Schema generation, database migrations, and project setup for Flowlib. Merges core + plugin schemas and generates dialect-specific Drizzle files for SQLite, PostgreSQL, and MySQL.

## Install

```bash
npm install -D @flowlib/cli
```

Or run directly:

```bash
npx flowlib-cli <command>
```

## Commands

### `flowlib-cli init`

Interactive setup wizard. Detects your framework, installs dependencies, creates `flowlib.config.ts`, generates schemas, and runs the initial migration.

### `flowlib-cli generate`

Generates Drizzle schema files for all three database dialects from your core + plugin schemas. Reads `flowlib.config.ts` to discover plugins.

```bash
npx flowlib-cli generate
```

### `flowlib-cli migrate`

Applies pending migrations or pushes the schema directly (dev mode).

```bash
npx flowlib-cli migrate
```

### `flowlib-cli info`

Displays diagnostic info — system, frameworks, databases, config, and plugins.

### `flowlib-cli secret`

Generates a cryptographically secure 32-byte base64 key for `FLOWLIB_ENCRYPTION_KEY`.

```bash
npx flowlib-cli secret
```

## Configuration

The CLI reads from `flowlib.config.ts` in your project root:

```ts
import { defineConfig } from '@flowlib/core';

export default defineConfig({
  database: {
    type: 'sqlite',
    connectionString: 'file:./dev.db',
  },
  plugins: [
    // Your plugins here — their schemas are merged automatically
  ],
});
```

## License

[MIT](../../LICENSE)
