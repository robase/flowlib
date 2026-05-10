/**
 * Settings endpoint slice.
 *
 *   GET    /settings/descriptors    — plugin-contributed UI metadata
 *   GET    /settings                — list all records (encrypted values masked)
 *   GET    /settings/:key           — single record (encrypted value masked)
 *   PUT    /settings/:key           — upsert
 *   DELETE /settings/:key           — remove
 *
 * Auth: `admin:*` — settings drive backend behavior, so reads and writes
 * are gated to admins. Plugins that need a more permissive read surface
 * for non-secret config can call `flowlib.settings.get(key)` directly
 * from one of their own endpoints (which can declare a different
 * permission).
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const listDescriptors = defineEndpoint({
  id: 'settings.descriptors',
  method: 'GET',
  path: '/settings/descriptors',
  auth: { kind: 'protected', permission: 'admin:*' },
  async handle({ flowlib }) {
    return {
      kind: 'json',
      status: 200,
      body: { groups: flowlib.settings.getDescriptors() },
    };
  },
});

const listSettings = defineEndpoint({
  id: 'settings.list',
  method: 'GET',
  path: '/settings',
  auth: { kind: 'protected', permission: 'admin:*' },
  async handle({ flowlib, request }) {
    const namespace = request.searchParams.get('namespace') ?? undefined;
    return {
      kind: 'json',
      status: 200,
      body: {
        settings: await flowlib.settings.list(namespace ? { namespace } : undefined),
      },
    };
  },
});

const getSetting = defineEndpoint({
  id: 'settings.get',
  method: 'GET',
  path: '/settings/:key',
  auth: { kind: 'protected', permission: 'admin:*' },
  async handle({ flowlib, request }) {
    const record = await flowlib.settings.getSanitized(request.params.key);
    if (!record) {
      return { kind: 'json', status: 404, body: { error: 'Setting not found' } };
    }
    return { kind: 'json', status: 200, body: record };
  },
});

const setSetting = defineEndpoint({
  id: 'settings.set',
  method: 'PUT',
  path: '/settings/:key',
  auth: { kind: 'protected', permission: 'admin:*' },
  async handle({ flowlib, request }) {
    const body = (request.body ?? {}) as {
      value?: unknown;
      encrypted?: boolean;
    };
    const record = await flowlib.settings.set({
      key: request.params.key,
      value: body.value ?? null,
      encrypted: body.encrypted === true,
      updatedBy: request.identity?.id ?? null,
    });
    return { kind: 'json', status: 200, body: record };
  },
});

const deleteSetting = defineEndpoint({
  id: 'settings.delete',
  method: 'DELETE',
  path: '/settings/:key',
  auth: { kind: 'protected', permission: 'admin:*' },
  async handle({ flowlib, request }) {
    const removed = await flowlib.settings.delete(request.params.key, request.identity?.id ?? null);
    return {
      kind: 'json',
      status: removed ? 200 : 404,
      body: { removed },
    };
  },
});

export const settingsEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  // Descriptors first — `/settings/descriptors` must match before the
  // generic `/settings/:key` pattern.
  listDescriptors,
  listSettings,
  getSetting,
  setSetting,
  deleteSetting,
] as readonly FlowlibHttpEndpoint<unknown>[];
