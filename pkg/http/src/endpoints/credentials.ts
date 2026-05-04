/**
 * Credentials endpoint slice.
 *
 *   POST   /credentials
 *   GET    /credentials              — filtered list
 *   GET    /credentials/expiring     — must come before /credentials/:id
 *   GET    /credentials/:id
 *   PUT    /credentials/:id
 *   DELETE /credentials/:id
 *   POST   /credentials/:id/test
 *   POST   /credentials/:id/track-usage
 *   POST   /credentials/:id/refresh
 *   POST   /credentials/test-request — proxy with SSRF guards
 */

import type {
  CreateCredentialInput,
  CredentialFilters,
  UpdateCredentialInput,
} from '@flowlib/core';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const credentialResource = (id: string) => ({ type: 'credential' as const, id });

const createCredential = defineEndpoint({
  id: 'credentials.create',
  method: 'POST',
  path: '/credentials',
  auth: { kind: 'protected', permission: 'credential:create' },
  async handle({ flowlib, request }) {
    const body = (request.body ?? {}) as CreateCredentialInput & { userId?: string };
    const headerUserId = request.headers['x-user-id'];
    const resolvedUserId =
      request.identity?.id ||
      body.userId ||
      (typeof headerUserId === 'string' ? headerUserId : undefined) ||
      'anonymous';
    // `userId` isn't part of `CreateCredentialInput`'s type, but the
    // previous Express adapter passed it through. Preserve the field via
    // a cast so any downstream consumer that still reads it keeps working.
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.credentials.create({
        ...body,
        userId: resolvedUserId,
      } as CreateCredentialInput),
    };
  },
});

const listCredentials = defineEndpoint({
  id: 'credentials.list',
  method: 'GET',
  path: '/credentials',
  auth: { kind: 'protected', permission: 'credential:read' },
  async handle({ flowlib, request }) {
    const sp = request.searchParams;
    const isActiveRaw = sp.get('isActive');
    const filters: CredentialFilters = {
      type: (sp.get('type') as CredentialFilters['type'] | null) ?? undefined,
      authType: (sp.get('authType') as CredentialFilters['authType'] | null) ?? undefined,
      isActive: isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined,
    };
    return { kind: 'json', status: 200, body: await flowlib.credentials.list(filters) };
  },
});

const getExpiring = defineEndpoint({
  id: 'credentials.expiring',
  method: 'GET',
  path: '/credentials/expiring',
  auth: { kind: 'protected', permission: 'credential:read' },
  async handle({ flowlib, request }) {
    const days = request.searchParams.get('daysUntilExpiry');
    const daysUntilExpiry = days ? parseInt(days, 10) : 7;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.getExpiring(daysUntilExpiry),
    };
  },
});

const getCredential = defineEndpoint({
  id: 'credentials.get',
  method: 'GET',
  path: '/credentials/:id',
  auth: {
    kind: 'protected',
    permission: 'credential:read',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.getSanitized(request.params.id),
    };
  },
});

const updateCredential = defineEndpoint({
  id: 'credentials.update',
  method: 'PUT',
  path: '/credentials/:id',
  auth: {
    kind: 'protected',
    permission: 'credential:update',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.update(
        request.params.id,
        (request.body ?? {}) as UpdateCredentialInput,
      ),
    };
  },
});

const deleteCredential = defineEndpoint({
  id: 'credentials.delete',
  method: 'DELETE',
  path: '/credentials/:id',
  auth: {
    kind: 'protected',
    permission: 'credential:delete',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    await flowlib.credentials.delete(request.params.id);
    return { kind: 'json', status: 204, body: null };
  },
});

const testCredential = defineEndpoint({
  id: 'credentials.test',
  method: 'POST',
  path: '/credentials/:id/test',
  auth: {
    kind: 'protected',
    permission: 'credential:read',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.test(request.params.id),
    };
  },
});

const trackUsage = defineEndpoint({
  id: 'credentials.trackUsage',
  method: 'POST',
  path: '/credentials/:id/track-usage',
  auth: {
    kind: 'protected',
    permission: 'credential:read',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    await flowlib.credentials.updateLastUsed(request.params.id);
    return { kind: 'json', status: 204, body: null };
  },
});

const refreshCredential = defineEndpoint({
  id: 'credentials.refresh',
  method: 'POST',
  path: '/credentials/:id/refresh',
  auth: {
    kind: 'protected',
    permission: 'credential:update',
    getResource: (request) => credentialResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.refreshOAuth2Credential(request.params.id),
    };
  },
});

/**
 * Proxy an HTTP request for credential testing without browser CORS.
 *
 * SSRF mitigations: protocol allowlist (http/https), DNS lookup of the
 * hostname with private/internal IP rejection, redirect: 'error'.
 */
const testRequest = defineEndpoint({
  id: 'credentials.testRequest',
  method: 'POST',
  path: '/credentials/test-request',
  auth: { kind: 'protected', permission: 'credential:read' },
  async handle({ request }) {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
    } = (request.body ?? {}) as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    if (!url) {
      return { kind: 'json', status: 400, body: { error: 'URL is required' } };
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { kind: 'json', status: 400, body: { error: 'Invalid URL' } };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Only HTTP and HTTPS protocols are allowed' },
      };
    }
    const { promises: dns } = await import('node:dns');
    let resolvedIps: string[];
    try {
      const results = await dns.lookup(parsedUrl.hostname, { all: true });
      resolvedIps = results.map((r) => r.address);
    } catch {
      return { kind: 'json', status: 400, body: { error: 'Could not resolve hostname' } };
    }
    const { isIP } = await import('node:net');
    for (const ip of resolvedIps) {
      const version = isIP(ip);
      if (version === 4) {
        const parts = ip.split('.').map(Number);
        if (
          parts[0] === 127 ||
          parts[0] === 10 ||
          parts[0] === 0 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) ||
          (parts[0] === 169 && parts[1] === 254)
        ) {
          return {
            kind: 'json',
            status: 400,
            body: { error: 'Requests to private/internal network addresses are not allowed' },
          };
        }
      } else if (version === 6) {
        const lower = ip.toLowerCase();
        if (
          lower === '::1' ||
          lower.startsWith('fe80') ||
          lower.startsWith('fc') ||
          lower.startsWith('fd') ||
          lower.startsWith('::ffff:')
        ) {
          return {
            kind: 'json',
            status: 400,
            body: { error: 'Requests to private/internal network addresses are not allowed' },
          };
        }
      }
    }
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: headers as Record<string, string>,
        redirect: 'error',
      };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      // codeql[js/request-forgery] SSRF mitigated — see checks above.
      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
      return {
        kind: 'json',
        status: 200,
        body: {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          body: responseBody,
        },
      };
    } catch (error) {
      return {
        kind: 'json',
        status: 500,
        body: {
          error: 'Request failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
});

export const credentialsEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  // More specific paths first
  testRequest,
  getExpiring,
  createCredential,
  listCredentials,
  testCredential,
  trackUsage,
  refreshCredential,
  getCredential,
  updateCredential,
  deleteCredential,
] as readonly FlowlibHttpEndpoint<unknown>[];
