/**
 * Codegen — produces `webview/static-action-catalogue.json` from
 * `@flowlib/actions`'s `allProviderActions`.
 *
 * Why a static JSON: the webview lives in a sandboxed iframe under strict
 * CSP, with no network and no Node APIs. We can't `import` `@flowlib/actions`
 * from the webview (it pulls QuickJS, googleapis, pg, etc.). Instead, this
 * script runs at extension build time, walks every registered action, calls
 * `actionToNodeDefinition` (the same conversion the REST `/nodes` endpoint
 * uses), and writes a deterministic JSON the webview imports as a static
 * resource.
 *
 * Live action catalogue (per L10) replaces this at runtime when the
 * extension connects to a backend; the static JSON is the offline fallback.
 *
 * Run via `pnpm catalogue:build`. CI fails the build if the committed JSON
 * is out of date — see `pnpm catalogue:check`.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionToNodeDefinition, allProviderActions } from '@flowlib/actions';
import type { NodeDefinition } from '@flowlib/ui/flow-canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = join(PACKAGE_ROOT, 'webview', 'static-action-catalogue.json');

function buildCatalogue(): NodeDefinition[] {
  const items = allProviderActions
    .map((action) => actionToNodeDefinition(action) as NodeDefinition)
    // Deterministic ordering so the committed JSON has minimal diffs across
    // regenerations — sort by `type` (the action ID).
    .sort((a, b) => a.type.localeCompare(b.type));
  return items;
}

function main(): void {
  const catalogue = buildCatalogue();
  // Stable formatting: 2-space indent, trailing newline.
  const out = `${JSON.stringify(catalogue, null, 2)}\n`;
  writeFileSync(OUTPUT_PATH, out, 'utf8');
  console.log(`[catalogue:build] wrote ${catalogue.length} actions → ${OUTPUT_PATH}`);
}

main();
