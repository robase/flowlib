/**
 * AI service types — re-exported from `@flowlib/action-kit` so the enum
 * identities match across packages. Kept as a thin shim so existing
 * `src/services/ai/ai-types` imports inside core keep resolving.
 */

export { BatchProvider, AIProvider, BatchStatus } from '@flowlib/action-kit';
export type {
  Model,
  PromptResult,
  AgentPromptRequest,
  BatchSubmissionResult,
  BatchResult,
  BatchPollResult,
} from '@flowlib/action-kit';
