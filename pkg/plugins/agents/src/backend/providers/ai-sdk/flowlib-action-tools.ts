/**
 * Bridge flowlib actions to AI SDK tools.
 *
 * Every flowlib action (Gmail, GitHub, Linear, Slack, …) can run as
 * an agent tool via `executeActionAsTool`. This module wraps that
 * machinery in the AI SDK's tool descriptor shape so `streamText({
 * tools })` picks them up.
 *
 * Hosts call `buildFlowlibActionTools(deps)` from their
 * `aiSdkProvider({ tools: ... })` callback. Typical usage:
 *
 *   tools: async ({ workspace, auth, sessionId }) => ({
 *     ...buildAiSdkSandboxTools(workspace),
 *     ...buildFlowlibActionTools({
 *       registry: flowlib.actions.getRegistry(),
 *       allowlist: ['gmail.send_message', 'github.list_issues', ...],
 *       getCredential: (id) => flowlib.credentials.get(id),
 *       defaultCredentialFor: (action) => session.credentialIdForProvider(action.provider.id),
 *       logger: someLogger,
 *     }),
 *   }),
 *
 * The host owns the allowlist and credential-resolution policy. This
 * module is wiring only — it doesn't import flowlib internals at
 * value level, just type level, so the agents plugin's bundle
 * doesn't pull in the full action catalogue.
 */

import type { ActionRegistry } from '@flowlib/actions';
import type {
  ActionDefinition,
  ActionCredential,
  AgentToolExecutionContext,
  Logger,
} from '@flowlib/action-kit';

import type { AiSdkToolDescriptor, AiSdkToolSet } from './tools';

/**
 * Result of resolving the credential for a tool call. The
 * `executeActionAsTool` helper expects an `ActionCredential` (the
 * full encrypted-then-decrypted shape used by flowlib actions);
 * hosts typically delegate to `flowlib.credentials.get(id)`.
 */
export type GetCredentialFn = (credentialId: string) => Promise<ActionCredential>;

/**
 * Function that picks a credential id for a given action when the
 * LLM didn't pass one in its tool input. Common pattern: per-session
 * default credential per provider id (Gmail → user's Gmail credential,
 * etc.). Return `undefined` to skip; the action will fail with a
 * "credential required" error if it actually needs one.
 */
export type DefaultCredentialForAction = (action: ActionDefinition) => string | undefined;

/**
 * Options for `buildFlowlibActionTools`.
 */
export interface BuildFlowlibActionToolsOptions {
  /** Flowlib action registry — `flowlib.actions.getRegistry()`. */
  registry: ActionRegistry;

  /**
   * Logger threaded through to action execution. The action's logs
   * surface here. In Workers, `ctx.logger` from the plugin context
   * is the right choice.
   */
  logger: Logger;

  /**
   * If set, only actions whose `id` is in this list are exposed to
   * the LLM. Omit / pass `null` to expose every registerable action
   * (NOT recommended for end-user chat — 200+ tools is more than
   * most models can effectively choose from).
   */
  allowlist?: ReadonlyArray<string> | null;

  /**
   * If set, actions whose `id` is in this list are filtered OUT
   * after the allowlist pass. Useful for "expose every Slack action
   * EXCEPT delete_channel"-style policies.
   */
  denylist?: ReadonlyArray<string> | null;

  /**
   * Resolve a credential by id. Called once per tool invocation that
   * passes a `credentialId` (either directly via tool input or via
   * `defaultCredentialFor`).
   *
   * Typical wiring:
   *
   *   getCredential: (id) => flowlib.credentials.get(id)
   */
  getCredential: GetCredentialFn;

  /**
   * Per-action default credential picker. Called when an action is
   * about to execute but the LLM didn't supply a `credentialId` in
   * its tool input.
   *
   * Typical wiring (per-session default credential, then a per-
   * provider lookup):
   *
   *   defaultCredentialFor: (action) =>
   *     session.providerCredentials[action.provider.id]
   */
  defaultCredentialFor?: DefaultCredentialForAction;

  /**
   * Optional flow-context fields stamped on every action execution.
   * Used by action implementations that log against a flow run.
   * Chat doesn't have a flow run, so these are typically null.
   */
  flowContext?: {
    flowId?: string | null;
    flowRunId?: string | null;
    nodeId?: string | null;
    traceId?: string | null;
  };
}

