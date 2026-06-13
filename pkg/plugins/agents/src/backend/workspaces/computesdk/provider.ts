/**
 * `computesdkWorkspace` — a provider-agnostic sandbox `WorkspaceProvider`
 * backed by the ComputeSDK (`computesdk` + a `@computesdk/<provider>`
 * package: e2b, modal, vercel, daytona, …).
 *
 * This is what lets the agent loop offload exec / filesystem work to a
 * real sandbox **on any runtime** (Express/Node included) — not just the
 * Cloudflare-specific `cloudflare-sandbox` provider.
 *
 * Session ↔ sandbox persistence: ComputeSDK assigns the sandbox id at
 * `create()`, and `getById(id)` reconnects across requests/turns. We keep
 * a per-process `workspaceId → sandboxId` map and, optionally, persist it
 * via `persistence` (e.g. onto `agent_workspaces.sandboxConfig`) so a
 * restart can still reconnect. `resolve()` reconnects when an id is known
 * and the sandbox is still alive, otherwise provisions a fresh one — so a
 * sandbox that hit its idle `timeout` is transparently recreated.
 */
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type {
  CreateWorkspaceInput,
  WorkspaceHandle,
  WorkspaceProvider,
  WorkspaceProviderId,
} from '../types';
import type { ComputeLike, ComputeSandbox, SandboxIdPersistence } from './types';
import { createComputesdkHandle } from './handle';

export interface ComputesdkWorkspaceOptions {
  /**
   * A configured ComputeSDK instance — e.g. `e2b({ apiKey })`, or the
   * `computesdk` core `compute` after `compute.setConfig({ providers })`.
   */
  compute: ComputeLike;
  /**
   * Optional durable store for the provider-assigned sandbox id, keyed by
   * workspace id. When omitted, ids live only in this process (fine for a
   * single long-lived Node server; a restart recreates sandboxes).
   */
  persistence?: SandboxIdPersistence;
  /** Defaults applied to every `compute.sandbox.create()`. */
  createOptions?: { timeout?: number; templateId?: string; envs?: Record<string, string> };
}

export function computesdkWorkspace(options: ComputesdkWorkspaceOptions): WorkspaceProvider {
  const { compute, persistence, createOptions } = options;
  const inMemory = new Map<string, string>();

  const loadId = async (workspaceId: string): Promise<string | null> => {
    const cached = inMemory.get(workspaceId);
    if (cached) {
      return cached;
    }
    return persistence ? persistence.load(workspaceId) : null;
  };

  const saveId = async (workspaceId: string, sandboxId: string): Promise<void> => {
    inMemory.set(workspaceId, sandboxId);
    if (persistence) {
      await persistence.save(workspaceId, sandboxId);
    }
  };

  const provision = async (
    workspaceId: string,
    auth: AgentsAuthContext,
  ): Promise<ComputeSandbox> => {
    const sandbox = await compute.sandbox.create({
      ...createOptions,
      metadata: { workspaceId, orgId: auth.orgId ?? '' },
    });
    await saveId(workspaceId, sandbox.sandboxId);
    return sandbox;
  };

  const resolveSandbox = async (
    workspaceId: string,
    auth: AgentsAuthContext,
  ): Promise<ComputeSandbox> => {
    const existing = await loadId(workspaceId);
    if (existing) {
      const sandbox = await compute.sandbox.getById(existing);
      if (sandbox) {
        return sandbox;
      }
      // Stored sandbox is gone (idle timeout / destroyed) — recreate.
      inMemory.delete(workspaceId);
    }
    return provision(workspaceId, auth);
  };

  return {
    id: 'computesdk' as WorkspaceProviderId,
    name: 'ComputeSDK Sandbox',
    async create(input: CreateWorkspaceInput): Promise<WorkspaceHandle> {
      const sandbox = await provision(input.workspaceId, input.auth);
      return createComputesdkHandle(input.workspaceId, sandbox);
    },
    async resolve(workspaceId: string, auth: AgentsAuthContext): Promise<WorkspaceHandle> {
      const sandbox = await resolveSandbox(workspaceId, auth);
      return createComputesdkHandle(workspaceId, sandbox);
    },
    async destroy(workspaceId: string): Promise<void> {
      const id = await loadId(workspaceId);
      if (id) {
        await compute.sandbox.destroy(id);
        inMemory.delete(workspaceId);
      }
    },
  };
}
