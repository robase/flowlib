/**
 * Public option types for the AI SDK provider.
 *
 * The provider runs the agent loop *natively in the DO* using Vercel's
 * `ai` package's `streamText`, with tools dispatched out to the
 * Cloudflare Sandbox container (for filesystem ops) or to flowlib
 * actions (for connected systems). See
 * `pkg/plugins/agents/docs/migration-plan-ai-sdk.md` for the why.
 */

import type { CreateSessionInput } from '../types';
import type { WorkspaceHandle } from '../../workspaces/types';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { AiSdkToolSet } from './tools';

/**
 * Vendor identifier used inside a model id like `vendor/model-id`.
 * The model resolver maps this to the corresponding `@ai-sdk/*`
 * provider factory.
 *
 * - `anthropic` — first-party Anthropic
 * - `openai` — first-party OpenAI
 * - `openrouter` — multi-provider router
 * - `google` — Google Gemini
 *
 * Add new vendors here as we onboard more providers. The resolver in
 * `models.ts` throws on unknown vendors.
 */
export type AiSdkVendor = 'anthropic' | 'openai' | 'openrouter' | 'google';

/**
 * A normalised model specification — the result of parsing
 * `'anthropic/claude-sonnet-4-5'` style strings.
 */
export interface ParsedModelSpec {
  vendor: AiSdkVendor;
  /** The model id as the vendor's SDK expects it. */
  modelId: string;
  /** The raw input string for logging / round-tripping. */
  raw: string;
}

/**
 * Per-vendor credential shape. Mirrors what flowlib's credentials
 * service returns once decrypted — we don't bind to the credentials
 * service directly here (the orchestrator does the lookup; we receive
 * the resolved value).
 */
export interface AiSdkCredential {
  vendor: AiSdkVendor;
  apiKey: string;
  /** Optional override for the provider's base URL (gateway proxies, …). */
  baseUrl?: string;
  /** Free-form headers (e.g. OpenRouter app-attribution headers). */
  headers?: Record<string, string>;
}

/**
 * Factory function the orchestrator uses to resolve a credential for
 * a given (auth, credentialId, vendor) triple at session start.
 *
 * The host wires this up to flowlib's credentials service; tests pass
 * a literal `async () => ({ apiKey: 'sk-test' })`.
 */
export type CredentialResolver = (input: {
  auth: CreateSessionInput['auth'];
  credentialId?: string;
  vendor: AiSdkVendor;
}) => Promise<AiSdkCredential>;

/**
 * Per-vendor LanguageModel factory. The host wires one of these per
 * vendor it wants to support — usually a thin wrapper around the
 * corresponding `@ai-sdk/<vendor>` `create<Vendor>({ apiKey })(modelId)`.
 *
 * The return type is `unknown` here because the AI SDK's
 * `LanguageModelV2` type isn't available without the `ai` peer dep.
 * Callers cast at the boundary; `streamText` validates the shape.
 */
export type VendorModelFactory = (credential: AiSdkCredential, modelId: string) => unknown;

/**
 * Shape of Vercel AI SDK's `streamText` function. Kept fully loose
 * (`any` in / `any` out) because the `ai` package isn't imported here
 * — the host owns the static binding and passes its concrete
 * `streamText` directly. The provider uses only `fullStream` and
 * `usage` from the return value; we narrow at the consumer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StreamTextFn = (config: any) => any;

/**
 * Constructor options for `aiSdkProvider(...)`.
 *
 * Kept narrow on purpose — the heavy lifting (tool selection, message
 * conversion, abort wiring) lives inside the provider itself.
 */
export interface AiSdkProviderOptions {
  /**
   * Logical provider id used in DB rows + URLs. Defaults to
   * `'ai-sdk'`. Override to host multiple AI SDK providers with
   * different defaults side-by-side (e.g. `'ai-sdk-claude'` vs
   * `'ai-sdk-openai'`).
   */
  id?: string;

  /** Human label for the UI picker. */
  name?: string;

  /** Lucide icon name shown in the UI. */
  icon?: string;

  /**
   * Default model id, used when `POST /sessions` omits `model`. Same
   * `'vendor/model-id'` format as elsewhere — e.g.
   * `'anthropic/claude-sonnet-4-5'`.
   */
  defaultModel?: string;

  /**
   * Resolve credentials for an LLM call. The orchestrator calls this
   * once per session (the result is cached on the session) — pulled
   * fresh on each `prompt()` so OAuth refresh stays current.
   */
  resolveCredential: CredentialResolver;

  /**
   * Vercel AI SDK's `streamText` function. The host imports this
   * statically (`import { streamText } from 'ai'`) and wires it in.
   *
   * Why this is an option rather than a dynamic import: Cloudflare
   * Workers disallows runtime resolution of arbitrary module
   * specifiers (the bundler needs to know about every import at
   * build time). Passing the function in lets the host's bundler
   * handle the resolution statically while keeping `ai` an optional
   * peer of this package (hosts that don't use AI SDK don't need it).
   */
  streamText: StreamTextFn;

  /**
   * Per-vendor model factory functions, provided by the host. The
   * host statically imports the `@ai-sdk/<vendor>` packages it wants
   * and wires the factories here.
   *
   * Each factory takes a credential and a model id and returns a
   * `LanguageModelV2` instance ready for `streamText({ model })`.
   *
   * Example (host-side):
   *
   *   import { createAnthropic } from '@ai-sdk/anthropic';
   *   import { createOpenRouter } from '@openrouter/ai-sdk-provider';
   *
   *   aiSdkProvider({
   *     vendors: {
   *       anthropic: (cred, modelId) =>
   *         createAnthropic({ apiKey: cred.apiKey })(modelId),
   *       openrouter: (cred, modelId) =>
   *         createOpenRouter({ apiKey: cred.apiKey })(modelId),
   *     },
   *     ...
   *   });
   *
   * Sessions whose model spec targets a vendor missing from this map
   * fail with a clear "install + wire the vendor" error.
   */
  vendors: Partial<Record<AiSdkVendor, VendorModelFactory>>;

  /**
   * Maximum number of tool-call steps in a single turn. Hands directly
   * to `streamText({ maxSteps })`. Defaults to 25.
   */
  maxSteps?: number;

  /**
   * Tool names that are always denied regardless of per-session
   * configuration. Matches opencode provider's `defaultDenied`
   * semantics.
   */
  defaultDenied?: ReadonlyArray<string>;

  /**
   * Per-turn factory for additional tools beyond the built-in stubs.
   * Hosts typically pass `({ workspace }) => workspace ?
   * buildSandboxTools(workspace) : {}` from the sandbox-tools module.
   *
   * Called on each `prompt()` so tool sets can react to session
   * state (workspace presence, per-session permissions, etc.).
   * Returned tools merge into the catalogue on top of the stubs;
   * any name collision replaces the stub.
   *
   * The factory receives:
   *   - `workspace`: handle for the session's workspace, if any
   *   - `auth`: resolved auth context (org/user/role)
   *   - `sessionId`: the provider session id (placeholder format)
   */
  tools?: (input: {
    workspace?: WorkspaceHandle;
    auth: AgentsAuthContext;
    sessionId: string;
  }) => Promise<AiSdkToolSet> | AiSdkToolSet;
}
