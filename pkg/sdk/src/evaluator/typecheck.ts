/**
 * TypeScript pre-save validation for chat-generated flow source.
 *
 * The chat-assistant pipeline historically runs source through jiti, which
 * transpiles TS to JS but discards type information. Type errors only
 * surfaced at runtime (or never, for fields the runtime tolerates). This
 * module closes that gap: feed the source into the actual TypeScript
 * compiler, get back a structured list of diagnostics, and surface them
 * back to the LLM before the merge/save step.
 *
 * Pipeline:
 *   ```ts
 *   const eval = await evaluateSdkSource(src);
 *   if (!eval.ok) return { errors: eval.errors };
 *   const tc = await typecheckSdkSource(src);
 *   if (!tc.ok) return { errors: tc.diagnostics };
 *   // … merge / transform / save
 *   ```
 *
 * Implementation: synthesises a temp file inside `os.tmpdir()`, builds a
 * `ts.createProgram` with the workspace's `@flowlib/sdk`,
 * `@flowlib/action-kit`, and `@flowlib/actions` packages mapped in via
 * `compilerOptions.paths`, runs `getPreEmitDiagnostics`, filters down to
 * the user file, formats line/column/message tuples.
 *
 * Cold-path latency is roughly 1-3s (TS program creation dominates). Cached
 * across a chat session would be a useful future optimisation but isn't
 * here yet — the LLM authoring loop is already paced by network calls so
 * the additional round-trip is negligible relative to model latency.
 */

import { dirname, join } from 'node:path';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import ts from 'typescript';

export interface TypecheckDiagnostic {
  /** 1-based line number in the user-supplied source. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Human-readable message. Multi-line messages collapse into `\n`-joined text. */
  message: string;
  /** TypeScript diagnostic code (e.g. 2322 for type-mismatch). */
  code: number;
}

export interface TypecheckOptions {
  /** Override the SDK package specifier (defaults to `@flowlib/sdk`). */
  sdkImportSpecifier?: string;
}

export interface TypecheckResult {
  ok: boolean;
  diagnostics: TypecheckDiagnostic[];
}

/**
 * Type-check a flow source string. Returns `ok: true, diagnostics: []` when
 * the source is type-safe, otherwise a list of diagnostics keyed to the
 * 1-based line/column of the user's source.
 *
 * Only diagnostics that originate inside the user's source are returned —
 * problems in the SDK / action-kit / actions packages are filtered out
 * (those are the SDK author's bugs, not the chat user's).
 */
