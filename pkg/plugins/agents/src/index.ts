/**
 * `@flowlib/agents` — Backend Entry Point
 *
 * Code-editing AI agents plugin for Flowlib.
 *
 * This entry exposes the plugin factory + the backend-side type
 * surface. The frontend lives at `@flowlib/agents/ui`; browser
 * consumers automatically resolve via the `browser` export condition
 * to `./src/browser.ts`.
 *
 * Phase 0 (current) ships only contracts + stubs. Phase 1 streams
 * fill in providers, workspaces, the orchestration kernel, REST
 * endpoints, and the Cloudflare Durable Object. The Durable Object
 * class will be re-exported from this module so consumer Workers can
 * forward it: `export { AgentChatDO } from '@flowlib/agents';`.
 */

export { agents } from './backend/plugin';
export type { AgentsPluginOptions } from './backend/plugin';

export { agentSchema } from './backend/schema/tables';

export {
  resolveAuthContext,
  DEFAULT_ORG_ID,
} from './backend/auth/resolve-auth-context';
export type { ResolveAuthContextOptions } from './backend/auth/resolve-auth-context';

// Type-only surface — Phase 1 streams import these to build their
// implementations against P0's contracts.
export type {
  AgentProvider,
  AgentCapabilities,
  AgentProviderConfig,
  CreateSessionInput,
  PromptInput,
  ListMessagesInput,
  AgentProviderMessage,
  AgentModel,
} from './backend/providers/types';

export type {
  WorkspaceProvider,
  WorkspaceProviderId,
  WorkspaceHandle,
  WorkspaceExecResult,
  WorkspaceExecOptions,
  CreateWorkspaceInput,
} from './backend/workspaces/types';

export type {
  AgentService,
  SessionContext,
  SessionLogger,
  PersistenceCallbacks,
  RunResult,
} from './backend/service/types';

export type {
  HookPipeline,
  HookDecision,
  PostHookDecision,
  PreToolUseHook,
  PostToolUseHook,
  PreToolUseContext,
  PostToolUseContext,
} from './backend/hooks/types';
export { noopHookPipeline } from './backend/hooks/types';

export type {
  PermissionsResolver,
  ResolveDenyListInput,
} from './backend/permissions/types';
export { allowAllResolver } from './backend/permissions/types';

export type {
  PluginContext,
  ResolvedAgentsOptions,
  AgentsRuntimeRegistries,
} from './backend/plugin-context';

// Browser-safe DTOs + the AgentEvent union — re-exported here for
// convenience so backend consumers can pull everything from one path.
export type {
  AgentEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  FileEditEvent,
  PermissionRequestEvent,
  HumanInputRequestEvent,
  MessageCompleteEvent,
  SessionEndEvent,
} from './shared/events';
export { isAgentEvent } from './shared/events';

export type { AgentsAuthContext } from './shared/auth-context';

export type {
  AgentDefinition,
  AgentWorkspace,
  AgentSession,
  AgentMessage,
  AgentMessagePart,
  AgentMessageUsage,
  AgentVisibility,
  AgentSessionStatus,
  AgentProviderId,
  ToolOutputBudget,
  OrgScope,
  AgentsPluginPublicOptions,
} from './shared/types';
