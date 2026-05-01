import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Workspace root — the directory containing pnpm-workspace.yaml. From
// pkg/docs that's two levels up. Turbopack/Next resolve `next/package.json`
// from this root; pnpm hoists `next` to `<repo>/node_modules/next`, not to
// `pkg/node_modules/next`, so pointing `root` at `pkg/` makes Next 16
// fail with "couldn't find the Next.js package".
const monorepoRoot = resolve(__dirname, '../..');

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  basePath: process.env.DOCS_BASE_PATH || '',
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  transpilePackages: ['@flowlib/ui', '@flowlib/core'],
};

export default withMDX(config);
