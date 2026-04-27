/**
 * HTTP request node helper.
 *
 * `http.request` — make an outbound HTTP call with configurable method,
 * headers, body, and optional credential-bound auth.
 *
 * Two call forms:
 *   - `httpRequest({ url, method? })` — named-record `defineFlow` form.
 *   - `httpRequest('ref', { url, method? })` — positional form.
 */

import { httpRequestAction } from '@flowlib/actions/http';
import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';

export interface HttpRequestParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  credentialId?: string;
  timeout?: number;
}

export function httpRequest(params: HttpRequestParams, options?: NodeOptions): SdkFlowNode;
export function httpRequest(
  referenceId: string,
  params: HttpRequestParams,
  options?: NodeOptions,
): SdkFlowNode;
export function httpRequest(
  arg0: string | HttpRequestParams,
  arg1?: HttpRequestParams | NodeOptions,
  arg2?: NodeOptions,
): SdkFlowNode {
  const referenceId = typeof arg0 === 'string' ? arg0 : '';
  const params = (typeof arg0 === 'string' ? arg1 : arg0) as HttpRequestParams;
  const options = (typeof arg0 === 'string' ? arg2 : arg1) as NodeOptions | undefined;

  return httpRequestAction(
    referenceId,
    {
      url: params.url,
      method: params.method ?? 'GET',
      headers: params.headers ?? {},
      body: params.body ?? '',
      credentialId: params.credentialId,
      timeout: params.timeout ?? 30000,
    },
    options,
  );
}
