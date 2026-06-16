# Flowlib — Docker self-host

A single-container image that runs the full Flowlib stack: the Express API
(every plugin — `auth`, `rbac`, `webhooks`, `version-control`, `mcp`, and the
code-editing `agents`) **plus** the pre-built React SPA, served same-origin on
port `3000`.

The image reuses [`examples/express-drizzle/flowlib.config.ts`](../examples/express-drizzle/flowlib.config.ts)
as its config, so it never drifts from the example app. Everything is
env-driven.

## Quick start

```bash
# 1. Create docker/.env with at least an encryption key (gitignored).
cat > docker/.env <<EOF
FLOWLIB_ENCRYPTION_KEY=$(openssl rand -base64 32)   # or: npx flowlib-cli secret
FLOWLIB_ADMIN_EMAIL=admin@flowlib.local
FLOWLIB_ADMIN_PASSWORD=changeme
# Agent chat LLM key — one OpenRouter key fronts Claude/GPT/Gemini:
SEED_OPENROUTER_API_KEY=sk-or-...
# (or a direct vendor key: SEED_ANTHROPIC_API_KEY=sk-ant-...)
EOF

# 2. Build + run.
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build

# 3. Open http://localhost:3000 and sign in with the admin creds above.
curl http://localhost:3000/health        # {"status":"ok",...}
```

> The build is heavy on first run (full `pnpm install` + build of every
> `@flowlib/*` package + the SPA bundle, inside the container). The build
> context is small — `.dockerignore` excludes `node_modules`, `dist`, `.git`,
> `.env`, and local `*.db` files, so deps are installed fresh and clean.

## Configuration (environment)

Set these in `docker/.env` (consumed via `--env-file`). The compose file maps
them onto the container.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FLOWLIB_ENCRYPTION_KEY` | **yes** | — | base64 32-byte key for credential encryption + auth. The server **refuses to start** without it. |
| `FLOWLIB_ADMIN_EMAIL` / `FLOWLIB_ADMIN_PASSWORD` | no | `admin@flowlib.local` / `changeme` | Admin user seeded on first boot. |
| `SEED_OPENROUTER_API_KEY` | for chat | — | Seeded LLM credential. One OpenRouter key serves Claude/GPT/Gemini. |
| `SEED_ANTHROPIC_API_KEY` | alt | — | Direct Anthropic key (alternative to OpenRouter). |
| `DATABASE_URL` / `FLOWLIB_DB_TYPE` | no | `file:/app/data/flowlib.db` / `sqlite` | DB connection. SQLite persists to the `flowlib-data` volume. |
| `FLOWLIB_TRUSTED_ORIGINS` | no | — | Comma-separated extra CORS/auth origins (e.g. your public URL). |
| `AGENT_DOCKER_SANDBOX_IMAGE` | no | — | Enables the local agent sandbox (see below). |

`BETTER_AUTH_SECRET`, `FLOWLIB_WEBHOOK_BASE_URL`, `GITHUB_TOKEN` /
`FLOWLIB_VC_REPO`, and the OAuth `SEED_*_CLIENT_ID/SECRET` pairs are also
honored — see the comments in [`docker-compose.yml`](docker-compose.yml).

## Database

Defaults to SQLite at `/app/data/flowlib.db` on the `flowlib-data` volume
(survives restarts). Migrations (`drizzle-kit migrate`) run automatically on
container start before the server boots.

For PostgreSQL: set `FLOWLIB_DB_TYPE=postgresql` + `DATABASE_URL=postgresql://…`
and add a `db` service to the compose file.

## Agent chat

The `agents` plugin runs its chat loop **in-process on Express** over HTTP/SSE
(no Cloudflare Durable Object needed). Seed an LLM key (`SEED_OPENROUTER_API_KEY`
or `SEED_ANTHROPIC_API_KEY`) and attach that credential to a chat — turns then
stream tokens directly from the container.

## Agent sandbox (local Docker, opt-in)

By default the agent is **pure chat** (no shell/file tools). To give it a real
shell + filesystem in a per-chat container running locally, add the sandbox
overlay:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.sandbox.yml \
  up -d
```

The overlay ([`docker-compose.sandbox.yml`](docker-compose.sandbox.yml)) mounts
the host Docker socket and sets `AGENT_DOCKER_SANDBOX_IMAGE` (default
`node:24-slim`). The in-container `docker` CLI then drives the host daemon
(docker-outside-of-docker) to spawn **sibling** sandbox containers — one per
chat workspace, named `flowlib-sbx-<org>-<workspace>`. The agent's `sandbox.*`
tools (`run_command`, file read/write/glob, …) execute inside that container;
it boots lazily on first use and is destroyed when the workspace is deleted.

> ⚠️ **Security:** mounting `/var/run/docker.sock` grants the container — and
> therefore the agent's tools — root-equivalent control of the host Docker
> daemon. Only enable on a trusted host for trusted users.

For a **cloud** sandbox instead (e2b, Modal, Vercel, …), wire a ComputeSDK
provider via `@flowlib/agents/workspaces` (`computesdkWorkspace`) — see the
commented example in [`flowlib.config.ts`](../examples/express-drizzle/flowlib.config.ts).

## Files

| File | Purpose |
| --- | --- |
| [`Dockerfile`](Dockerfile) | 3-stage build (base → build → production). Copies the whole monorepo, installs from the lockfile, builds every package + the SPA. |
| [`docker-compose.yml`](docker-compose.yml) | The service: port, `flowlib-data` volume, env, healthcheck. |
| [`docker-compose.sandbox.yml`](docker-compose.sandbox.yml) | Opt-in overlay enabling the local Docker agent sandbox. |
| [`server.ts`](server.ts) | Thin Express entry — mounts the shared `flowlibConfig` at `/flowlib` and serves the SPA. |
| [`vite.config.docker.ts`](vite.config.docker.ts) | SPA build config (bundles `@flowlib/*` for static serving, same-origin `/flowlib` API base). |

## Notes

- **Rebuilding after source edits:** BuildKit can occasionally reuse a cached
  `COPY . .` layer on an incremental rebuild. If a change isn't reflected, force
  it with `docker compose -f docker/docker-compose.yml build --no-cache`.
- **Healthcheck:** uses `127.0.0.1` (not `localhost`) — busybox `wget` resolves
  `localhost` to IPv6 `::1` but the server binds IPv4 `0.0.0.0`.
- **Logs / status:** `docker compose -f docker/docker-compose.yml logs -f` and
  `… ps`.
