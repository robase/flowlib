/**
 * `registerWorkspaces` — Stream E's subsystem registrar.
 *
 * Populates `ctx.registries.workspaces` from every configured
 * `WorkspaceProvider` on the plugin options. Generic by design — it
 * registers whatever providers the host passed in, regardless of id.
 *
 * Multiple providers are supported so a deployment can host (for
 * example) both `cloudflareSandbox` (opencode image) and
 * `cloudflareSandboxClaude` (claude-code image) side by side. Each
 * persisted workspace row stores the provider id it was created with;
 * endpoints look up the right provider here at request time.
 *
 * The configured array is **optional** — raw-LLM agents (post-v1)
 * operate without a workspace, so an empty registry is valid. INT
 * (the consumer) decides whether agents that require a workspace
 * should error at create-time when the registry is empty.
 */

import type { PluginContext } from '../../plugin-context';

/**
 * Register every configured workspace provider on the plugin's runtime
 * registries. Idempotent; safe to call multiple times during init.
 * Throws when two providers share the same id — that would leave row
 * lookups ambiguous.
 *
 * @param ctx Plugin context built by `plugin.ts`.
 */
export function registerWorkspaces(ctx: PluginContext): void {
  const providers = ctx.options.workspaceProviders;
  if (!providers || providers.length === 0) {
    ctx.logger.debug('[agents] registerWorkspaces: no workspaceProviders configured — skipping');
    return;
  }

  for (const provider of providers) {
    if (ctx.registries.workspaces.has(provider.id)) {
      throw new Error(
        `[agents] duplicate workspace provider id ${JSON.stringify(provider.id)} — ` +
          `each workspaceProviders entry must have a unique id`,
      );
    }
    ctx.registries.workspaces.set(provider.id, provider);
  }

  ctx.logger.info('[agents] workspace registry initialised', {
    count: providers.length,
    ids: providers.map((p) => p.id),
  });
}
