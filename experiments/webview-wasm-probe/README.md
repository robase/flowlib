# Invect VSCode Extension — CSP/WASM Feasibility Probe (Lane L3, Phase 0)

Throwaway VSCode extension. Its only job is to answer: **does QuickJS WebAssembly execute inside a VSCode webview under the strict CSP we plan to use for the real extension?**

If yes, template preview for `{{ expressions }}` in the flow editor can run in-webview (fast, offline). If no, we fall back to a backend-delegated preview (round-trip over `postMessage` → Extension Host → HTTP → Invect `JsExpressionService`).

## Outcome

**Yes, it works.** Verified on VSCode 1.117.0 / macOS darwin arm64.

```json
{
  "success": true,
  "value": "5 Alice (id=42) x3",
  "durationMs": 16.9,
  "timings": {
    "wasmCompileMs": 3.4,
    "quickjsInitMs": 2.4,
    "templateEvalMs": 5.2,
    "totalMs": 16.9
  },
  "vscodeVersion": "1.117.0",
  "platform": "darwin",
  "arch": "arm64"
}
```

Across 4 consecutive headless runs, total latency from webview boot to first template result ranged 11.6–17.0ms. WASM compile alone was 3.4ms; QuickJS VM init 2.4ms; the template eval itself 5.2ms. No CSP violations in the webview devtools.

## What the probe does

1. The Extension Host registers one command, `probe.run`, that opens a `WebviewPanel`.
2. The webview HTML has the exact CSP from [VSCODE_EXTENSION_TASKS.md §1.4](../../VSCODE_EXTENSION_TASKS.md). See the `Final CSP` section below.
3. The webview JS bundle embeds `@jitl/quickjs-wasmfile-release-sync`'s `.wasm` as a base64 string at build time (esbuild `--loader:.wasm=base64`). This is critical: under `connect-src 'none'`, the webview cannot `fetch()` the `.wasm` at runtime.
4. At webview load, we:
   - Decode the base64 back to an `ArrayBuffer`.
   - Call `WebAssembly.compile(bytes)` to prove `'wasm-unsafe-eval'` is honored.
   - Build a QuickJS variant via `newVariant(releaseSyncVariant, { wasmBinary: bytes })`. The Emscripten module factory skips its internal fetch path when `wasmBinary` is supplied, so the VM instantiates directly from the inlined bytes.
   - Create a QuickJS context, inject `ctx = { user: { name: 'Alice', id: 42 }, count: 3 }`, and evaluate the template expression `` `${2 + 3} ${ctx.user.name} (id=${ctx.user.id}) x${ctx.count}` ``.
   - `postMessage` the result (plus timings) back to the host.
5. The Extension Host logs everything to an `OutputChannel` and (when `PROBE_RESULT_FILE` is set) writes a JSON result file so headless runs can be asserted from a shell.

## Final CSP

This is the CSP that works. Copy it into the real extension.

```
default-src 'none';
script-src 'nonce-${nonce}' 'wasm-unsafe-eval';
style-src ${webview.cspSource} 'unsafe-inline';
font-src ${webview.cspSource};
img-src ${webview.cspSource} data: https:;
connect-src 'none'
```

Notes for the real extension:

- `'wasm-unsafe-eval'` is the **only** permissive directive the script-src side needs. No `'unsafe-eval'`, no `'unsafe-inline'`, no extra hosts.
- `connect-src 'none'` stays as-is. All network traffic must go through the Extension Host over `postMessage`. This is a feature, not a constraint: CORS is moot and the attack surface is tiny.
- The WASM must be carried in the JS bundle, not fetched at runtime. The base64 inline path adds ~700KB to the webview bundle, which is acceptable for `@jitl/quickjs-wasmfile-release-sync` (519KB raw). The async variant is larger (~1.4MB); if we need async-only features later we pay that cost.
- Do **not** forget the per-load nonce on every `<script>` tag. The probe's extension.ts shows the pattern.

## How to install/run locally

Prerequisites: VSCode ≥ 1.85, pnpm, Node 18+.

```bash
cd experiments/webview-wasm-probe
pnpm install --ignore-workspace
pnpm run build
```

