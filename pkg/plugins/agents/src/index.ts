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

export { resolveAuthContext, DEFAULT_ORG_ID } from './backend/auth/resolve-auth-context';
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
export {
  AgentService as AgentServiceImpl,
  createAgentService,
} from './backend/service/agent-service';
export { runTurn } from './backend/service/run-turn';

export { ProviderRegistry, createProviderRegistry } from './backend/providers/registry';
export { registerProviders } from './backend/providers/register';

// Provider factories live at `@flowlib/agents/providers` — they pull in
// the vendor SDKs (`@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk`,
// `ai`/`@ai-sdk/*`), so they're kept off this core entry to let the
// plugin boot on Express/Node hosts that don't install them. Only the
// option *types* are re-exported here (erased at build → no SDK dragged).
export type { ClaudeCodeProviderOptions } from './backend/providers/claude-code/provider';
export type { OpenCodeProviderOptions } from './backend/providers/opencode/provider';
export { buildOpencodeLlmProviderLoader } from './backend/providers/opencode/llm-provider-loader';

// AI SDK provider — see `@flowlib/agents/providers` for the runtime
// `aiSdkProvider` + tool builders. Types only here (erased at build).
export type {
  AiSdkCredential,
  AiSdkProviderOptions,
  AiSdkVendor,
  CredentialResolver as AiSdkCredentialResolver,
  ParsedModelSpec as AiSdkModelSpec,
} from './backend/providers/ai-sdk';
export type {
  AiSdkToolDescriptor,
  AiSdkToolSet,
  BuildFlowlibActionToolsOptions as BuildAiSdkFlowlibActionToolsOptions,
  DefaultCredentialForAction as AiSdkDefaultCredentialForAction,
  GetCredentialFn as AiSdkGetCredentialFn,
} from './backend/providers/ai-sdk';
export {
  normaliseModelForCredential,
  type NormaliseModelInput,
  type NormaliseModelResult,
} from './backend/providers/model-normalise';
export type {
  BuildOpencodeLlmProviderLoaderOptions,
  FlowlibCredentialsSlice,
} from './backend/providers/opencode/llm-provider-loader';
export { inferOpencodeProvider } from './backend/endpoints/credentials.endpoint';
export type { AgentCredentialOption } from './backend/endpoints/credentials.endpoint';

// Workspace provider factories (`cloudflareSandbox`, `cloudflareSandboxClaude`,
// `buildSandboxName`) live at `@flowlib/agents/cloudflare` — they import the
// `@cloudflare/sandbox` SDK. Types only here (erased at build).
export type { CloudflareSandboxOptions } from './backend/workspaces/cloudflare-sandbox/provider';
export type {
  CloudflareSandboxClaudeOptions,
  CloudflareSandboxClaudeProvider,
} from './backend/workspaces/cloudflare-sandbox-claude/provider';
export type {
  ClaudeServerBootOptions,
  ClaudeServerBundle,
  ClaudeServerClient,
  ClaudeServerHandle,
  ClaudeServerLoader,
} from './backend/workspaces/cloudflare-sandbox-claude/handle';

export { McpServersRepository } from './backend/repositories/mcp-servers.repository';
export { WorkspacesRepository } from './backend/repositories/workspaces.repository';
export { SessionsRepository } from './backend/repositories/sessions.repository';
export { MessagesRepository } from './backend/repositories/messages.repository';
export { ProjectsRepository } from './backend/repositories/projects.repository';
export { AuditRepository } from './backend/repositories/audit.repository';
export { RolePermissionsRepository } from './backend/repositories/role-permissions.repository';
export type { Repositories, RepositoriesFactory } from './backend/repositories/register';
export { buildRepositories, registerRepositories } from './backend/repositories/register';

export { createPermissionsResolver, registerPermissions } from './backend/permissions/register';
export { createAuditWriter, registerAudit } from './backend/audit/register';
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

export type { PermissionsResolver, ResolveDenyListInput } from './backend/permissions/types';
export { allowAllResolver } from './backend/permissions/types';

export type {
  PluginContext,
  ResolvedAgentsOptions,
  AgentsRuntimeRegistries,
} from './backend/plugin-context';

// Cloudflare Durable Object surface (`AgentChatDO`) lives at
// `@flowlib/agents/cloudflare` — it imports the Agents SDK
// (`agents/ai-chat-agent`). Consumer Workers forward it from there:
//   export { AgentChatDO } from '@flowlib/agents/cloudflare';
// and inject it into the plugin: `agents({ cloudflareDoClass: AgentChatDO })`.

// Per-isolate runtime bootstrap. The Worker fetch isolate and each DO
// isolate are separate; the host calls `setAgentsRuntimeBootstrapper`
// at the **top of the Worker entry module** so that DO isolates pick
// up the registration on module load and can lazily initialise
// Flowlib (and thereby the agents plugin) on first DO request.
export {
  setAgentsRuntimeBootstrapper,
  type AgentsRuntimeBootstrap,
} from './backend/cloudflare/runtime-singleton';

// Phase 2 outbound-Workers auth — pure helpers that don't depend on
// the @cloudflare/sandbox SDK. Consumer Worker imports them and
// assigns the host map to its own `Sandbox.outboundByHost` static.
export {
  buildFlowlibOutboundHandlers,
  createAnthropicOutboundHandler,
  createOpenAIOutboundHandler,
  createOpenRouterOutboundHandler,
  createGoogleOutboundHandler,
  createCloudflareAiGatewayOutboundHandler,
  OutboundCredentialKV,
  credentialKvKey,
  FLOWLIB_SESSION_HEADER,
  DEFAULT_BINDING_TTL_SECONDS,
} from './backend/cloudflare/outbound-auth';
export type {
  OutboundEnv,
  OutboundHandler,
  OutboundVendor,
  OutboundCredentialKVStore,
  BuildOutboundHandlersOptions,
} from './backend/cloudflare/outbound-auth';

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
  AgentMcpServer,
  AgentWorkspace,
  AgentSession,
  AgentMessage,
  AgentMessagePart,
  AgentMessageUsage,
  AgentVisibility,
  AgentSessionStatus,
  AgentProviderId,
  McpTransport,
  ToolOutputBudget,
  OrgScope,
  AgentsPluginPublicOptions,
} from './shared/types';
