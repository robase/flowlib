# @flowlib/vscode

VSCode extension for editing Flowlib flows visually. `.flow.ts` files are the source of truth — open one and the visual editor opens as a custom editor; save to write the file back.

This is the Phase 1 / Lane L4 scaffold. The real editor loop, webview app, action catalogue, diagnostics, and backend client land in subsequent lanes.

## Develop

```bash
pnpm --filter @flowlib/vscode build      # bundle host (tsdown) + webview (vite)
pnpm --filter @flowlib/vscode typecheck  # tsc --noEmit
pnpm --filter @flowlib/vscode test       # @vscode/test-electron smoke
pnpm --filter @flowlib/vscode package    # produce a .vsix
```

To launch the extension against a live VSCode for manual smoke:

```bash
code --extensionDevelopmentPath=pkg/vscode-extension
```

Open any `*.flow.ts` file (create an empty one if needed) — the custom editor will render the placeholder webview.
