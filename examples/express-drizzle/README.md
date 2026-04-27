<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">Express + Drizzle Example</h1>

<p align="center">
  Minimal Express backend for Invect with SQLite.
</p>

---

Primary development server for the Invect monorepo. Pair with the [Vite React frontend](../vite-react-frontend) for fullstack development.

## Quick Start

```bash
pnpm install
pnpm db:prepare  # Generate schema + push to SQLite
pnpm dev         # Starts Express on http://localhost:3000
```

`pnpm dev` auto-runs `db:prepare` when `dev.db` doesn't exist, so a fresh clone boots without manual setup.

This example now includes the version control plugin. It uses a placeholder GitHub token by default, so Git sync actions will fail until you set `GITHUB_TOKEN` and, if needed, `INVECT_VC_REPO`.

## Test the API

```bash
curl http://localhost:3000/flowlib/flows

curl -X POST http://localhost:3000/flowlib/flows \
  -H "Content-Type: application/json" \
  -d '{"name": "My Flow", "description": "A test flow"}'
```

## Fullstack Development

Run both the Express backend and the Vite frontend together:

```bash
# From the monorepo root
pnpm dev:fullstack
```

This starts the backend on `:3000` and the React flow editor on `:5173`.