/**
 * Lazy-imported `executeActionAsTool`. We thread the import through
 * a top-level promise so the (small) module load happens once per
 * isolate instead of once per tool call. `@flowlib/actions` is a
 * workspace dep so this never fails at runtime in the agents bundle.
 */
let executeActionAsTool:
  | ((
      action: ActionDefinition,
      input: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolContext: AgentToolExecutionContext<any>,
    ) => Promise<{ success: boolean; output?: unknown; error?: string }>)
  | null = null;
let executeActionAsToolLoading: Promise<void> | null = null;

async function ensureExecutor(): Promise<NonNullable<typeof executeActionAsTool>> {
  if (executeActionAsTool) {
    return executeActionAsTool;
  }
  if (!executeActionAsToolLoading) {
    executeActionAsToolLoading = (async () => {
      const mod = (await import('@flowlib/actions')) as typeof import('@flowlib/actions');
      executeActionAsTool = mod.executeActionAsTool as unknown as NonNullable<
        typeof executeActionAsTool
      >;
    })();
  }
  await executeActionAsToolLoading;
  if (!executeActionAsTool) {
    throw new Error('flowlib-action-tools: failed to load @flowlib/actions executor');
  }
  return executeActionAsTool;
}

/**
 * Build an AI SDK tool catalogue from the flowlib action registry.
 *
 * Each tool's `execute` calls `executeActionAsTool` with a
 * synthesised `AgentToolExecutionContext` that threads credentials,
 * logger, and abort signal through to the underlying action.
 *
 * Tools are surfaced under their canonical action id (e.g.
 * `gmail.send_message`). The model sees them by that id; the WS
 * frame's `tool-call` event carries the same id, so the frontend
 * already routes correctly.
 */
export function buildFlowlibActionTools(options: BuildFlowlibActionToolsOptions): AiSdkToolSet {
  const {
    registry,
    logger,
    allowlist,
    denylist,
    getCredential,
    defaultCredentialFor,
    flowContext,
  } = options;

  const denySet = new Set<string>(denylist ?? []);
  const allowSet = allowlist ? new Set<string>(allowlist) : null;

  const tools: AiSdkToolSet = {};

  for (const action of registry.getAll()) {
    if (allowSet && !allowSet.has(action.id)) {
      continue;
    }
    if (denySet.has(action.id)) {
      continue;
    }

    const def = registry.toAgentToolDefinition(action.id);
    if (!def) {
      continue;
    } // Excluded (e.g. trigger actions, `excludeFromTools`).

    const descriptor: AiSdkToolDescriptor = {
      description: def.description,
      parameters: def.inputSchema,
      execute: async (input, { abortSignal }) => {
        const executor = await ensureExecutor();

        // Pick a credentialId: explicit in input wins, then the
        // host's per-action default.
        const explicitCredId =
          typeof input.credentialId === 'string' ? (input.credentialId as string) : undefined;
        const credentialId = explicitCredId ?? defaultCredentialFor?.(action);
        const staticParams: Record<string, unknown> = {};
        if (credentialId) {
          staticParams.credentialId = credentialId;
        }

        const toolContext: AgentToolExecutionContext<unknown> = {
          logger,
          iteration: 0,
          maxIterations: 1,
          staticParams,
          ...(abortSignal ? { abortSignal } : {}),
          // Minimal NodeExecutionContext shim — only the fields
          // `executeActionAsTool` reads. Cast through `unknown`
          // because the agent-tool path doesn't have a real flow run.
          nodeContext: {
            functions: { getCredential },
            incomingData: {},
            flowId: flowContext?.flowId ?? null,
            flowRunId: flowContext?.flowRunId ?? null,
            nodeId: flowContext?.nodeId ?? null,
            traceId: flowContext?.traceId ?? null,
          } as unknown,
        };

        const result = await executor(action, input, toolContext);
        if (!result.success) {
          // Throw so the AI SDK marks this tool call as an error and
          // surfaces a `tool-result` with `isError: true` to the model.
          // The error message goes back as the result content so the
          // model can react (retry with corrections, ask the user,
          // etc.).
          throw new Error(result.error ?? `Action "${action.id}" failed`);
        }
        return result.output ?? null;
      },
    };

    tools[action.id] = descriptor;
  }

  return tools;
}
