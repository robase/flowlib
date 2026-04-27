// spec: Cross-platform API parity — Express adapter
//
// Validates that the Express adapter (@flowlib/express) exposes the full
// Flowlib API contract.  Each worker gets its own isolated Express server
// with a disposable SQLite database, so these tests run fully in parallel.

import { test, expect } from './platform-fixtures';
import { runApiContract, cleanupTestData } from './shared-api-contract';

test.describe('Express API Parity', () => {
  test.afterAll(async ({ request, isolatedServer }) => {
    await cleanupTestData(request, isolatedServer.apiBase);
  });

  test('core CRUD contract matches shared specification', async ({ request, isolatedServer }) => {
    await runApiContract(request, isolatedServer.apiBase);
  });

  test('GET /dashboard/stats returns statistics', async ({ request, isolatedServer }) => {
    const res = await request.get(`${isolatedServer.apiBase}/dashboard/stats`);
    expect(res.ok()).toBeTruthy();
    const stats = await res.json();
    expect(stats).toHaveProperty('totalFlows');
  });

  test('GET /nodes returns node definitions', async ({ request, isolatedServer }) => {
    const res = await request.get(`${isolatedServer.apiBase}/nodes`);
    expect(res.ok()).toBeTruthy();
    const nodes = await res.json();
    expect(Array.isArray(nodes)).toBeTruthy();
    expect(nodes.length).toBeGreaterThan(0);
  });

  test('health check returns ok', async ({ request, isolatedServer }) => {
    const res = await request.get(`${isolatedServer.serverUrl}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('webhooks CRUD and ingestion smoke path works', async ({ request, isolatedServer }) => {
    const createRes = await request.post(`${isolatedServer.apiBase}/plugins/webhooks/triggers`, {
      data: {
        name: 'Platform Webhook Trigger',
        description: 'Auto-created by Express smoke test',
        provider: 'generic',
        allowedMethods: 'POST',
      },
    });

    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created).toHaveProperty('webhookPath');
    expect(created.name).toBe('Platform Webhook Trigger');

    const triggerId = created.id as string;
    const webhookPath = created.webhookPath as string;

    const listRes = await request.get(`${isolatedServer.apiBase}/plugins/webhooks/triggers`);
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.data)).toBeTruthy();
    expect(listBody.data.some((item: { id: string }) => item.id === triggerId)).toBeTruthy();

    const updateRes = await request.put(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}`,
      {
        data: {
          description: 'Updated by smoke test',
          allowedMethods: 'ANY',
        },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.description).toBe('Updated by smoke test');
    expect(updated.allowedMethods).toBe('ANY');

    const infoRes = await request.get(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}/info`,
    );
    expect(infoRes.ok()).toBeTruthy();
    const info = await infoRes.json();
    expect(info.webhookPath).toBe(webhookPath);

    const receivePayload = { event: 'platform-test', ok: true };
    const receiveRes = await request.post(
      `${isolatedServer.apiBase}/plugins/webhooks/receive/${webhookPath}`,
      {
        data: receivePayload,
      },
    );
    expect(receiveRes.ok()).toBeTruthy();
    const received = await receiveRes.json();
    expect(received.status).toBe('received');
    expect(received.webhookTriggerId).toBe(triggerId);

    const getRes = await request.get(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}`,
    );
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();
    expect(fetched.triggerCount).toBeGreaterThanOrEqual(1);
    expect(fetched.lastPayload).toEqual(receivePayload);

    const testRes = await request.post(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}/test`,
      {
        data: { via: 'test-endpoint' },
      },
    );
    expect(testRes.ok()).toBeTruthy();
    const testBody = await testRes.json();
    expect(testBody.status).toBe('test_received');

    const deleteRes = await request.delete(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}`,
    );
    expect(deleteRes.ok()).toBeTruthy();

    const getDeletedRes = await request.get(
      `${isolatedServer.apiBase}/plugins/webhooks/triggers/${triggerId}`,
    );
    expect(getDeletedRes.status()).toBe(404);
  });
});
