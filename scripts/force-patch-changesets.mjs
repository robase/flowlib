#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHANGESET_DIR = '.changeset';

const files = readdirSync(CHANGESET_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');

let downgraded = 0;

for (const file of files) {
  const path = join(CHANGESET_DIR, file);
  const content = readFileSync(path, 'utf8');

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    continue;
  }

  const [fullMatch, frontmatter] = match;
  const rewritten = frontmatter.replace(
    /^("[^"]+"|[^:\n]+):\s*(minor|major)\s*$/gm,
    (_line, pkg) => `${pkg}: patch`,
  );

  if (rewritten === frontmatter) {
    continue;
  }

  const next = content.replace(fullMatch, `---\n${rewritten}\n---`);
  writeFileSync(path, next);
  downgraded += 1;
  console.log(`[force-patch-changesets] downgraded ${file} to patch`);
}

if (downgraded === 0) {
  console.log('[force-patch-changesets] no minor/major bumps found');
}
