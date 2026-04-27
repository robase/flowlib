# ── Stage 1: Base ────────────────────────────────────────────────
FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# ── Stage 2: Install dependencies ────────────────────────────────
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY pkg/core/package.json         pkg/core/package.json
COPY pkg/express/package.json      pkg/express/package.json
COPY pkg/nestjs/package.json       pkg/nestjs/package.json
COPY pkg/nextjs/package.json       pkg/nextjs/package.json
COPY pkg/ui/package.json           pkg/ui/package.json
COPY pkg/cli/package.json          pkg/cli/package.json
COPY pkg/layouts/package.json      pkg/layouts/package.json
COPY pkg/plugins/auth/package.json pkg/plugins/auth/package.json
COPY pkg/plugins/rbac/package.json      pkg/plugins/rbac/package.json
COPY pkg/plugins/webhooks/package.json  pkg/plugins/webhooks/package.json
COPY pkg/flowlib/package.json           pkg/flowlib/package.json

# Copy example package.jsons (needed for workspace resolution)
COPY examples/express-drizzle/package.json         examples/express-drizzle/package.json
COPY examples/vite-react-frontend/package.json     examples/vite-react-frontend/package.json
COPY examples/nest-prisma/package.json             examples/nest-prisma/package.json
COPY examples/nextjs-app-router/package.json       examples/nextjs-app-router/package.json
COPY examples/nextjs-drizzle-auth-rbac/package.json examples/nextjs-drizzle-auth-rbac/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ───────────────────────────────────────────────
FROM deps AS build

# Copy all source code
COPY . .

# Build all workspace packages (sequential to avoid CSS race condition in Docker)
RUN pnpm --filter '@flowlib/*' --workspace-concurrency=1 run build

# Build frontend for production using Docker-specific vite config
# (no @flowlib/core external — must bundle everything for static serving)
RUN cp docker/vite.config.docker.ts examples/vite-react-frontend/vite.config.docker.ts && \
    cd examples/vite-react-frontend && \
    VITE_INVECT_API_BASE_URL=/flowlib npx vite build --config vite.config.docker.ts

# Generate DB schema + migration files (--yes auto-accepts all prompts)
RUN cd examples/express-drizzle && pnpm flowlib:generate

# ── Stage 4: Production ─────────────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files for workspace resolution
COPY --from=build /app/pkg/core/package.json         pkg/core/package.json
COPY --from=build /app/pkg/express/package.json      pkg/express/package.json
COPY --from=build /app/pkg/nestjs/package.json       pkg/nestjs/package.json
COPY --from=build /app/pkg/nextjs/package.json       pkg/nextjs/package.json
COPY --from=build /app/pkg/ui/package.json           pkg/ui/package.json
COPY --from=build /app/pkg/cli/package.json          pkg/cli/package.json
COPY --from=build /app/pkg/layouts/package.json      pkg/layouts/package.json
COPY --from=build /app/pkg/plugins/auth/package.json pkg/plugins/auth/package.json
COPY --from=build /app/pkg/plugins/rbac/package.json      pkg/plugins/rbac/package.json
COPY --from=build /app/pkg/plugins/webhooks/package.json    pkg/plugins/webhooks/package.json
COPY --from=build /app/pkg/flowlib/package.json              pkg/flowlib/package.json
COPY --from=build /app/pkg/flowlib/bin.js                    pkg/flowlib/bin.js
COPY --from=build /app/examples/express-drizzle/package.json         examples/express-drizzle/package.json
COPY --from=build /app/examples/vite-react-frontend/package.json     examples/vite-react-frontend/package.json
COPY --from=build /app/examples/nest-prisma/package.json             examples/nest-prisma/package.json
COPY --from=build /app/examples/nextjs-app-router/package.json       examples/nextjs-app-router/package.json
COPY --from=build /app/examples/nextjs-drizzle-auth-rbac/package.json examples/nextjs-drizzle-auth-rbac/package.json

# Install dependencies (includes tsx needed to run TypeScript server)
RUN pnpm install --frozen-lockfile

# Create data directory for SQLite
RUN mkdir -p /app/data
COPY --from=build /app/pkg/core/dist/        pkg/core/dist/
COPY --from=build /app/pkg/express/dist/     pkg/express/dist/
COPY --from=build /app/pkg/ui/dist/          pkg/ui/dist/
COPY --from=build /app/pkg/cli/dist/         pkg/cli/dist/
COPY --from=build /app/pkg/layouts/dist/     pkg/layouts/dist/
COPY --from=build /app/pkg/plugins/auth/dist/     pkg/plugins/auth/dist/
COPY --from=build /app/pkg/plugins/rbac/dist/     pkg/plugins/rbac/dist/
COPY --from=build /app/pkg/plugins/webhooks/dist/ pkg/plugins/webhooks/dist/

# Copy built frontend
COPY --from=build /app/examples/vite-react-frontend/dist/ /app/frontend/

# Copy generated DB schema + drizzle migrations
COPY --from=build /app/examples/express-drizzle/db/       examples/express-drizzle/db/
COPY --from=build /app/examples/express-drizzle/drizzle/  examples/express-drizzle/drizzle/
COPY --from=build /app/examples/express-drizzle/drizzle.config.ts examples/express-drizzle/drizzle.config.ts

# Copy the docker server into express-drizzle dir for pnpm package resolution
COPY --from=build /app/docker/server.ts examples/express-drizzle/docker-server.ts

EXPOSE 3000

ENV PORT=3000
ENV DATABASE_URL=file:/app/data/flowlib.db
ENV INVECT_DB_TYPE=sqlite
ENV INVECT_LOG_LEVEL=info
ENV NODE_ENV=production
# INVECT_ENCRYPTION_KEY is required — generate with: npx flowlib-cli secret

# Initialise DB schema and start the server
# Uses drizzle-kit migrate (not push) to avoid the known SQLite CREATE INDEX bug
CMD ["sh", "-c", "cd /app/examples/express-drizzle && DB_FILE_NAME=$DATABASE_URL npx drizzle-kit migrate && npx tsx docker-server.ts"]
