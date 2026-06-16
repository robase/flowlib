/**
 * `@flowlib/agents/workspaces` — pluggable workspace (sandbox) providers
 * that pull in third-party SDKs.
 *
 * Kept off the light core `@flowlib/agents` entry so hosts that don't use
 * a sandbox (pure chat) needn't install `computesdk` / `@computesdk/*`.
 *
 * ```ts
 * import { agents } from '@flowlib/agents';
 * import { computesdkWorkspace } from '@flowlib/agents/workspaces';
 * import { e2b } from '@computesdk/e2b';
 *
 * agents({
 *   providers: [aiSdkProvider({ ... })],
 *   workspaceProviders: [computesdkWorkspace({ compute: e2b({ apiKey }) })],
 * });
 * ```
 */
export { computesdkWorkspace } from './backend/workspaces/computesdk/provider';
export type { ComputesdkWorkspaceOptions } from './backend/workspaces/computesdk/provider';

// Local Docker sandbox — runs each workspace as a `docker` container,
// driven straight from Node (no Cloudflare/Workers runtime needed).
export { localDockerWorkspace } from './backend/workspaces/local-docker/provider';
export type { LocalDockerWorkspaceOptions } from './backend/workspaces/local-docker/provider';
export type {
  ComputeLike,
  ComputeSandbox,
  ComputeSandboxApi,
  ComputeCommandResult,
  ComputeFilesystem,
  SandboxIdPersistence,
} from './backend/workspaces/computesdk/types';
