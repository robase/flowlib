/**
 * Public surface of the AI SDK provider.
 *
 * Hosts import `aiSdkProvider` and pass it to `createFlowlib({ plugins:
 * [agents({ providers: [aiSdkProvider({ ... })] })] })`.
 *
 * See `pkg/plugins/agents/docs/migration-plan-ai-sdk.md` for the
 * rationale and the full multi-phase migration plan.
 */

export { aiSdkProvider } from './provider';
export type {
  AiSdkCredential,
  AiSdkProviderOptions,
  AiSdkVendor,
  CredentialResolver,
  ParsedModelSpec,
} from './types';
export { parseModelSpec, resolveModel } from './models';
export { buildToolSet } from './tools';
export type { AiSdkToolDescriptor, AiSdkToolSet } from './tools';
export { buildSandboxTools } from './sandbox-tools';
export { buildFlowlibActionTools } from './flowlib-action-tools';
export type {
  BuildFlowlibActionToolsOptions,
  DefaultCredentialForAction,
  GetCredentialFn,
} from './flowlib-action-tools';
