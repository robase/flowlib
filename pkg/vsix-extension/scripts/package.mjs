#!/usr/bin/env node
/**
 * Builds the .vsix.
 *
 * The npm package name is `@flowlib/vsix` (scoped — keeps the workspace
 * `@flowlib/*` convention). vsce rejects scoped names in `package.json`,
 * so we temporarily swap the manifest to an unscoped variant for the
 * duration of `vsce package`, then restore the original. We also stage
 * the repo's root LICENSE into the package dir so the Marketplace
 * listing shows it. Both swaps are undone on success, failure, or
 * Ctrl-C / unexpected exit.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const manifestPath = resolve(pkgRoot, 'package.json');
const backupPath = resolve(pkgRoot, 'package.json.vsce-backup');
const stagedLicensePath = resolve(pkgRoot, 'LICENSE');
const repoLicensePath = resolve(pkgRoot, '..', '..', 'LICENSE');

const PUBLISHED_NAME = 'flowlib-vsix';
const VSIX_OUT = resolve(pkgRoot, 'flowlib-vsix.vsix');

let stagedLicense = false;

function restore() {
  if (existsSync(backupPath)) {
    renameSync(backupPath, manifestPath);
  }
  // Only delete the LICENSE if we staged it — never touch one that
  // already existed before we ran.
  if (stagedLicense && existsSync(stagedLicensePath)) {
    unlinkSync(stagedLicensePath);
  }
}

process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

const original = readFileSync(manifestPath, 'utf-8');
copyFileSync(manifestPath, backupPath);

if (!existsSync(stagedLicensePath) && existsSync(repoLicensePath)) {
  copyFileSync(repoLicensePath, stagedLicensePath);
  stagedLicense = true;
}

try {
  const manifest = JSON.parse(original);
  manifest.name = PUBLISHED_NAME;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // `--no-dependencies` would skip shipping node_modules. We need
  // `better-sqlite3` and its `bindings` helper present at runtime since they
  // can't be bundled (native `.node` binary). `.vscodeignore` un-ignores
  // exactly those package dirs and excludes everything else.
  const result = spawnSync('pnpm', ['exec', 'vsce', 'package', '--out', VSIX_OUT], {
    cwd: pkgRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  restore();
}
