# Flowlib — full-feature single-container image (Express API + built SPA).
#
# Serves the `express-drizzle` example's full plugin set (auth, rbac,
# webhooks, mcp, vercel-workflows, version-control, agents) plus the Vite
# frontend. The Docker server reuses `examples/express-drizzle/flowlib.config.ts`
# so the image never drifts from the example.
#
# Build:  docker compose -f docker/docker-compose.yml build
# Run:    docker compose -f docker/docker-compose.yml up

# ── Stage 1: Base ────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
# Build deps for native modules (better-sqlite3) + sqlite CLI.
RUN apk add --no-cache python3 make g++ sqlite
WORKDIR /app

# ── Stage 2: Build ───────────────────────────────────────────────
# Copy the whole monorepo and install from the committed lockfile. We
# deliberately avoid per-package `COPY package.json` enumeration — it
# silently rots whenever a package is added (the old Dockerfile was
# missing mcp / version-control / vercel-workflows / agents). A full copy
# is always correct; layer-cache loss on source change is acceptable for
# a self-host image.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile

# Build every workspace package (sequential — avoids a CSS race in Docker).
RUN pnpm --filter '@flowlib/*' --workspace-concurrency=1 run build

# Build the SPA with the Docker vite config (bundles @flowlib/* — no
# externals — for static serving). `/flowlib` is the same-origin API base.
RUN cp docker/vite.config.docker.ts examples/vite-react-frontend/vite.config.docker.ts && \
    cd examples/vite-react-frontend && \
    VITE_FLOWLIB_API_BASE_URL=/flowlib npx vite build --config vite.config.docker.ts

# Generate the dialect Drizzle schema + migrations from the merged
# core+plugin schema (writes db/schema.ts + drizzle/).
RUN cd examples/express-drizzle && pnpm flowlib:generate

# The Docker server reuses the example's flowlib.config; co-locate it so
# the `./flowlib.config` import + workspace deps resolve.
RUN cp docker/server.ts examples/express-drizzle/docker-server.ts

# ── Stage 3: Production ──────────────────────────────────────────
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
# `sqlite` for the DB; `docker-cli` so the agents plugin's local-docker
# sandbox can drive sibling containers over the mounted host socket
# (opt-in — see docker-compose.yml).
RUN apk add --no-cache sqlite docker-cli
WORKDIR /app

# Carry the fully-built workspace (node_modules + every dist + generated
# schema/migrations). pnpm's symlinked node_modules is preserved.
COPY --from=build /app /app

RUN mkdir -p /app/data

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/flowlib.db
ENV FLOWLIB_DB_TYPE=sqlite
ENV FLOWLIB_LOG_LEVEL=info
# The built SPA the Docker server serves.
ENV STATIC_DIR=/app/examples/vite-react-frontend/dist
# FLOWLIB_ENCRYPTION_KEY is required at runtime — set it in docker-compose.yml.

# Apply migrations to the runtime DB (drizzle-kit migrate, not push —
# avoids the SQLite CREATE INDEX bug), then start the server.
CMD ["sh", "-c", "cd /app/examples/express-drizzle && DB_FILE_NAME=$DATABASE_URL npx drizzle-kit migrate && npx tsx docker-server.ts"]
