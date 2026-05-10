import { defineConfig } from 'tsdown';

/**
 * Builds the extension host bundle (CJS, Node 18+).
 *
 * The webview bundle is built separately via `vite build` (see vite.config.ts).
 */
export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node18',
  dts: false,
  sourcemap: true,
  // `clean: true` would wipe the whole `dist/` dir — including `dist/webview/`
  // built by vite. Limiting clean to our own outputs keeps the two builders
  // independent. tsdown overwrites these files anyway so the explicit list
  // is mainly to handle source-map renames if the entry ever changes.
  clean: ['dist/extension.js', 'dist/extension.js.map'],
  // VSCode extensions ship as a .vsix without node_modules (we exclude it
  // in .vscodeignore). tsdown's default treats `dependencies` as external —
  // fine for libraries, broken for an extension. We instead force-bundle
  // everything by declaring `noExternal: true`. `vscode` is the only
  // genuine host external.
  //
  // jiti is bundled like everything else, but its bundled chunk does a
  // runtime `createRequire(...).resolve('../dist/babel.cjs')` that
  // can't be statically traced. `scripts/copy-jiti-babel.mjs` runs as
  // a post-build step and copies that file into `dist/` so the lookup
  // resolves.
  noExternal: () => true,
  // `vscode` is the host external. `better-sqlite3` is a native module (ships
  // a `.node` binary loaded via `bindings`); it can't be bundled, so it stays
  // external and the relevant `node_modules` dirs are un-ignored in
  // `.vscodeignore` so the binary ships with the .vsix.
  external: ['vscode', 'better-sqlite3'],
  outExtensions() {
    return { js: '.js' };
  },
});
