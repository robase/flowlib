/**
 * `@flowlib/agents/providers` — agent provider factories.
 *
 * These pull in the vendor SDKs (`@anthropic-ai/claude-agent-sdk`,
 * `@opencode-ai/sdk`, `ai` / `@ai-sdk/*`), so they live on a dedicated
 * entry rather than the core `@flowlib/agents` one. Hosts that wire
 * providers import from here:
 *
 * ```ts
 * import { aiSdkProvider, claudeCodeProvider } from '@flowlib/agents/providers';
 * agents({ providers: [aiSdkProvider({ ... })] });
 * ```
 *
 * Express/Node hosts that only need the plugin's REST + UI surface
 * import `agents` from `@flowlib/agents` and never touch this entry, so
 * they don't have to install the vendor SDKs.
 */

export { claudeCodeProvider } from './backend/providers/claude-code/provider';
export type { ClaudeCodeProviderOptions } from './backend/providers/claude-code/provider';

export { openCodeProvider } from './backend/providers/opencode/provider';
export type { OpenCodeProviderOptions } from './backend/providers/opencode/provider';

export { aiSdkProvider } from './backend/providers/ai-sdk';
export {
  parseModelSpec as parseAiSdkModelSpec,
  resolveModel as resolveAiSdkModel,
  buildSandboxTools as buildAiSdkSandboxTools,
  buildFlowlibActionTools as buildAiSdkFlowlibActionTools,
} from './backend/providers/ai-sdk';
export type {
  AiSdkCredential,
  AiSdkProviderOptions,
  AiSdkVendor,
  CredentialResolver as AiSdkCredentialResolver,
  ParsedModelSpec as AiSdkModelSpec,
  AiSdkToolDescriptor,
  AiSdkToolSet,
  BuildFlowlibActionToolsOptions as BuildAiSdkFlowlibActionToolsOptions,
  DefaultCredentialForAction as AiSdkDefaultCredentialForAction,
  GetCredentialFn as AiSdkGetCredentialFn,
} from './backend/providers/ai-sdk';
