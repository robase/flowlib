/**
 * Generic endpoint dispatcher: parse → authorize → handle → classify errors.
 *
 * Adapters call `runEndpoint(endpoint, request, { flowlib })` once they've
 * matched a path against the endpoint registry. Everything between parse and
 * the returned `FlowlibHttpResult` is shared:
 *
 *   - parser failures → `classifyHttpError` (so `ZodError` → 400 with a
 *     `details` array, `ValidationError` → 400, etc.)
 *   - auth failures → 401 (no identity) / 403 (identity but no permission)
 *   - handler failures → `classifyHttpError`
 *
 * Adapters retain responsibility for matching path + method (their host
 * router does that for them) and for translating the returned
 * `FlowlibHttpResult` into the framework's native response.
 */

import type { FlowlibInstance } from '@flowlib/core';
import { classifyHttpError } from '../errors';
import type { FlowlibHttpRequest, FlowlibHttpResult } from '../types';
import type { FlowlibHttpEndpoint } from './types';

export interface RunEndpointInput {
  flowlib: FlowlibInstance;
  /**
   * The matched endpoint's path-params (e.g. `{ flowRunId: 'abc' }`). The
   * adapter's router has already extracted these. They override
   * `request.params` (which is otherwise often empty for adapters that don't
   * pre-populate it).
   */
  params?: Record<string, string>;
}

export async function runEndpoint<Parsed>(
  endpoint: FlowlibHttpEndpoint<Parsed>,
  request: FlowlibHttpRequest,
  input: RunEndpointInput,
): Promise<FlowlibHttpResult> {
  const { flowlib, params } = input;

  const requestWithParams: FlowlibHttpRequest = params ? { ...request, params } : request;

  // 1. Auth gate. Public endpoints skip straight to the handler.
  if (endpoint.auth.kind === 'protected') {
    const identity = requestWithParams.identity ?? null;
    const resource = endpoint.auth.getResource?.(requestWithParams);
    const result = await flowlib.auth.authorize({
      identity,
      action: endpoint.auth.permission,
      resource: resource?.id ? { type: resource.type, id: resource.id } : undefined,
    });
    if (!result.allowed) {
      return {
        kind: 'json',
        status: identity ? 403 : 401,
        body: {
          error: identity ? 'Forbidden' : 'Unauthorized',
          message: result.reason ?? `Missing permission: ${endpoint.auth.permission}`,
        },
      };
    }
  }

  // 2. Parse. A parser throw is a normal error — let `classifyHttpError`
  //    convert it (ZodError → 400 with details, ValidationError → 400, etc.)
  let parsed: Parsed;
  try {
    parsed = endpoint.parse ? await endpoint.parse(requestWithParams) : (undefined as Parsed);
  } catch (error) {
    return resultFromClassified(error);
  }

  // 3. Handle. Same classification on throw.
  try {
    return await endpoint.handle({ flowlib, request: requestWithParams, parsed });
  } catch (error) {
    return resultFromClassified(error);
  }
}

function resultFromClassified(error: unknown): FlowlibHttpResult {
  const { status, body } = classifyHttpError(error);
  return { kind: 'json', status, body };
}
