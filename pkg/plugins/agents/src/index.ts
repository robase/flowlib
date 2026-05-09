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
export { AgentService as AgentServiceImpl, createAgentService } from './backend/service/agent-service';
export { runTurn } from './backend/service/run-turn';

export {
  ProviderRegistry,
  createProviderRegistry,
} from './backend/providers/registry';
export { registerProviders } from './backend/providers/register';

export {
  AgentsRepository,
} from './backend/repositories/agents.repository';
export {
  WorkspacesRepository,
} from './backend/repositories/workspaces.repository';
export {
  SessionsRepository,
} from './backend/repositories/sessions.repository';
export {
  MessagesRepository,
} from './backend/repositories/messages.repository';
export {
  ProjectsRepository,
} from './backend/repositories/projects.repository';
export {
  AuditRepository,
} from './backend/repositories/audit.repository';
export {
  RolePermissionsRepository,
} from './backend/repositories/role-permissions.repository';
export type { Repositories, RepositoriesFactory } from './backend/repositories/register';
export {
  buildRepositories,
  registerRepositories,
} from './backend/repositories/register';

export {
  createPermissionsResolver,
  registerPermissions,
} from './backend/permissions/register';
export {
  createAuditWriter,
  registerAudit,
} from './backend/audit/register';
export type { AuditWriter, AuditEventInput } from './backend/audit/writer';

export { composeSystemPrompt } from './backend/prompt/compose';
export type { ComposeInput } from './backend/prompt/compose';
export { registerPromptComposer } from './backend/prompt/register';
export type { PromptComposer } from './backend/prompt/register';
export { walkClaudeMd, OutOfRootError } from './backend/prompt/claude-md-walk';

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

// Stream H — Cloudflare Durable Object surface. Re-exported here so
// the consumer Worker can forward the DO class:
//   export { AgentChatDO } from '@flowlib/agents';
export { AgentChatDO } from './backend/cloudflare/chat-agent-do';

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
