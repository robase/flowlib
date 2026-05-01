#!/usr/bin/env node
/**
 * Generate a changeset from the current PR's title + diff.
 *
 * Inputs (env):
 *   PR_NUMBER  — pull_request.number
 *   PR_TITLE   — pull_request.title (conventional commit format expected)
 *   PR_BASE    — pull_request.base.ref (e.g. "main")
 *
 * Outputs (GITHUB_OUTPUT):
 *   changed=true|false  — whether `.changeset/pr-<N>.md` was written or
 *                          updated. The workflow uses this to decide
 *                          whether to commit + push.
 *   reason=<string>     — present when changed=false; explains the skip.
 *
 * Mapping (conventional commit prefix → bump):
 *   feat!: / fix!: / *!: / "BREAKING CHANGE" → major
 *   feat:                                     → minor
 *   fix: / perf: / revert:                    → patch
 *   chore: / docs: / style: / refactor: /
 *   test: / ci: / build:                      → no changeset
 *
 * Affected packages: every workspace package whose directory contains a
 * file changed by this PR. Read package.json `name` to drive the changeset
 * frontmatter.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { glob } from 'node:fs/promises';

const PR_NUMBER = mustEnv('PR_NUMBER');
const PR_TITLE = mustEnv('PR_TITLE').trim();
const PR_BASE = mustEnv('PR_BASE');
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

const SKIP_PREFIXES = new Set(['chore', 'docs', 'style', 'refactor', 'test', 'ci', 'build']);
const PATCH_PREFIXES = new Set(['fix', 'perf', 'revert']);
const MINOR_PREFIXES = new Set(['feat']);

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});

async function main() {
  // 1. Bump from title
  const parsed = parseConventionalTitle(PR_TITLE);
  if (!parsed) {
    return skip(`PR title does not match conventional-commit format: "${PR_TITLE}"`);
  }
  if (parsed.bump === 'none') {
    return skip(`Type "${parsed.type}" is non-versioning — no changeset.`);
  }

  // 2. Diff against base to find affected files. Fetch base first because
  //    `actions/checkout@v6` only fetches the PR head ref by default.
  execSync(`git fetch --no-tags --depth=200 origin ${PR_BASE}`, {
    stdio: 'inherit',
  });
  const changedFiles = execSync(`git diff --name-only origin/${PR_BASE}...HEAD`, {
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return skip('No file changes in PR.');
  }

  // 3. Map files → owning workspace packages by walking package.json files.
  const packages = await loadWorkspacePackages();
  const affected = new Set();
  for (const file of changedFiles) {
    for (const pkg of packages) {
      if (file === pkg.relPkgJson || file.startsWith(pkg.relDir + sep)) {
        affected.add(pkg.name);
        break;
      }
    }
  }
  if (affected.size === 0) {
    return skip('No workspace packages affected — only root/config/docs files changed.');
  }

  // 4. Render changeset and decide whether to write.
  const target = `.changeset/pr-${PR_NUMBER}.md`;
  const body = renderChangeset([...affected].sort(), parsed.bump, PR_TITLE, PR_NUMBER);

  if (existsSync(target) && readFileSync(target, 'utf8') === body) {
    return skip('Changeset already up-to-date — nothing to commit.');
  }

  writeFileSync(target, body);
  console.log(`Wrote ${target} with ${affected.size} package(s) at ${parsed.bump} bump.`);
  setOutput('changed', 'true');
}

function parseConventionalTitle(title) {
  // Accept: "type: subject", "type(scope): subject", "type!: subject",
  // "type(scope)!: subject". Parsed without a regex to keep the matcher
  // linear-time and avoid oxlint security/detect-unsafe-regex warnings.
  const trimmed = title.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    return null;
  }
  const subject = trimmed.slice(colonIdx + 1).trim();
  if (!subject) {
    return null;
  }

  let prefix = trimmed.slice(0, colonIdx);
  let breaking = false;
  if (prefix.endsWith('!')) {
    breaking = true;
    prefix = prefix.slice(0, -1);
  }
  const parenIdx = prefix.indexOf('(');
  if (parenIdx !== -1) {
    if (!prefix.endsWith(')')) {
      return null;
    }
    prefix = prefix.slice(0, parenIdx);
  }
  if (prefix.length === 0 || !isAlpha(prefix)) {
    return null;
  }
  const type = prefix.toLowerCase();

  if (breaking || title.includes('BREAKING CHANGE')) {
    return { type, bump: 'major' };
  }
  if (SKIP_PREFIXES.has(type)) {
    return { type, bump: 'none' };
  }
  if (PATCH_PREFIXES.has(type)) {
    return { type, bump: 'patch' };
  }
  if (MINOR_PREFIXES.has(type)) {
    return { type, bump: 'minor' };
  }
  // Unknown type — be conservative and skip rather than mis-bump.
  return { type, bump: 'none' };
}

function isAlpha(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      return false;
    }
  }
  return true;
}

async function loadWorkspacePackages() {
  // Mirrors pnpm-workspace.yaml. Examples are listed but every example
  // package is `private: true` so they're skipped at the JSON-read step.
  const patterns = ['pkg/*/package.json', 'pkg/plugins/*/package.json', 'examples/*/package.json'];
  const ignored = readIgnoreList();
  const out = [];
  for (const pattern of patterns) {
    for await (const file of glob(pattern)) {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      if (!json.name || json.private === true) {
        continue;
      }
      if (ignored.has(json.name)) {
        continue;
      }
      out.push({
        name: json.name,
        relPkgJson: file,
        relDir: dirname(file),
      });
    }
  }
  return out;
}

function readIgnoreList() {
  try {
    const cfg = JSON.parse(readFileSync('.changeset/config.json', 'utf8'));
    return new Set(cfg.ignore ?? []);
  } catch {
    return new Set();
  }
}

function renderChangeset(packageNames, bump, title, prNumber) {
  const lines = ['---'];
  for (const name of packageNames) {
    lines.push(`'${name}': ${bump}`);
  }
  lines.push('---', '', `${title} (#${prNumber})`, '');
  return lines.join('\n');
}

function skip(reason) {
  console.log(`SKIP: ${reason}`);
  setOutput('changed', 'false');
  setOutput('reason', reason);
}

function setOutput(key, value) {
  if (!GITHUB_OUTPUT) {
    console.log(`::set-output name=${key}::${value}`);
    return;
  }
  appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`);
}

function mustEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}
