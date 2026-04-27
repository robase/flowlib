import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteBrowserIsolationTest, expect } from '../../test-support/sqlite-isolation';

export { expect };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');
const sharedOrigin = new URL(process.env.NEXTJS_URL ?? 'http://localhost:43002').origin;

export const test = createSqliteBrowserIsolationTest({
  apiPrefix: '/api/flowlib',
  dbFilePrefix: 'flowlib-nextjs-frontend',
  readyPath: '/api/flowlib/credentials',
  serverCwd: rootDir,
  serverScript: path.join(rootDir, 'playwright/tests/platform/test-server-nextjs.ts'),
  sharedOrigin,
});
