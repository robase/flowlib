/**
 * `registerAudit` — Stream J's audit-writer registrar.
 *
 * Wires an `AuditWriter` onto `ctx.registries.auditWriter`. Called
 * once during plugin init by INT.
 *
 * Depends on `ctx.registries.repositories.audit` (Stream F). If the
 * audit repository isn't on the bag yet, we install a no-op writer
 * that logs at `warn` and discards events — this keeps Stream A / G
 * unblocked during incremental rollout (better to lose audit during
 * bootstrap than to crash the request path).
 */

import type { PluginContext } from '../plugin-context';
import {
  createWriter,
  type AuditRepository,
  type AuditWriter,
  type AuditWriterDeps,
} from './writer';

interface RepositoriesLike {
  audit?: AuditRepository;
}

/**
 * No-op writer used when the audit repository isn't available. Logs
 * at `warn` so missing repos surface during bootstrap, but never
 * throws — the audit path must not break the user-visible request.
 */
function createNoopWriter(logger: PluginContext['logger']): AuditWriter {
  return {
    async write(input) {
      logger.warn('[agents] audit event dropped — no audit repository registered', {
        eventType: input.eventType,
        sessionId: input.sessionId,
      });
      return null;
    },
  };
}

export function registerAudit(ctx: PluginContext): AuditWriter {
  const repos = ctx.registries.repositories as RepositoriesLike | undefined;
  const audit = repos?.audit;

  let writer: AuditWriter;
  if (!audit) {
    ctx.logger.warn(
      '[agents] registerAudit: no audit repository on ctx.registries.repositories — ' +
        'installing no-op writer. Stream F populates this bag during init; if you see this ' +
        'in production, the repositories registrar did not run before registerAudit.',
    );
    writer = createNoopWriter(ctx.logger);
  } else {
    writer = createAuditWriter({ audit, logger: ctx.logger });
  }

  ctx.registries.auditWriter = writer;
  ctx.logger.info('[agents] audit writer initialised', {
    fallback: !audit,
  });
  return writer;
}

/**
 * Functional factory exposed for callers that already hold the deps
 * directly (tests, alternative wiring).
 */
export function createAuditWriter(deps: AuditWriterDeps): AuditWriter {
  return createWriter(deps);
}
