/**
 * Minimal structural types for the ComputeSDK surface the workspace
 * provider uses. Declared locally (rather than importing `computesdk`)
 * so the provider compiles without the optional peer dep installed — the
 * host supplies a real `compute` instance at runtime.
 *
 * Mirrors `compute.sandbox.*` and the `Sandbox` instance from
 * https://docs.computesdk.com/reference/compute.sandbox / Sandbox.
 */

export interface ComputeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs?: number;
}

export interface ComputeFilesystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<Array<{ name: string; type?: string }>>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export interface ComputeSandbox {
  /** Provider-assigned id — store it to reconnect via `getById`. */
  readonly sandboxId: string;
  runCommand(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<ComputeCommandResult>;
  filesystem: ComputeFilesystem;
  getUrl?(options: { port: number; protocol?: 'http' | 'https' }): Promise<string>;
  destroy?(): Promise<void>;
}

export interface ComputeSandboxApi {
  create(options?: {
    timeout?: number;
    templateId?: string;
    envs?: Record<string, string>;
    metadata?: Record<string, string>;
  }): Promise<ComputeSandbox>;
  getById(sandboxId: string): Promise<ComputeSandbox | null>;
  destroy(sandboxId: string): Promise<void>;
}

/** What a provider factory (`e2b({...})`, `compute`, …) returns. */
export interface ComputeLike {
  sandbox: ComputeSandboxApi;
}

/** Persist the provider-assigned sandbox id for a workspace (optional). */
export interface SandboxIdPersistence {
  load(workspaceId: string): Promise<string | null>;
  save(workspaceId: string, sandboxId: string): Promise<void>;
}
