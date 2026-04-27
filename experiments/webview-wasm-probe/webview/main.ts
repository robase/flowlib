// QuickJS WASM probe — runs inside a VSCode webview under strict CSP.
// Goal: prove that WebAssembly.instantiate() works with `'wasm-unsafe-eval'`,
// then evaluate a template expression against a context object.

import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import releaseSyncVariant from '@jitl/quickjs-wasmfile-release-sync';
// esbuild base64 loader: inlines the .wasm file as a base64 string.
// This is the critical trick — under `connect-src 'none'` the webview can't
// fetch() the .wasm, so we must carry it in the JS bundle.
// @ts-expect-error — esbuild loader: base64
import wasmBase64 from '@jitl/quickjs-wasmfile-release-sync/wasm';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function log(level: 'info' | 'warn' | 'error', message: string) {
  try {
    vscode.postMessage({ type: 'log', level, message });
  } catch {
    /* swallow */
  }
  const status = document.getElementById('status');
  if (status && level !== 'info') {
    const div = document.createElement('div');
    div.className = level === 'error' ? 'err' : '';
    div.textContent = `[${level}] ${message}`;
    status.appendChild(div);
  }
}

function setStatus(text: string, ok = false) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = ok ? 'ok' : '';
  }
}

function setResults(obj: unknown) {
  const el = document.getElementById('results');
  if (el) {
    el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

async function run() {
  const t0 = performance.now();
  try {
    log('info', `Webview booted. UA=${navigator.userAgent}`);
    log('info', `typeof WebAssembly=${typeof WebAssembly}`);
    if (typeof WebAssembly === 'undefined') {
      throw new Error('WebAssembly global not available in webview');
    }

    // Step 1: decode the inlined .wasm
    const t1 = performance.now();
    const wasmBytes = base64ToArrayBuffer(wasmBase64 as unknown as string);
    log(
      'info',
      `decoded wasm bytes: ${wasmBytes.byteLength} in ${(performance.now() - t1).toFixed(1)}ms`,
    );

    // Step 2: probe raw WebAssembly.compile — confirms `'wasm-unsafe-eval'`
    // is honored and bytes can be turned into a Module.
    const t2 = performance.now();
    await WebAssembly.compile(wasmBytes.slice(0));
    log('info', `WebAssembly.compile ok in ${(performance.now() - t2).toFixed(1)}ms`);

    // Step 3: build a QuickJS variant that passes the inlined bytes directly.
    // Emscripten's module factory reads `wasmBinary` when set and skips its
    // internal fetch()/XHR — critical under our `connect-src 'none'` CSP.
    const customVariant = newVariant(releaseSyncVariant, {
      wasmBinary: wasmBytes,
      // Fallback safeguard: if emscripten still tries to locate a file,
      // point it at a data: URL it already has and log it.
      locateFile: (file: string) => {
        log('warn', `locateFile called for ${file} — should not happen with wasmBinary`);
        return file;
      },
    });

    const t3 = performance.now();
    const QuickJS = await newQuickJSWASMModuleFromVariant(customVariant);
    log('info', `QuickJS module ready in ${(performance.now() - t3).toFixed(1)}ms`);

    // Step 4: evaluate a template the way Flowlib does.
    const t4 = performance.now();
    const ctx = QuickJS.newContext();
    try {
      // Mimic buildIncomingDataObject + resolveTemplateParams:
      // pass an `inputs` object, evaluate an expression that interpolates it.
      const inputs = { user: { name: 'Alice', id: 42 }, count: 3 };

      // Set the inputs on the global object
      const inputsHandle = ctx.newObject();
      const userHandle = ctx.newObject();
      ctx.setProp(userHandle, 'name', ctx.newString(inputs.user.name));
      ctx.setProp(userHandle, 'id', ctx.newNumber(inputs.user.id));
      ctx.setProp(inputsHandle, 'user', userHandle);
      ctx.setProp(inputsHandle, 'count', ctx.newNumber(inputs.count));
      ctx.setProp(ctx.global, 'ctx', inputsHandle);
      userHandle.dispose();
      inputsHandle.dispose();

      const expression = '`${2 + 3} ${ctx.user.name} (id=${ctx.user.id}) x${ctx.count}`';
      const result = ctx.evalCode(expression);
      if (result.error) {
        const err = ctx.dump(result.error);
        result.error.dispose();
        throw new Error(`QuickJS eval error: ${JSON.stringify(err)}`);
      }
      const value = ctx.dump(result.value);
      result.value.dispose();
      const evalMs = performance.now() - t4;
      log('info', `template eval: ${JSON.stringify(value)} in ${evalMs.toFixed(1)}ms`);

      const totalMs = performance.now() - t0;
      setStatus(
        `Success — template evaluated in ${evalMs.toFixed(1)}ms (total ${totalMs.toFixed(1)}ms)`,
        true,
      );
      setResults({
        success: true,
        template: expression,
        context: inputs,
        result: value,
        timings: {
          wasmCompileMs: +(t3 - t2).toFixed(1),
          quickjsInitMs: +(t4 - t3).toFixed(1),
          templateEvalMs: +evalMs.toFixed(1),
          totalMs: +totalMs.toFixed(1),
        },
      });

      vscode.postMessage({
        type: 'result',
        success: true,
        value,
        durationMs: +totalMs.toFixed(1),
        timings: {
          wasmCompileMs: +(t3 - t2).toFixed(1),
          quickjsInitMs: +(t4 - t3).toFixed(1),
          templateEvalMs: +evalMs.toFixed(1),
          totalMs: +totalMs.toFixed(1),
        },
      });
    } finally {
      ctx.dispose();
    }
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
    log('error', msg);
    setStatus('Failed — see Flowlib WASM Probe output channel', false);
    setResults({ success: false, error: msg });
    vscode.postMessage({
      type: 'result',
      success: false,
      error: msg,
      durationMs: +(performance.now() - t0).toFixed(1),
    });
  }
}

vscode.postMessage({ type: 'ready' });
run();
