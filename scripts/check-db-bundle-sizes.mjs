#!/usr/bin/env node
// =============================================================================
// CI guard for `@flowlib/db` dialect bundle sizes.
//
// The whole point of `@flowlib/db` is that consumers like Cloudflare Workers
// can import dialect schemas (`@flowlib/db/sqlite` etc.) without dragging in
// `@flowlib/core`. If someone re-introduces a heavy import (an AI SDK, a
// service module, a Zod schema with side effects), the dialect bundles get
// bloated and the package fails its purpose.
//
// This script runs after `pnpm build` and asserts each dialect ESM bundle is
// under a generous threshold. Today these bundles are ~2 KB gzip — the
// threshold is intentionally loose (100 KB gzip) so it only catches genuine
// regressions, not rounding noise. Tighten over time if desired.
//
// See: plans/db-package-split-plan.md, Path A step 3.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const distDir = resolve(repoRoot, 'pkg/db/dist');

// Per-bundle thresholds. Values are gzipped sizes in bytes. The dialect
// subpaths are the consumer-facing surfaces and must stay tiny. The
// aggregate `index.mjs` is heavier because it bundles the schema-merger
// and generators — only the CLI consumes it, so the budget is larger.
const BUDGETS_KB_GZIP = {
  'schema-sqlite.mjs': 100,
  'schema-postgres.mjs': 100,
  'schema-mysql.mjs': 100,
  'index.mjs': 250,
};

if (!existsSync(distDir)) {
  console.error(
    `[check-db-bundle-sizes] ${distDir} does not exist. Run \`pnpm --filter @flowlib/db build\` first.`,
  );
  process.exit(2);
}

const failures = [];
const report = [];
for (const [file, budgetKb] of Object.entries(BUDGETS_KB_GZIP)) {
  const path = resolve(distDir, file);
  if (!existsSync(path)) {
    failures.push({ file, reason: 'missing from dist/' });
    continue;
  }
  const bytes = readFileSync(path);
  const gzipped = gzipSync(bytes).length;
  const gzippedKb = gzipped / 1024;
  const budgetBytes = budgetKb * 1024;
  const ratio = gzipped / budgetBytes;
  report.push({
    file,
    raw: bytes.length,
    gzipped,
    gzippedKb: gzippedKb.toFixed(2),
    budgetKb,
    over: gzipped > budgetBytes,
  });
  if (gzipped > budgetBytes) {
    failures.push({
      file,
      reason: `${gzippedKb.toFixed(2)} KB gzip exceeds budget of ${budgetKb} KB (${(ratio * 100).toFixed(0)}%)`,
    });
  }
}

// Always print the table so it's visible in CI logs even on success.
console.log('\n@flowlib/db bundle sizes (gzipped):');
console.log(
  '  ' + 'file'.padEnd(24) + 'raw'.padStart(10) + 'gzipped'.padStart(10) + 'budget'.padStart(10),
);
for (const r of report) {
  const flag = r.over ? '❌' : '✓';
  console.log(
    `  ${flag} ${r.file.padEnd(22)}${(r.raw + ' B').padStart(10)}${(r.gzippedKb + ' KB').padStart(10)}${(r.budgetKb + ' KB').padStart(10)}`,
  );
}

if (failures.length > 0) {
  console.error('\n[check-db-bundle-sizes] FAILED:');
  for (const f of failures) {
    console.error(`  - ${f.file}: ${f.reason}`);
  }
  console.error(
    '\nIf the size increase is intentional, raise the budget in scripts/check-db-bundle-sizes.mjs.',
  );
  console.error(
    "If it's accidental, check pkg/db/src/ for newly-added heavy imports (AI SDKs, services, Zod side effects).",
  );
  process.exit(1);
}

console.log('\n[check-db-bundle-sizes] OK — all dialect bundles within budget.');