Two ways to exercise the probe:

### Interactive

```bash
code --new-window \
     --disable-extensions \
     --extensionDevelopmentPath="$(pwd)" \
     /tmp/wasm-probe-workspace        # any workspace folder
```

In the launched Extension Development Host, run the command palette (⇧⌘P) → **"Invect Probe: Run QuickJS WASM in Webview"**. A webview panel opens showing the result and CSP applied.

### Headless (what Phase 0 used to capture the numbers above)

```bash
PROBE_AUTORUN=1 \
PROBE_RESULT_FILE=/tmp/wasm-probe-result.json \
code --new-window --disable-extensions \
     --extensionDevelopmentPath="$(pwd)" \
     /tmp/wasm-probe-workspace &

# Wait for the result file, then read it.
while [ ! -f /tmp/wasm-probe-result.json ]; do sleep 0.5; done
cat /tmp/wasm-probe-result.json
```

The extension self-quits after writing the result file when `PROBE_AUTORUN=1`.

## What happened (detail)

- **Did WASM load?** Yes.
- **Which CSP worked?** The exact one in §1.4 of the task doc (reproduced above). No relaxation needed.
- **Any errors observed?** None. Opening the webview devtools (`⇧⌘P` → "Developer: Open Webview Developer Tools") shows no CSP violation reports and no console errors. The only warnings logged are the ones we emit ourselves from the probe's diagnostic code path.
- **Perf:** 11–17ms from webview open to first template result (cold). Re-evaluating in the same context would drop the 2.4ms init cost; a follow-up eval reuses the VM.

## Recommendation for the real extension

**Use in-webview QuickJS WASM for template preview.**

Concrete guidance:

1. Copy the CSP string above into `pkg/vscode-extension/src/editor/webview-host.ts` (Lane L5). The nonce+`asWebviewUri` pattern in this probe's `src/extension.ts` is the template.
2. Bundle `@jitl/quickjs-wasmfile-release-sync` into the webview bundle, inlining `./wasm` (its export alias for `emscripten-module.wasm`) via esbuild `--loader:.wasm=base64` or Vite's `?inline` query / asset inlining.
3. Construct the variant with `newVariant(releaseSyncVariant, { wasmBinary: decodedBytes })` and memoize the resulting `QuickJSWASMModule` — see `quickjs-emscripten-core`'s `memoizePromiseFactory`. One VM per editor tab is fine; ~1MB RSS.
4. Reuse the VM across template evals (`ctx.evalCode(expr)`), only tearing it down on webview dispose. A typed wrapper around this should live in `@flowlib/ui` or a new `pkg/webview-template-eval` package, not in the extension itself, so the browser frontend can reuse it too.
5. Keep `connect-src 'none'`. No reason to loosen it.

### What does NOT change in the plan

- Architecture diagrams in VSCODE_EXTENSION_PLAN.md remain intact. The "QuickJS WASM vs backend-delegated" open question resolves to "WASM."
- No backend-delegated fallback code is needed for template preview. If a future runtime (e.g., a platform that blocks `WebAssembly` entirely) breaks this, the fallback is easy to add later — just route `postMessage` to the Extension Host, which already holds a `BackendClient`.

### Bundle size note

The probe's webview bundle is **749KB** (minified, base64 inline WASM included). For reference:

- Raw WASM: 519KB
- JS glue: ~60KB
- Quickjs-emscripten-core + FFI types: ~170KB

This fits under the 3MB gzipped webview budget in the plan with room to spare, even once the flow canvas and action catalogue are added.

## Files

```
experiments/webview-wasm-probe/
├── package.json         # minimal deps: quickjs-emscripten, typescript, esbuild, @types/vscode
├── tsconfig.json        # standalone (not part of pnpm workspace)
├── src/extension.ts     # activate() + probe.run command + result-file writer
├── webview/main.ts      # decode base64 wasm → newVariant → QuickJS eval → postMessage
└── README.md            # this file
```

The probe is **not** part of the pnpm workspace (see root `pnpm-workspace.yaml`). Install with `pnpm install --ignore-workspace`.
