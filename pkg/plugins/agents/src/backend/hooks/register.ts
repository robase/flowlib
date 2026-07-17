/**
 * `registerHooks` — installs the security hook pipeline onto
 * `ctx.registries.hookPipeline`, replacing the kernel's `noopHookPipeline`
 * default. The DO reads this slot when building each turn's
 * `SessionContext` (`runtime.hookPipeline ?? noopHookPipeline()`).
 *
 * Runs after `registerAudit` so it can pick up the audit writer. Note the
 * registry writer is a no-op until a DB-bound audit repository is wired
 * per-turn (the long-standing dormant-audit gap) — the security
 * enforcement is active regardless; only audit *persistence* waits on that.
 */

import type { PluginContext } from '../plugin-context';
import type { AuditWriter } from '../audit/writer';
import { DEFAULT_POST_HANDLERS, DEFAULT_PRE_HANDLERS } from './handlers';
import { createHookPipeline } from './pipeline';

export function registerHooks(ctx: PluginContext): void {
  const audit = ctx.registries.auditWriter as AuditWriter | undefined;
  const pipeline = createHookPipeline({
    pre: DEFAULT_PRE_HANDLERS,
    post: DEFAULT_POST_HANDLERS,
    ...(audit ? { audit } : {}),
    logger: ctx.logger,
  });
  ctx.registries.hookPipeline = pipeline;
  ctx.logger.info('[agents] hook pipeline registered', {
    pre: DEFAULT_PRE_HANDLERS.length,
    post: DEFAULT_POST_HANDLERS.length,
    auditWired: Boolean(audit),
  });
}
