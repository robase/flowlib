/**
 * CI guardrail — fail if `webview/static-action-catalogue.json` is stale.
 *
 * Regenerates the catalogue into a temp file and diffs against the committed
 * one. Avoids overwriting on disk so a failing CI run doesn't accidentally
 * "fix" the diff.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionToNodeDefinition, allProviderActions } from '@flowlib/actions';
import type { NodeDefinition } from '@flowlib/ui/flow-canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOGUE_PATH = join(resolve(__dirname, '..'), 'webview', 'static-action-catalogue.json');

function regenerate(): string {
  const items = allProviderActions
    .map((a) => actionToNodeDefinition(a) as NodeDefinition)
    .sort((a, b) => a.type.localeCompare(b.type));
  return `${JSON.stringify(items, null, 2)}\n`;
}

function main(): void {
  const expected = regenerate();
  let actual: string;
  try {
    actual = readFileSync(CATALOGUE_PATH, 'utf8');
  } catch (e) {
    console.error(`[catalogue:check] missing ${CATALOGUE_PATH}: ${(e as Error).message}`);
    console.error('Run `pnpm catalogue:build` and commit the result.');
    process.exit(1);
  }
  if (actual !== expected) {
    console.error('[catalogue:check] static-action-catalogue.json is out of date.');
    console.error('Run `pnpm catalogue:build` and commit the result.');
    process.exit(1);
  }
  console.log('[catalogue:check] OK — catalogue matches @flowlib/actions');
}

main();
