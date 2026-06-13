/**
 * `WorkspaceProvider` — pluggable workspace backends (CF Sandbox, local fs,
 * git clone, remote sandbox, none). v1 ships only `cloudflare-sandbox`;
 * the other ids are reserved in the enum so future providers don't break
 * the schema.
 */

import type { AgentsAuthContext } from '../../shared/auth-context';

/**
 * Stable id for the workspace provider. Persisted on
 * `agent_workspaces.workspaceProviderId`.
 */
export type WorkspaceProviderId =
  | 'local-fs'
  | 'git-clone'
  | 'cloudflare-sandbox'
  | 'cloudflare-sandbox-claude'
  | 'computesdk'
  | 'remote-sandbox'
  | 'none';

/**
 * Result of `exec()` on a `WorkspaceHandle`.
 */
export interface WorkspaceExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Options for `exec()`.
 */
export interface WorkspaceExecOptions {
  /** Working directory relative to workspace root. */
  cwd?: string;
  /** Hard timeout — provider kills the process and rejects on miss. */
  timeoutMs?: number;
  /** Environment variables merged on top of the workspace defaults. */
  env?: Record<string, string>;
}

/**
 * The runtime handle for a workspace — what `AgentProvider`s, the tool
 * bridge, and the prompt composer call. Implementations route the
 * methods to whatever backs them (a Sandbox SDK container, `node:fs`,
 * a remote HTTP API, …).
 *
 * Tool-output store (Stream G) and prompt composer (Stream K) MUST go
 * through this interface; they never call `node:fs` directly. That
 * keeps the same code path working on Workers.
 */
export interface WorkspaceHandle {
  /** Stable workspace id (matches `agent_workspaces.id`). */
  id: string;
  /**
   * Mode-A / Mode-B / Mode-D only: an absolute filesystem path. Sandbox
   * modes leave this `undefined` — files live inside the container, not
   * on the host.
   */
  rootPath?: string;
  /**
   * Sandbox modes only: an internal endpoint string the provider can use
   * to talk to the sandbox (Sandbox SDK URL, remote-sandbox HTTP base).
   */
  remoteEndpoint?: string;
  /**
   * Run a shell command inside the workspace.
   *
   * Cloudflare-sandbox dispatches via `sandbox.exec`; local-fs spawns
   * via `node:child_process`. Returns once the command exits or
   * `options.timeoutMs` elapses.
   */
  exec(command: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult>;
  /**
   * Read a single file by workspace-relative path. Throws on missing
   * file. Returns the raw contents as UTF-8 text — callers handle
   * binary decoding (rare).
   */
  readFile(path: string): Promise<string>;
  /**
   * Write a file at a workspace-relative path. Creates parent
   * directories as needed. Overwrites silently.
   */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Glob-match files under the workspace root. Glob syntax is
   * provider-defined but should at minimum support `**` and `*`.
   */
  listFiles(glob: string): Promise<string[]>;
  /** Provider-specific extras the AgentProvider might need. */
  metadata: Record<string, unknown>;
}

/**
 * Lazily provision-or-resolve a session's workspace, returning a live
 * handle. The first call may boot a sandbox (cold-start cost); subsequent
 * calls return the same handle.
 *
 * Hosts supply this so providers whose `capabilities.workspaceRequired`
 * is `false` can defer — and for pure-chat turns, skip entirely — the
 * container provisioning until a tool actually needs the filesystem or
 * shell. The host implementation is expected to create the workspace row
 * if missing, persist the workspace id onto the session, resolve the
 * handle, and cache the result.
 */
export type WorkspaceAccessor = () => Promise<WorkspaceHandle>;

/** Input to `WorkspaceProvider.create`. */
export interface CreateWorkspaceInput {
  /** Pre-allocated workspace id (the row's PK). */
  workspaceId: string;
  /** Resolved tenant / user. Embedded in sandbox names for isolation. */
  auth: AgentsAuthContext;
  /** UI-supplied workspace name (used for the sandbox label). */
  name: string;
  /** Mode-A absolute path (under `allowedRoot`). */
  rootPath?: string;
  /** Mode-B git remote (e.g. `https://github.com/foo/bar.git`). */
  gitRemote?: string;
  /** Mode-B branch (defaults to provider's default branch). */
  gitBranch?: string;
  /** Sandbox-mode config — provider validates internally. */
  sandboxConfig?: Record<string, unknown>;
}

/**
 * `WorkspaceProvider` — instantiates and resolves workspace handles.
 *
 * Singletons live for the lifetime of the plugin process. `create` /
 * `resolve` / `destroy` are the only operations; per-handle state is
 * encapsulated inside `WorkspaceHandle`.
 */
export interface WorkspaceProvider {
  /** Stable id; matches `agent_workspaces.workspaceProviderId`. */
  readonly id: WorkspaceProviderId;
  /** UI label. */
  readonly name: string;
  /** Boot a new workspace and return its handle. */
  create(input: CreateWorkspaceInput): Promise<WorkspaceHandle>;
  /**
   * Re-attach to an existing workspace by id. For sandbox modes this
   * is cheap (just returns a stub talking to the running container);
   * for cold ones it may need to wake the sandbox.
   */
  resolve(workspaceId: string, auth: AgentsAuthContext): Promise<WorkspaceHandle>;
  /** Tear down the workspace. Idempotent. */
  destroy(workspaceId: string, auth: AgentsAuthContext): Promise<void>;
}
