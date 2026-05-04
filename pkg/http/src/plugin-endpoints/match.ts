/**
 * Plugin endpoint route matching.
 *
 * The route format is shared across all three adapters:
 *   - `:param` matches a single path segment
 *   - `*` matches any sequence of segments (greedy)
 *
 * Same logic was duplicated in Express, NestJS, and Next.js. The match
 * helpers here own the regex compilation + capture-group extraction.
 */

import type { FlowlibHttpMethod } from '../types';

/**
 * Minimal subset of `FlowlibPluginEndpoint` (declared in `@flowlib/core`)
 * that the matcher needs. Re-declared locally so `@flowlib/http` doesn't
 * have to import the heavy core types just for this. Generic over the
 * endpoint shape so callers can pass a real `FlowlibPluginEndpoint`
 * without losing the handler signature.
 */
export interface PluginEndpointDef {
  method: string;
  path: string;
  isPublic?: boolean;
  permission?: string;
}

export interface MatchedPluginEndpoint<T extends PluginEndpointDef = PluginEndpointDef> {
  endpoint: T;
  params: Record<string, string>;
}

/**
 * Find the first registered endpoint whose method + path pattern matches.
 *
 * Returns `null` when no endpoint matches — the caller should respond `404`.
 *
 * Path conventions:
 *   - `pluginPath` is the route under `/plugins/` (e.g. `/auth/api/sign-in`)
 *   - The leading `/plugins` prefix is the *adapter's* responsibility to
 *     strip; this matcher works against the post-strip path.
 */
export function matchPluginEndpoint<T extends PluginEndpointDef>(
  endpoints: readonly T[],
  method: FlowlibHttpMethod,
  pluginPath: string,
): MatchedPluginEndpoint<T> | null {
  for (const endpoint of endpoints) {
    if (endpoint.method.toUpperCase() !== method) {
      continue;
    }
    const params = matchPath(endpoint.path, pluginPath);
    if (params !== null) {
      return { endpoint, params };
    }
  }
  return null;
}

/**
 * Test a single endpoint pattern against a path. Returns the extracted
 * `:param` map on match, or `null` on miss.
 *
 * Capture-group ordering matters: `*` wildcards and `:params` both produce
 * capture groups in the compiled regex. We walk both in source order so a
 * pattern like `/foo/* /bar/:id` correctly aligns capture group N with the
 * Nth occurrence (not just the Nth `:param`). The previous adapter-side
 * implementations indexed by `:param` count alone — fine for current
 * plugin paths (which never mix the two) but a latent bug if someone ever
 * registered a mixed pattern.
 */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  // Walk the pattern in source order, building both the regex and the
  // ordered list of capture names (with `null` for wildcards).
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
  // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern from registered plugin endpoints
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
