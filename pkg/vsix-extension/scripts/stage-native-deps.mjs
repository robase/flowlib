/**
 * Stage `better-sqlite3` (and its loader chain `bindings` + `file-uri-to-path`)
 * into `dist/node_modules/` so the bundled `dist/extension.js` can
 * `require('better-sqlite3')` at runtime.
 *
 * Why not bundle them: `better-sqlite3` ships a native `.node` binary loaded
 * via `bindings`, which uses stack-walking to find the binary adjacent to
 * its package.json. Both fail when bundled. The packages are also kept
 * `external` in `tsdown.config.ts`.
 *
 * Why not let vsce ship them: vsce runs `npm ls` to enumerate dependencies,
 * which fails on pnpm's symlinked layout. Vsce is invoked with
 * `--no-dependencies`, so anything not under `dist/` is excluded.
 *
 * The copy dereferences pnpm's symlinks so the .vsix contains real files.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const stagedRoot = resolve(pkgRoot, 'dist', 'node_modules');

const require = createRequire(import.meta.url);

const PACKAGES = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

mkdirSync(stagedRoot, { recursive: true });

for (const name of PACKAGES) {
  const pkgJsonPath = require.resolve(`${name}/package.json`, { paths: [pkgRoot] });
  const src = realpathSync(dirname(pkgJsonPath));
  const dest = resolve(stagedRoot, name);

  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(src, dest, { recursive: true, dereference: true });

  // Sanity-check the native binary for better-sqlite3.
  if (name === 'better-sqlite3') {
    const node = resolve(dest, 'build', 'Release', 'better_sqlite3.node');
    if (!existsSync(node)) {
      throw new Error(`[stage-native-deps] missing native binary: ${node}`);
    }
  }

  const version = JSON.parse(readFileSync(resolve(dest, 'package.json'), 'utf-8')).version;
  console.log(`[stage-native-deps] staged ${name}@${version} → ${dest}`);
}
