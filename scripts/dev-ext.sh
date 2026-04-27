#!/usr/bin/env bash
set -euo pipefail

# Launch the @flowlib/vscode extension in a VSCode Extension Development Host
# AND start watch builds for the packages the extension consumes.
#
# Watch sequence:
#   - @flowlib/ui          (Vite watch — rebuilds dist/ on source changes)
#   - @flowlib/vscode host (tsdown --watch — rebuilds dist/extension.js)
#   - @flowlib/vscode webview (Vite watch — rebuilds dist/webview/main.js)
#
# When any of these rebuilds, hit Cmd+R in the Extension Development Host
# window to reload the webview / activate the new host bundle.
#
# Initial sequence: catalogue codegen → host bundle → webview bundle, then
# the watch jobs start, then `code --extensionDevelopmentPath` opens the
# dev-host window.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$ROOT/pkg/vscode-extension"

if ! command -v code >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Error: 'code' CLI is not on your PATH.

Install it from VSCode:
  Cmd+Shift+P → "Shell Command: Install 'code' command in PATH"

Or invoke the dev host directly:
  open -a "Visual Studio Code" --args --extensionDevelopmentPath=pkg/vscode-extension --new-window
EOF
  exit 1
fi

echo "==> Building @flowlib/ui + @flowlib/vscode (host + webview)…"
pnpm --filter @flowlib/ui build
pnpm --filter @flowlib/vscode build

# Track child PIDs so the trap can clean everything up if the user Ctrl+C's.
PIDS=()

cleanup() {
  echo
  echo "==> Stopping watch jobs…"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

# Tail watch logs into the same terminal so you can see rebuild status.
echo
echo "==> Starting watch jobs (logs prefixed by package)…"

(pnpm --filter @flowlib/ui dev 2>&1 | sed -u 's/^/[ui]      /') &
PIDS+=($!)

(pnpm --filter @flowlib/vscode build:watch 2>&1 | sed -u 's/^/[ext]     /') &
PIDS+=($!)

(pnpm --filter @flowlib/vscode build:webview --watch 2>&1 | sed -u 's/^/[webview] /') &
PIDS+=($!)

echo
echo "==> Launching VSCode Extension Development Host"
echo "    Extension path: $EXT"
echo "    Reload the dev-host window (Cmd+R) after webview / ui rebuilds."
echo "    Ctrl+C here stops the watch jobs."
echo

# Run the dev-host window in foreground; when the user closes it (or
# Ctrl+C's), trap fires and stops the watch jobs.
code --extensionDevelopmentPath="$EXT" --new-window

# `code` returns immediately after launching, so wait on the watch jobs
# until the user interrupts the script.
wait
