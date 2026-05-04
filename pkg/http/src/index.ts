/**
 * `@flowlib/http` — internal HTTP transport helpers shared across
 * Flowlib's framework adapters (Express/NestJS/Next.js).
 *
 * **Internal package.** Not currently published. Marked `private: true` in
 * `package.json`. Plan: [plans/shared-http-adapter-plan.md].
 *
 * Phase 1 surface (this file): transport-level parsing helpers and error
 * classification. Adapter-side route registration, dispatch, and auth are
 * deliberately NOT in here yet — they're the targets of phases 2–7 once
 * helper extraction has settled.
 */

export { parseJsonQueryParam, coerceSingleQueryValue } from './parsing/query';

export {
  parsePagination,
  parsePaginationFromSearchParams,
  parsePaginationFromRequest,
  type ParsedPagination,
  type ParsePaginationOptions,
} from './parsing/pagination';

export { parseBooleanQueryParam } from './parsing/boolean';

export { classifyHttpError, type ClassifiedHttpError } from './errors';

// ── Phase 2: shared types + auth helpers ────────────────────────────────

export type {
  EndpointAuth,
  FlowlibHttpMethod,
  FlowlibHttpRequest,
  FlowlibHttpResult,
  ResolvedHttpRequestContext,
} from './types';

export { authorizeEndpoint, type AuthorizeEndpointResult } from './auth/authorize';

export {
  type ExpressRequestLike,
  type ExpressResponseLike,
  toWebRequestFromExpress,
  writeWebResponseToExpress,
  writeFlowlibHttpResultToExpress,
  normaliseHttpMethod,
} from './bridge/express';

// ── Phase 3: shared plugin-endpoint dispatch ───────────────────────────

export {
  matchPluginEndpoint,
  type MatchedPluginEndpoint,
  type PluginEndpointDef,
} from './plugin-endpoints/match';

export {
  dispatchPluginEndpoint,
  type DispatchPluginEndpointInput,
} from './plugin-endpoints/dispatch';

// ── Phase 4: shared endpoint metadata ──────────────────────────────────

export {
  defineEndpoint,
  type FlowlibHttpEndpoint,
  type EndpointHandlerContext,
} from './endpoints/types';

export { runEndpoint, type RunEndpointInput } from './endpoints/run-endpoint';

export { matchHttpEndpoint, type MatchedHttpEndpoint } from './endpoints/match';

export { flowRunsEndpoints } from './endpoints/flow-runs';

export { triggersEndpoints } from './endpoints/triggers';

export { dashboardEndpoints } from './endpoints/dashboard';

export { agentEndpoints } from './endpoints/agent';

export { flowsEndpoints } from './endpoints/flows';

export { flowExecutionEndpoints } from './endpoints/flow-execution';

export { runEventsEndpoints } from './endpoints/run-events';

export { credentialsEndpoints } from './endpoints/credentials';

export { oauth2Endpoints } from './endpoints/oauth2';

export { chatEndpoints } from './endpoints/chat';

export { nodeDataEndpoints } from './endpoints/node-data';

export { nodesEndpoints } from './endpoints/nodes';

export { allFirstPartyEndpoints } from './endpoints/all';
