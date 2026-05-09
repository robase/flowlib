# @flowlib/vsix

VSCode extension for editing Flowlib flows visually. `.flow.ts` files are the source of truth — open one and the visual editor opens as a custom editor; save to write the file back.

## Develop

```bash
pnpm --filter @flowlib/vsix build      # bundle host (tsdown) + webview (vite)
pnpm --filter @flowlib/vsix typecheck  # tsc --noEmit
pnpm --filter @flowlib/vsix test       # @vscode/test-electron suite
pnpm --filter @flowlib/vsix package    # produce a .vsix
```

To launch the extension against a live VSCode for manual smoke:

```bash
code --extensionDevelopmentPath=pkg/vsix-extension
```

Open any `*.flow.ts` file (create an empty one if needed) — the custom editor renders the visual flow.

## Naming

- Workspace / npm name: `@flowlib/vsix` (scoped, matches the `@flowlib/*` convention).
- Dev-time extension ID: `flowlib.@flowlib/vsix` (VSCode keeps the npm scope in the ID).
- Packaged VSIX uses the unscoped `flowlib-vsix` (rewritten by `scripts/package.mjs`), giving published extension ID `flowlib.flowlib-vsix`.
