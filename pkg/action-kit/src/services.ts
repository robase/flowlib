/**
 * Structural interfaces for the handful of host services actions rely on
 * (via `LoadOptionsContext` / `ActionConfigUpdateContext`).
 *
 * These are intentionally minimal — only the methods an action's
 * `loadOptions.handler` or `onConfigUpdate` actually call appear here.
 * Concrete implementations (CredentialsService, BaseAIClient) live in
 * `@flowlib/core` and satisfy these structurally.
 */

import type { ActionCredential } from './action-credential';

/**
 * Minimal credentials-service surface available to dynamic-config handlers.
 */
export interface ActionCredentialsService {
  /** Fetch a credential with non-secret fields populated. */
  get(credentialId: string): Promise<ActionCredential | null>;
  /**
   * Fetch a credential with decrypted config. Used by load-options handlers
   * (e.g. listing models for a provider) that need API keys.
   */
  getDecrypted(credentialId: string): Promise<ActionCredential | null>;
}

/**
 * Minimal AI-client surface available to `onConfigUpdate` handlers.
 */
export interface ActionAIClient {
  hasAdapter(provider: string): boolean;
  registerAdapter(label: string, apiKey: string): void;
  listModelsForProvider(provider: string): Promise<unknown>;
}
