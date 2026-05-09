/**
 * Copy `jiti`'s `babel.cjs` into `dist/` after the tsdown bundle.
 *
 * Why: tsdown bundles jiti into `dist/jiti-<hash>.js`. At runtime jiti
 * does `createRequire(...).resolve('../dist/babel.cjs')` from its own
 * file path. With `__filename = <pkg>/dist/jiti-<hash>.js`, that
 * resolves to `<pkg>/dist/babel.cjs` — which doesn't exist unless we
 * copy it in. Marking jiti as `external` in tsdown.config.ts didn't
 * help (subpath dynamic require isn't externalised).
 *
 * Idempotent: overwrites if present, no-op if jiti isn't installed
 * (in case the SDK evaluator is removed later).
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

const require = createRequire(import.meta.url);
let jitiPkgJson;
try {
  jitiPkgJson = require.resolve('jiti/package.json');
} catch {
  console.warn('[copy-jiti-babel] jiti not installed — skipping');
  process.exit(0);
}

const jitiRoot = dirname(jitiPkgJson);
const src = resolve(jitiRoot, 'dist', 'babel.cjs');
const dest = resolve(distDir, 'babel.cjs');

if (!existsSync(src)) {
  console.warn(`[copy-jiti-babel] source missing: ${src}`);
  process.exit(0);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-jiti-babel] copied ${src} → ${dest}`);
