/**
 * In-memory fakes that let the harness drive the *real* host path
 * (`runChatTurn`) without a database.
 *
 * Driving `runChatTurn` (rather than hand-building a `SessionContext`) is
 * what gives evals the production tool surface — `buildProviderTools`
 * wires `web.fetch`, `ask_user`, `memory.search`/`write`, and
 * `update_plan` onto the turn exactly as the Express/DO transports do —
 * plus production-identical prompt composition. These fakes back the
 * repositories + workspace registry that path expects.
 */

import type { RepositoriesBag } from '../../src/backend/service/chat-session-host';
import type {
  CreateWorkspaceInput,
  WorkspaceHandle,
  WorkspaceProvider,
} from '../../src/backend/workspaces/types';
import type { AgentsAuthContext } from '../../src/shared/auth-context';

/** The session row `buildSessionContext` reads (structural subset). */
export interface EvalSessionRow {
  providerId: string;
  providerSessionId: string;
  orgId: string;
  workspaceId?: string;
  credentialId?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  denyList?: string[] | null;
  enabledTools?: string[] | null;
  enabledMcpServerIds?: string[] | null;
  permissionMode?: string | null;
}

export interface EvalRepositoriesInput {
  session: EvalSessionRow & { id: string };
  workspaceProviderId: string;
  /** Memories visible to the session (for the prompt + `memory.search`). */
  memory?: ReadonlyArray<{ scope: string; content: string }>;
}

/**
 * Build a {@link RepositoriesBag} backed by plain JS structures. Memory
 * and plan writes mutate in place, so the agent's `memory.write` /
 * `update_plan` tool calls behave end-to-end (and show up in the
 * transcript as real tool results).
 */
export function createEvalRepositories(input: EvalRepositoriesInput): RepositoriesBag {
  const session = { ...input.session };
  const memories = (input.memory ?? []).map((m, i) => ({
    id: `mem-${i}`,
    scope: m.scope,
    content: m.content,
  }));
  let planCheckpoints: Array<{ id: string; label: string; status: string }> = [];

  return {
    sessions: {
      findById: async (id) => (id === session.id ? session : undefined),
      update: async (id, patch) => {
        if (id === session.id && patch.workspaceId) {
          session.workspaceId = patch.workspaceId;
        }
        return session;
      },
    },
    workspaces: {
      findById: async (id) => ({ id, workspaceProviderId: input.workspaceProviderId }),
      create: async ({ name }) => ({ id: `eval-ws-${name}` }),
    },
    messages: { append: async () => {} },
    memories: {
      listForScope: async ({ limit }) =>
        memories.slice(0, limit ?? memories.length).map((m) => ({ scope: m.scope, content: m.content })),
      search: async (query, scope) => {
        const q = query.toLowerCase();
        return memories
          .filter((m) => m.content.toLowerCase().includes(q))
          .slice(0, scope.limit ?? 5)
          .map((m) => ({ id: m.id, scope: m.scope, content: m.content }));
      },
      create: async ({ scope, content }) => {
        const row = { id: `mem-${memories.length}`, scope, content };
        memories.push(row);
        return { id: row.id, content: row.content };
      },
    },
    sessionPlans: {
      get: async () => ({ checkpoints: planCheckpoints }),
      upsert: async (_sessionId, _orgId, checkpoints) => {
        planCheckpoints = checkpoints.map((c, i) => ({
          id: c.id ?? `cp-${i}`,
          label: c.label,
          status: c.status ?? 'todo',
        }));
        return { checkpoints: planCheckpoints };
      },
    },
  };
}

/**
 * A `WorkspaceProvider` that always returns the supplied handle. Lets the
 * harness keep a reference to the workspace for post-run scorer
 * inspection while the host's lazy `ensureWorkspace` path resolves it.
 */
export function createEvalWorkspaceProvider(
  id: WorkspaceProvider['id'],
  handle: WorkspaceHandle,
): WorkspaceProvider {
  return {
    id,
    name: 'Eval workspace',
    create: async (_input: CreateWorkspaceInput) => handle,
    resolve: async () => handle,
    destroy: async () => {},
  };
}

/** The fixed auth context every eval run uses. */
export const EVAL_AUTH: AgentsAuthContext = {
  userId: 'eval-user',
  orgId: 'eval-org',
  role: 'admin',
  teamIds: [],
};
