// =============================================================================
// Phase 1 — Read-only HTTP gate
//
// Decides whether an inbound HTTP request is a "flow content mutation" that
// should be blocked on prod when no break-glass window is open.
//
// Why a curated path list instead of "block any POST":
//   - Flow execution (`POST /flow-runs`) must keep working on prod.
//   - Credential reads via GET stay open.
//   - The plugin's own `/vc/*` writes (push, pull, break-glass) are
//     deliberately exempted at the call site.
//
// The matchers run against the platform-relative path — the host framework
// has already stripped its `apiPath` prefix — so this works whether Flowlib
// is mounted at `/api/flowlib`, `/flowlib`, or anywhere else.
//
// Phase 1 caveat (documented in plugin.ts): this gate only catches HTTP
// writes. Service-layer mutations (chat assistant, agent flows calling
// `flowlib.flows.update`) bypass it. Closing that gap requires a
// `beforeFlowMutation` hook on FlowsService — a core PR scoped for later.
// =============================================================================

const FLOW_MUTATION_PATH_PATTERNS: RegExp[] = [/^\/?flows(\/|$)/, /^\/?flow-versions(\/|$)/];

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True iff the (method, path) pair is a flow-content mutation that the
 * read-only gate should consider blocking. Pure function — exported for
 * direct unit testing.
 */
export function isFlowMutation(method: string, path: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) {
    return false;
  }
  return FLOW_MUTATION_PATH_PATTERNS.some((re) => re.test(path));
}

/** Plugin's own `/vc/*` paths are always allowed regardless of env. */
export function isPluginOwnedPath(path: string): boolean {
  return path.startsWith('/vc/') || path.startsWith('vc/');
}

/**
 * Standard 403 Response body returned when the gate blocks a request.
 * Includes a `retry` hint pointing the caller at the break-glass endpoint
 * so they don't have to grep the docs.
 */
export function readOnlyResponse(reason: string, retryHint: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Production instance is read-only',
      reason,
      retry: retryHint,
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