export async function typecheckSdkSource(
  source: string,
  options: TypecheckOptions = {},
): Promise<TypecheckResult> {
  const sdkSpecifier = options.sdkImportSpecifier ?? '@flowlib/sdk';

  // Resolve workspace package locations from the perspective of this
  // module. We map the bare specifier (e.g. `@flowlib/sdk`) plus every
  // declared subpath (e.g. `@flowlib/sdk/actions`, `@flowlib/actions/gmail`).
  // Subpaths are resolved through `package.json` `exports` so the
  // typescript compiler lands on the .d.mts the bundler would have used.
  const req = createRequire(import.meta.url);
  const paths: Record<string, string[]> = {};
  await registerPackage(sdkSpecifier, req, paths);
  await registerPackage('@flowlib/action-kit', req, paths);
  await registerPackage('@flowlib/actions', req, paths);

  // Materialise the source to a temp file so the TS compiler has a stable
  // filename to attach diagnostics to.
  const tmpDir = await mkdtemp(join(tmpdir(), 'flowlib-typecheck-'));
  const tmpFile = join(tmpDir, 'flow.ts');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(tmpFile, source, 'utf-8');

  try {
    const program = ts.createProgram({
      rootNames: [tmpFile],
      options: {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        esModuleInterop: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        resolveJsonModule: true,
        baseUrl: tmpDir,
        paths,
        types: [],
        // Without this, the compiler complains it can't find the lib types
        // for ES2022 + DOM. We don't care about DOM here.
        lib: ['lib.es2022.d.ts'],
      },
    });

    const allDiags = ts.getPreEmitDiagnostics(program);
    // Only surface diagnostics from the user's source — internal SDK
    // problems are not the chat user's to fix.
    const tmpFileNorm = tmpFile.replace(/\\/g, '/');
    const userDiags = allDiags.filter((d) => {
      if (!d.file) {
        return false;
      }
      return d.file.fileName.replace(/\\/g, '/') === tmpFileNorm;
    });

    return {
      ok: userDiags.length === 0,
      diagnostics: userDiags.map((d) => formatDiagnostic(d)),
    };
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function formatDiagnostic(d: ts.Diagnostic): TypecheckDiagnostic {
  const pos =
    d.file && d.start !== undefined
      ? d.file.getLineAndCharacterOfPosition(d.start)
      : { line: 0, character: 0 };
  return {
    line: pos.line + 1,
    column: pos.character + 1,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: d.code,
  };
}

/**
 * Add path-mapping entries for a workspace package so the TypeScript
 * compiler can resolve `${name}` and every `${name}/<subpath>` declared in
 * `package.json` `exports`.
 *
 * For each `exports` key we use `require.resolve(fullSpecifier)` which
 * honours the package's conditions (import / require / types) and lands on
 * the exact file the bundler would have picked. That file is what we hand
 * to TS as the path target.
 */
async function registerPackage(
  name: string,
  req: NodeJS.Require,
  paths: Record<string, string[]>,
): Promise<void> {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = req.resolve(`${name}/package.json`);
  } catch {
    return; // not resolvable — diagnostics surface as plain "module not found"
  }
  const root = dirname(pkgJsonPath);

  // Bare specifier always maps to the package root — TS will read that
  // package.json's `types` / `exports` to find the entry .d.ts.
  paths[name] = [root];

  let pkg: { exports?: unknown };
  try {
    // pkgJsonPath comes from `require.resolve(...)` which is package-system
    // controlled, not user input — safe to read.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await readFile(pkgJsonPath, 'utf-8');
    pkg = JSON.parse(raw) as { exports?: unknown };
  } catch {
    return;
  }
  const exportsMap = pkg.exports;
  if (!exportsMap || typeof exportsMap !== 'object') {
    return;
  }

  for (const key of Object.keys(exportsMap as Record<string, unknown>)) {
    if (key === '.' || !key.startsWith('./') || key.endsWith('package.json')) {
      continue;
    }
    const sub = key.slice(2); // './actions' → 'actions'
    const fullSpecifier = `${name}/${sub}`;
    try {
      const resolved = req.resolve(fullSpecifier);
      // `req.resolve` honours Node conditions and lands on a runtime
      // `.cjs`/`.mjs` file. Find the matching `.d.mts` / `.d.cts` next to
      // it — TS's path mapping needs the actual declaration file.
      const dts = findDeclarationFor(resolved);
      paths[fullSpecifier] = [dts ?? resolved];
    } catch {
      // Subpath listed but unresolvable — typically a browser-only or
      // dist-not-built case. Skip silently; the diagnostic will surface
      // when the user's source actually imports it.
    }
  }
}

/**
 * Given a resolved runtime file path (e.g. `dist/generated/index.cjs`),
 * find a sibling `.d.mts` / `.d.cts` / `.d.ts` next to it. Returns null
 * when no declaration file is present.
 */
function findDeclarationFor(runtimePath: string): string | null {
  const base = runtimePath.replace(/\.(cjs|mjs|js)$/, '');
  for (const ext of ['.d.mts', '.d.cts', '.d.ts']) {
    const candidate = `${base}${ext}`;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      ts.sys.fileExists(candidate);
      if (ts.sys.fileExists(candidate)) {
        return candidate;
      }
    } catch {
      // skip
    }
  }
  return null;
}
