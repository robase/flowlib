/**
 * Shared options for the agents-plugin API clients.
 *
 * Each client (sessions, workspaces, mcp-servers) constructs requests
 * against the host's `apiPath`; tests inject `fetchImpl` to stub fetch.
 */

export interface AgentsApiClientOptions {
  /**
   * Base URL prefix to prepend to every request, *without* a trailing
   * slash. Defaults to `''` (same-origin, root-mounted). The host's
   * `<Flowlib config={{ apiPath }}>` value is forwarded here by
   * `<AgentsApiProvider>`.
   */
  baseUrl?: string;
  /**
   * Override for `globalThis.fetch`. Tests stub this.
   */
  fetchImpl?: typeof fetch;
  /**
   * Static headers to merge into every request — primarily for tests
   * that need to forward auth cookies / org id headers.
   */
  headers?: Record<string, string>;
}
