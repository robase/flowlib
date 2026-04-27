#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# "...pkg" = package + all its transitive workspace dependencies (upstream).
# This auto-discovers the full dependency graph for the Next.js example app:
#   flowlib-nextjs-example → @flowlib/core, @flowlib/nextjs, @flowlib/ui
DEV_FILTERS=(
  --filter "...flowlib-nextjs-example"
)

echo "==> Building workspace packages (topological order)"
pnpm "${DEV_FILTERS[@]}" \
  --filter "!flowlib-nextjs-example" \
  --workspace-concurrency=1 run --if-present build

echo ""
echo "==> Starting Next.js watch mode"
pnpm "${DEV_FILTERS[@]}" --parallel --stream run dev
