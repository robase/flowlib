#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# "...pkg" = package + all its transitive workspace dependencies (upstream).
# This auto-discovers the full dependency graph for the NestJS example app:
#   nest-prisma → @flowlib/core, @flowlib/nestjs
DEV_FILTERS=(
  --filter "...nest-prisma"
)

echo "==> Building workspace packages (topological order)"
pnpm "${DEV_FILTERS[@]}" \
  --filter "!nest-prisma" \
  --workspace-concurrency=1 run --if-present build

echo ""
echo "==> Starting NestJS watch mode"
pnpm "${DEV_FILTERS[@]}" --parallel --stream run dev
