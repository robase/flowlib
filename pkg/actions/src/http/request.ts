/**
 * http.request — HTTP Request action
 *
 * Makes HTTP requests to external APIs.
 * Supports authentication via credentials (Bearer, Basic, API Key).
 */

import { defineAction } from '@flowlib/action-kit';
import { HTTP_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import type { ActionCredential } from '@flowlib/action-kit';

const paramsSchema = z.object({
  url: z.string().min(1, 'URL is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.string().optional().default(''),
  credentialId: z.string().optional(),
  timeout: z.number().positive().optional().default(30000),
});

function buildAuthHeader(
  authType: string,
  config: Record<string, unknown>,
): Record<string, string> {
  switch (authType) {
    case 'bearer':
      if (config.token && typeof config.token === 'string') {
        return { Authorization: `Bearer ${config.token}` };
      }
      break;
    case 'oauth2':
      if (config.accessToken && typeof config.accessToken === 'string') {
        return { Authorization: `Bearer ${config.accessToken}` };
      }
      break;
    case 'basic':
      if (typeof config.username === 'string' && typeof config.password === 'string') {
        const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      break;
    case 'apiKey':
      if (typeof config.apiKey === 'string' && config.location === 'header') {
        const paramName = (config.paramName as string) || 'X-API-Key';
        return { [paramName]: config.apiKey };
      }
      break;
    case 'custom':
      if (config.headers && typeof config.headers === 'object') {
        return config.headers as Record<string, string>;
      }
      break;
  }
  return {};
}

export const httpRequestAction = defineAction({
  id: 'http.request',
  name: 'HTTP Request',
  description:
    'Make an HTTP request to any URL (GET, POST, PUT, PATCH, DELETE). Use when the user needs to call an external REST API, fetch a webpage, submit a form, or trigger a webhook. Call with `url` and `method`; optionally provide `body` (JSON string — ignored for GET), `headers` (key-value object), and a credential for auth (supports Bearer token, Basic, API Key, OAuth2, or custom header auth).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": {"id": 1, "name": "Example"}, "status": 200, "headers": {"content-type": "application/json"}, "ok": true}\n' +
    '```',
  provider: HTTP_PROVIDER,

  credential: {
    required: false,
    type: 'api_key',
    description: 'Optional authentication credential (Bearer, Basic, API Key)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        description: 'HTTP method to use for the request',
        required: true,
        defaultValue: 'GET',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' },
        ],
        aiProvided: true,
      },
      {
        name: 'url',
        label: 'URL',
        type: 'text',
        description: 'Full URL to send the request to (including https://)',
        required: true,
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        description: 'Request body (JSON or text). Ignored for GET requests.',
        aiProvided: true,
      },
      {
        name: 'headers',
        label: 'Headers',
        type: 'json',
        description: 'Request headers as key-value pairs',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'credentialId',
        label: 'Credential',
        type: 'text',
        description: 'Authentication credential',
        aiProvided: false,
      },
      {
        name: 'timeout',
        label: 'Timeout (ms)',
        type: 'number',
        defaultValue: 30000,
        description: 'Request timeout in milliseconds',
        extended: true,
        aiProvided: false,
      },
    ],
  },

  tags: [
    'api',
    'http',
    'fetch',
    'rest',
    'request',
    'url',
    'endpoint',
    'webhook',
    'get',
    'post',
    'call',
    'web',
  ],

  async execute(params, context) {
    const { url, method, body, timeout } = params;

    // Validate URL
    try {
      new URL(url);
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }

    // Build headers — start with user headers
    let headers: Record<string, string> = { ...params.headers };

    // Add auth from credential if present
    let credential: ActionCredential | null = context.credential;
    if (!credential && params.credentialId && context.functions?.getCredential) {
      credential = await context.functions.getCredential(params.credentialId);
    }
    if (credential) {
      const authHeaders = buildAuthHeader(credential.authType, credential.config);
      headers = { ...authHeaders, ...headers }; // user headers override auth
    }

    // Auto-detect Content-Type
    if (body && !headers['Content-Type'] && !headers['content-type']) {
      try {
        JSON.parse(body);
        headers['Content-Type'] = 'application/json';
      } catch {
        headers['Content-Type'] = 'text/plain';
      }
    }

    context.logger.debug('Executing HTTP request', { method, url, hasCredential: !!credential });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const signals: AbortSignal[] = [controller.signal];
    if (context.abortSignal) {
      signals.push(context.abortSignal);
    }
    const signal = signals.length > 1 ? AbortSignal.any(signals) : controller.signal;

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal,
      };

      if (body && method !== 'GET') {
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Read the body once as text so we can safely fall back when a server
      // advertises Content-Type: application/json but sends a non-JSON payload.
      const rawText = await response.text();
      const contentType = response.headers.get('content-type') || '';

      let responseData: unknown = rawText;
      if (contentType.includes('application/json') && rawText.length > 0) {
        try {
          responseData = JSON.parse(rawText);
        } catch {
          responseData = rawText;
        }
      }

      return {
        success: true,
        output: {
          data: responseData,
          status: response.status,
          headers: responseHeaders,
          ok: response.ok,
        },
        metadata: {
          method,
          url,
          statusCode: response.status,
          hasAuth: !!credential,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        if (controller.signal.aborted) {
          return { success: false, error: `Request timed out after ${timeout}ms` };
        }
        return { success: false, error: 'HTTP request cancelled' };
      }

      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `HTTP request failed: ${msg}` };
    }
  },
});
