// spec: Cross-platform API parity — NestJS adapter
//
// Validates that the NestJS adapter (@flowlib/nestjs) exposes the full
// Flowlib API contract.  Each worker gets its own isolated NestJS server
// with a disposable SQLite database, so these tests run fully in parallel.

import { nestjsTest as test, expect } from './platform-fixtures';
import { runApiContract, cleanupTestData } from './shared-api-contract';

test.describe('NestJS API Parity', () => {
  test.afterAll(async ({ request, isolatedServer }) => {
    await cleanupTestData(request, isolatedServer.apiBase);
  });

  test('core CRUD contract matches shared specification', async ({ request, isolatedServer }) => {
    await runApiContract(request, isolatedServer.apiBase);
  });

  test('GET /credentials lists credentials', async ({ request, isolatedServer }) => {
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

  test('GET /flows returns flows via NestJS GET endpoint', async ({ request, isolatedServer }) => {
    const res = await request.get(`${isolatedServer.apiBase}/flows`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});
