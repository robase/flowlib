// spec: Cross-platform API parity — Next.js adapter
//
// Validates that the Next.js adapter (@flowlib/nextjs) exposes the full
// Invect API contract via the catch-all API route handler.
// Each worker gets its own isolated Next.js handler server with a
// disposable SQLite database, so these tests run fully in parallel.

import { nextjsTest as test, expect } from './platform-fixtures';
import { runApiContract, cleanupTestData } from './shared-api-contract';

test.describe('Next.js API Parity', () => {
  test.afterAll(async ({ request, isolatedServer }) => {
    await cleanupTestData(request, isolatedServer.apiBase);
  });

  test('core CRUD contract matches shared specification', async ({ request, isolatedServer }) => {
    await runApiContract(request, isolatedServer.apiBase);
  });

  test('GET /credentials lists credentials via Next.js route handler', async ({
    request,
    isolatedServer,
  }) => {
    const res = await request.get(`${isolatedServer.apiBase}/credentials`);
    expect(res.ok()).toBeTruthy();
    const creds = await res.json();
    expect(Array.isArray(creds)).toBeTruthy();
  });

  test('GET /agent/tools returns registered tools', async ({ request, isolatedServer }) => {
    const res = await request.get(`${isolatedServer.apiBase}/agent/tools`);
    expect(res.ok()).toBeTruthy();
    const tools = await res.json();
    expect(Array.isArray(tools)).toBeTruthy();
    expect(tools.length).toBeGreaterThan(0);
  });

  test('unknown route returns 404 with descriptive message', async ({
    request,
    isolatedServer,
  }) => {
    const res = await request.get(`${isolatedServer.apiBase}/this-route-does-not-exist`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'Not Found');
  });

  test('POST /node-config/update handles config updates', async ({ request, isolatedServer }) => {
    const res = await request.post(`${isolatedServer.apiBase}/node-config/update`, {
      data: {
        nodeType: 'INPUT',
        nodeId: 'test-node-1',
        params: {},
      },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
