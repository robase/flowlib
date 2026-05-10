/**
 * `registerWorkspaces` — Stream E's subsystem registrar.
 *
 * Populates `ctx.registries.workspaces` from the configured
 * `workspaceProvider` on the plugin options. Generic by design — it
 * registers whatever `WorkspaceProvider` the host passed in, not just
 * `cloudflareSandbox`. v1 ships only `cloudflare-sandbox`, but Mode A
 * (`local-fs`), Mode B (`git-clone`), Mode D (`remote-sandbox`), and the
 * `none` provider can all flow through the same registrar without
 * changes once they exist.
 *
 * Lives next to the cloudflare-sandbox provider rather than under
 * `workspaces/` because Stream E owns this sibling tree exclusively;
 * other workspace providers will add their own sibling folders, but
 * the registrar itself stays here so the wiring point is stable.
 *
 * The plugin's `workspaceProvider` is **optional** — raw-LLM agents
 * (post-v1) operate without a workspace, so omitting one is valid and
 * leaves the registry empty. INT (the consumer) decides whether agents
 * that require a workspace should error at create-time when the
 * registry is empty; that's not Stream E's job.
 */

import type { PluginContext } from '../../plugin-context';

/**
 * Register the workspace provider (if any) on the plugin's runtime
 * registries. Idempotent; safe to call multiple times during init.
 *
 * @param ctx Plugin context built by `plugin.ts`.
 */
export function registerWorkspaces(ctx: PluginContext): void {
  const provider = ctx.options.workspaceProvider;
  if (!provider) {
    ctx.logger.debug('[agents] registerWorkspaces: no workspaceProvider configured — skipping');
    return;
  }

  ctx.registries.workspaces.set(provider.id, provider);

  ctx.logger.info('[agents] workspace registry initialised', {
    id: provider.id,
    name: provider.name,
  });
}
