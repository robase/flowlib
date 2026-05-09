/**
 * Frontend-safe types for `@flowlib/agents`.
 *
 * Imported by `@flowlib/agents/ui` consumers — never pulls in any
 * runtime code from `backend/`. Phase 1 Stream L will add real React
 * components alongside; this file stays types-only.
 */

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
  WorkspaceProviderId,
} from '../shared/types';

export type { AgentEvent } from '../shared/events';
export type { AgentsAuthContext } from '../shared/auth-context';
