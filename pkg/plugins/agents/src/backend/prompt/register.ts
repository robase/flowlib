/**
 * `registerPromptComposer` — Stream K's subsystem registrar.
 *
 * Wires `composeSystemPrompt` into `ctx.registries.promptComposer` so
 * the agent service kernel (Stream A) and endpoints (Stream I) can
 * pull the composer at request time.
 *
 * The composer is stateless — we register the function reference
 * directly rather than constructing a singleton. Future versions may
 * inject configuration (per-tenant max sizes, custom persona
 * overrides) by replacing this with a factory.
 */

import type { PluginContext } from '../plugin-context';
import { composeSystemPrompt } from './compose';

/** Type alias for the registered composer — stable shape for consumers. */
export type PromptComposer = typeof composeSystemPrompt;

/**
 * Populate `ctx.registries.promptComposer` with the composer function.
 * Idempotent — called exactly once during plugin init.
 */
export function registerPromptComposer(ctx: PluginContext): void {
  ctx.registries.promptComposer = composeSystemPrompt as unknown;
  ctx.logger.info('[agents] prompt composer registered');
}
