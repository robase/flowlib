#!/usr/bin/env node
/**
 * Builds the .vsix.
 *
 * The npm package name is `@flowlib/vscode` (scoped — required for the pnpm
 * workspace dependency graph). vsce rejects scoped names in `package.json`,
 * so we temporarily swap the manifest to an unscoped variant for the
 * duration of `vsce package`, then restore the original. The original
 * manifest is also restored on Ctrl-C / unexpected exit.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const manifestPath = resolve(pkgRoot, 'package.json');
const backupPath = resolve(pkgRoot, 'package.json.vsce-backup');

const PUBLISHED_NAME = 'flowlib-vscode';
const VSIX_OUT = resolve(pkgRoot, 'flowlib-vscode.vsix');

function restoreManifest() {
  if (existsSync(backupPath)) {
    renameSync(backupPath, manifestPath);
  }
}

process.on('SIGINT', () => {
  restoreManifest();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restoreManifest();
  process.exit(143);
});

const original = readFileSync(manifestPath, 'utf-8');
copyFileSync(manifestPath, backupPath);

try {
  const manifest = JSON.parse(original);
  manifest.name = PUBLISHED_NAME;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const result = spawnSync(
    'pnpm',
    ['exec', 'vsce', 'package', '--no-dependencies', '--out', VSIX_OUT],
    { cwd: pkgRoot, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  restoreManifest();
}
