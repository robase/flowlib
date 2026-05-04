/**
 * Endpoint registry matcher.
 *
 * Walks a list of `FlowlibHttpEndpoint` records, returns the first one whose
 * method + path-pattern matches the request, plus the extracted path-params.
 * Used by adapters whose host router doesn't natively dispatch by path —
 * Next.js's catch-all handler is the primary consumer.
 *
 * Express doesn't need this: `mountFlowlibEndpoints` registers each endpoint
 * with the Express router and lets Express do the matching.
 *
 * Pattern syntax matches plugin-endpoints: `:param` captures one segment,
 * `*` captures the rest. Both produce capture groups in source order — see
 * `plugin-endpoints/match.ts` for the rationale.
 */

import type { FlowlibHttpMethod } from '../types';
import type { FlowlibHttpEndpoint } from './types';

export interface MatchedHttpEndpoint<Parsed = unknown> {
  endpoint: FlowlibHttpEndpoint<Parsed>;
  params: Record<string, string>;
}

export function matchHttpEndpoint(
  endpoints: readonly FlowlibHttpEndpoint<unknown>[],
  method: FlowlibHttpMethod,
  path: string,
): MatchedHttpEndpoint<unknown> | null {
  for (const endpoint of endpoints) {
    if (endpoint.method !== method) {
      continue;
    }
    const params = matchPath(endpoint.path, path);
    if (params !== null) {
      return { endpoint, params };
    }
  }
  return null;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const captureNames: Array<string | null> = [];
  // oxlint-disable-next-line security/detect-unsafe-regex
  const regexSource = pattern.replace(/(\*)|:([^/]+)/g, (_match, wildcard, paramName) => {
    if (wildcard) {
      captureNames.push(null);
      return '(.*)';
    }
    captureNames.push(paramName as string);
    return '([^/]+)';
  });
  // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern from registered endpoint paths
  const regex = new RegExp(`^${regexSource}$`);
  const match = regex.exec(path);
  if (!match) {
    return null;
  }
  const params: Record<string, string> = {};
  captureNames.forEach((name, i) => {
    if (name !== null) {
      params[name] = match[i + 1] ?? '';
    }
  });
  return params;
}
