/**
 * Integration tests: Credential lifecycle
 *
 * Tests creating, reading, updating, and deleting credentials through
 * the Flowlib core with real AES-256-GCM encryption and an in-memory
 * SQLite database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FlowlibInstance } from '../../../src/api/types';
import { createTestFlowlib } from '../helpers/test-flowlib';

describe('Credential Lifecycle', () => {
  let flowlib: FlowlibInstance;

  beforeAll(async () => {
    flowlib = await createTestFlowlib();
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  it('should create a credential and retrieve it with decrypted config', async () => {
    const created = await flowlib.credentials.create({
      name: 'Test API Key',
      type: 'http-api',
      authType: 'bearer',
      config: { token: 'sk-secret-12345' },
      description: 'Integration test credential',
    });

    expect(created).toBeDefined();
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Test API Key');

    const fetched = await flowlib.credentials.get(created.id);
    expect(fetched.config.token).toBe('sk-secret-12345');
  });

  it('should list credentials (config is excluded from list)', async () => {
    const name = `List-Cred-${Date.now()}`;
    await flowlib.credentials.create({
      name,
      type: 'http-api',
      authType: 'apiKey',
      config: { apiKey: 'key-value' },
    });

    const list = await flowlib.credentials.list();

    expect(list.some((c) => c.name === name)).toBe(true);
    // Config should be omitted from listing
    const match = list.find((c) => c.name === name);
    expect(match).toBeDefined();
    expect((match as Record<string, unknown>).config).toBeUndefined();
  });

  it('should update a credential', async () => {
    const created = await flowlib.credentials.create({
      name: 'Update Me',
      type: 'http-api',
      authType: 'bearer',
      config: { token: 'original-token' },
    });

    const updated = await flowlib.credentials.update(created.id, {
      name: 'Updated Name',
      config: { token: 'new-token' },
    });

    expect(updated.name).toBe('Updated Name');

    const fetched = await flowlib.credentials.get(created.id);
    expect(fetched.config.token).toBe('new-token');
  });

  it('should delete a credential', async () => {
    const created = await flowlib.credentials.create({
      name: 'Delete Me',
      type: 'http-api',
      authType: 'bearer',
      config: { token: 'doomed' },
    });

    await flowlib.credentials.delete(created.id);

    await expect(flowlib.credentials.get(created.id)).rejects.toThrow();
  });

  it('should handle OAuth2-style credential config roundtrip', async () => {
    const created = await flowlib.credentials.create({
      name: 'OAuth2 Cred',
      type: 'http-api',
      authType: 'oauth2',
      config: {
        accessToken: 'ya29.access',
        refreshToken: '1//refresh',
        tokenType: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        clientId: 'client-id.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-secret',
        expiresAt: '2026-01-01T00:00:00Z',
      },
    });

    const fetched = await flowlib.credentials.get(created.id);
    expect(fetched.config.accessToken).toBe('ya29.access');
    expect(fetched.config.refreshToken).toBe('1//refresh');
    expect(fetched.config.clientId).toBe('client-id.apps.googleusercontent.com');
    expect(fetched.config.clientSecret).toBe('GOCSPX-secret');
  });
});
