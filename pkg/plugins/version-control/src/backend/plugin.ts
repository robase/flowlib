// =============================================================================
// Version Control Plugin — Main Entry Point
// =============================================================================

import type { FlowlibPlugin, FlowlibPluginDefinition, PluginEndpointContext } from '@flowlib/core';
import { createPluginDatabaseApi } from '@flowlib/core';

import type { VersionControlPluginOptions, VcEnvironment } from './types';
import { VC_SCHEMA } from './schema';
import { VcSyncService } from './sync-service';
import { ReconcilerService } from './reconciler';
import { InstanceStateService } from './instance-state';
import { StatusCacheService } from './status-compute';
import { EnvironmentResolver, PromotionService } from './promotion';
import { checkManifestAgainstInstance, type AggregateManifest } from './manifest';
import { isFlowMutation, isPluginOwnedPath, readOnlyResponse } from './read-only-gate';
import { BootstrapService, type BootstrapAction } from './bootstrap';
import { assessHardeningPosture } from './hardening';
import { configureSyncInputSchema, historyLimitSchema } from './validation';

/**
 * Create the Version Control plugin.
 *
 * Syncs Flowlib flows to a Git remote as readable `.flow.ts` files.
 *
 * ```ts
 * import { versionControl } from '@flowlib/version-control';
 * import { githubProvider } from '@flowlib/version-control/providers/github';
 *
 * new Flowlib({
 *   plugins: [
 *     versionControl({
 *       provider: githubProvider({ auth: { type: 'token', token: process.env.GITHUB_TOKEN! } }),
 *       repo: 'acme/workflows',
 *       mode: 'pr-per-publish',
 *     }),
 *   ],
 * });
 * ```
 */
export function versionControl(options: VersionControlPluginOptions): FlowlibPluginDefinition {
  const { frontend, ...backendOptions } = options;
  return {
    id: 'version-control',
    name: 'Version Control',
    backend: _vcBackendPlugin(backendOptions),
    frontend,
  };
}

function _vcBackendPlugin(options: Omit<VersionControlPluginOptions, 'frontend'>): FlowlibPlugin {
  let syncService: VcSyncService;
  let reconciler: ReconcilerService | null = null;
  let bootstrapService: BootstrapService | null = null;
  let pluginLogger: { debug: Function; info: Function; warn: Function; error: Function } = console;

  // Phase 1 — instance role + read-only gate.
  const environment: VcEnvironment = options.environment ?? 'dev';
  const isReadOnlyByDefault = environment === 'prod';
  const branch = options.defaultBranch ?? 'main';
  const instanceState = new InstanceStateService(options.repo, branch);
  // Phase 2 — chip materialization for dashboard reads.
  const statusCache = new StatusCacheService();
  // Phase 3 — promotion. Resolver + service are stateless aside from the
  // resolver's reference to plugin options, so they're constructed eagerly.
  const envResolver = new EnvironmentResolver(
    options.repo,
    options.promotionChain,
    options.environments,
  );
  const hardening = assessHardeningPosture({
    environment,
    providerId: options.provider.id,
    providerSecurity: options.provider.security,
    webhookSecretConfigured: Boolean(options.webhookSecret),
  });
  let promotionService: PromotionService | null = null;
  let getDb: (() => import('@flowlib/core').PluginDatabaseApi) | null = null;

  return {
    id: 'version-control',
    name: 'Version Control',

    schema: VC_SCHEMA,

    setupInstructions:
      'Run `npx flowlib-cli generate` then `npx flowlib-cli migrate` to create the flowlib_vc_sync_config, flowlib_vc_sync_history, and flowlib_vc_instance_state tables.',

    // =======================================================================
    // Initialization
    // =======================================================================

    init: async (ctx) => {
      pluginLogger = ctx.logger;
      syncService = new VcSyncService(options.provider, options, ctx.logger);

      // Capture the deferred DB accessor once — used by the reconciler,
      // the read-only hook, and the break-glass endpoints. `getFlowlib()`
      // may not be ready *during* init(), but it will be by first call time.
      getDb = () => createPluginDatabaseApi(ctx.getFlowlib().plugins.getDatabaseConnection());

      // Phase 0b — start the polling reconciler. This is the primary
      // correctness path: even if every webhook is dropped, the reconciler
      // converges the instance to the branch head within `intervalMs`.
      reconciler = new ReconcilerService({
        repo: options.repo,
        branch,
        path: options.path ?? 'workflows/',
        intervalMs: options.reconcilerIntervalMs ?? 30_000,
        logger: ctx.logger,
        provider: options.provider,
        syncService,
        getDb,
      });
      reconciler.start();

      // Phase 3 — promotion service. Stateless aside from `provider` +
      // `resolver`, but constructed here so it shares the plugin's logger.
      // `basePath` lets the service load the source-branch manifest for
      // PR-body enrichment (Phase 4).
      promotionService = new PromotionService(
        options.provider,
        envResolver,
        ctx.logger,
        options.path ?? 'workflows/',
      );

      // Phase 5 — bootstrap / first-time-use service. This is deliberately
      // endpoint-driven: we detect and act only when the operator opens the
      // wizard, never silently import or push flows on plugin init.
      bootstrapService = new BootstrapService({
        repo: options.repo,
        branch,
        path: options.path ?? 'workflows/',
        provider: options.provider,
        logger: ctx.logger,
      });

      ctx.logger.info(
        `Version control plugin initialized (env: ${environment}, provider: ${options.provider.id}, repo: ${options.repo}, branch: ${branch}, reconciler: ${(options.reconcilerIntervalMs ?? 30_000) / 1000}s, promotion: ${envResolver.isConfigured() ? 'configured' : 'disabled'})`,
      );
      if (isReadOnlyByDefault) {
        ctx.logger.info(
          'Production read-only mode active — flow mutations via the API will return 403 unless break-glass is open.',
        );
      }
      for (const warning of hardening.warnings) {
        ctx.logger.warn(`Version control hardening warning: ${warning}`);
      }
    },

    // =======================================================================
    // Shutdown
    // =======================================================================

    shutdown: () => {
      reconciler?.stop();
    },

    // =======================================================================
    // Endpoints
    // =======================================================================

    endpoints: [
      // -- Configure sync for a flow --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/configure',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const parsed = configureSyncInputSchema.safeParse(ctx.body);
          if (!parsed.success) {
            return { status: 400, body: { error: 'Invalid input', details: parsed.error.issues } };
          }
          const config = await syncService.configureSyncForFlow(ctx.database, flowId, parsed.data);
          return { status: 200, body: config };
        },
      },

      // -- Get sync status for a flow --
      {
        method: 'GET',
        path: '/vc/flows/:flowId/status',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const status = await syncService.getFlowSyncStatus(ctx.database, flowId);
          return { status: 200, body: { flowId, ...status } };
        },
      },

      // -- Disconnect sync for a flow --
      {
        method: 'DELETE',
        path: '/vc/flows/:flowId/disconnect',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          await syncService.disconnectFlow(ctx.database, flowId);
          return { status: 200, body: { success: true } };
        },
      },

      // -- Push (DB → remote) --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/push',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const identity = ctx.identity?.id;
          const result = await syncService.pushFlow(ctx.database, flowId, identity);
          return { status: result.success ? 200 : 409, body: result };
        },
      },

      // -- Pull (remote → DB) --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/pull',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const identity = ctx.identity?.id;
          const result = await syncService.pullFlow(ctx.database, flowId, identity);
          return { status: result.success ? 200 : 404, body: result };
        },
      },

      // -- Publish (pr-per-publish mode) --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/publish',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const identity = ctx.identity?.id;
          const result = await syncService.publishFlow(ctx.database, flowId, identity);
          return { status: result.success ? 200 : 400, body: result };
        },
      },

      // -- Force push (conflict resolution — DB wins) --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/force-push',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const identity = ctx.identity?.id;
          const result = await syncService.forcePushFlow(ctx.database, flowId, identity);
          return { status: 200, body: result };
        },
      },

      // -- Force pull (conflict resolution — remote wins) --
      {
        method: 'POST',
        path: '/vc/flows/:flowId/force-pull',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const identity = ctx.identity?.id;
          const result = await syncService.forcePullFlow(ctx.database, flowId, identity);
          return { status: result.success ? 200 : 404, body: result };
        },
      },

      // -- Bulk push all synced flows --
      {
        method: 'POST',
        path: '/vc/push-all',
        handler: async (ctx: PluginEndpointContext) => {
          const configs = await syncService.listSyncedFlows(ctx.database);
          const identity = ctx.identity?.id;
          const results = [];
          for (const config of configs) {
            if (!config.enabled) {
              continue;
            }
            try {
              const result = await syncService.pushFlow(ctx.database, config.flowId, identity);
              results.push({ flowId: config.flowId, flowName: config.flowName, ...result });
            } catch (err) {
              results.push({
                flowId: config.flowId,
                flowName: config.flowName,
                success: false,
                error: (err as Error).message,
                action: 'push' as const,
              });
            }
          }
          return { status: 200, body: { results } };
        },
      },

      // -- Bulk pull all synced flows --
      {
        method: 'POST',
        path: '/vc/pull-all',
        handler: async (ctx: PluginEndpointContext) => {
          const configs = await syncService.listSyncedFlows(ctx.database);
          const identity = ctx.identity?.id;
          const results = [];
          for (const config of configs) {
            if (!config.enabled) {
              continue;
            }
            try {
              const result = await syncService.pullFlow(ctx.database, config.flowId, identity);
              results.push({ flowId: config.flowId, flowName: config.flowName, ...result });
            } catch (err) {
              results.push({
                flowId: config.flowId,
                flowName: config.flowName,
                success: false,
                error: (err as Error).message,
                action: 'pull' as const,
              });
            }
          }
          return { status: 200, body: { results } };
        },
      },

      // -- Webhook receiver --
      {
        method: 'POST',
        path: '/vc/webhook',
        isPublic: true,
        handler: async (ctx: PluginEndpointContext) => {
          if (!options.webhookSecret) {
            return { status: 400, body: { error: 'Webhook secret not configured' } };
          }

          // Verify signature
          const signature = ctx.headers['x-hub-signature-256'] ?? '';
          const body = JSON.stringify(ctx.body);
          if (
            !(await options.provider.verifyWebhookSignature(body, signature, options.webhookSecret))
          ) {
            return { status: 401, body: { error: 'Invalid webhook signature' } };
          }

          // Handle PR merge events: clear the local PR bookkeeping
          // (active_pr_number, draft_branch, history). The actual content
          // sync — pulling the merged file content into the DB — is the
          // reconciler's job, triggered below.
          const action = (ctx.body as Record<string, unknown>).action;
          const pullRequest = (ctx.body as Record<string, unknown>).pull_request as
            | { merged: boolean; number: number }
            | undefined;

          if (action === 'closed' && pullRequest?.merged) {
            await handlePrMerged(ctx.database, pullRequest.number);
          }

          // Phase 0b — wake the reconciler so the new branch head propagates
          // immediately rather than on the next interval tick. The webhook
          // payload's SHA is intentionally NOT trusted: the reconciler always
          // re-fetches `branch.commit.sha` to handle squash-merges, rebases,
          // and webhook reordering uniformly.
          if (reconciler) {
            // Fire-and-forget; tick records its own errors. Don't make the
            // webhook responder wait on potentially slow git operations.
            reconciler.triggerOutOfCycle().catch((err) => {
              pluginLogger.error('reconciler webhook trigger failed', {
                error: (err as Error).message,
              });
            });
          }

          return { status: 200, body: { received: true } };
        },
      },

      // -- Operator health check --
      //
      // Surfaces reconciler status + environment + active break-glass so
      // an operator can tell at a glance: am I on dev/staging/prod, is sync
      // healthy, and is anyone currently allowed to write to prod?
      // Phase 5 will extend this with webhook stats and per-flow lag.
      {
        method: 'GET',
        path: '/vc/health',
        handler: async (ctx: PluginEndpointContext) => {
          const health = reconciler?.getHealth() ?? {
            enabled: false,
            intervalMs: 0,
            inFlight: false,
            lastTickAt: null,
            lastTickStatus: null,
            lastTickError: null,
            lastInstanceCommitSha: null,
          };
          const breakGlass = await instanceState.getActiveBreakGlass(ctx.database);
          const cachedStatuses = await statusCache.listCached(ctx.database);
          const dirty = await statusCache.listDirty(ctx.database);
          const conflictCount = cachedStatuses.filter((entry) =>
            ['diverged', 'conflict-pending', 'stale-sha', 'error'].includes(entry.state),
          ).length;
          const syncLagSeconds = health.lastTickAt
            ? Math.max(0, Math.floor((Date.now() - Date.parse(health.lastTickAt)) / 1000))
            : null;
          const lagThresholdSeconds = Math.max(
            120,
            Math.ceil((health.intervalMs || 30_000) / 1000) * 4,
          );
          const errors = health.lastTickError ? [health.lastTickError] : [];
          return {
            status: 200,
            body: {
              environment,
              readOnly: isReadOnlyByDefault && !breakGlass,
              breakGlass,
              reconciler: health,
              dirtyCount: dirty.length,
              conflictCount,
              syncLagSeconds,
              lagThresholdSeconds,
              unhealthy:
                errors.length > 0 ||
                (syncLagSeconds !== null && syncLagSeconds > lagThresholdSeconds),
              errors,
              webhooks: {
                primary: false,
                secretConfigured: hardening.webhooks.secretConfigured,
                secretRequired: hardening.webhooks.secretRequired,
                ok: hardening.webhooks.ok,
                note: 'Webhook delivery is a wake-up signal; the polling reconciler is authoritative.',
              },
              hardening,
              queueDepth: null,
            },
          };
        },
      },

      // -- Bootstrap wizard state --
      //
      // Inspects repo + DB and returns one of the PLAN.md §7 scenarios:
      // empty-repo, fresh-deploy, reconcile, foreign-repo, or
      // already-bootstrapped. No side effects.
      {
        method: 'GET',
        path: '/vc/bootstrap',
        handler: async (ctx: PluginEndpointContext) => {
          if (!bootstrapService) {
            return { status: 503, body: { error: 'Bootstrap service not initialized' } };
          }
          const detection = await bootstrapService.detect(ctx.database);
          return { status: 200, body: detection };
        },
      },

      // -- Resolve bootstrap --
      //
      // Body: `{ action: 'hydrate' | 'merge' | 'push-all' | 'refuse',
      // commitMessage?: string }`. `hydrate` is the fresh-prod path;
      // `push-all` delegates to the atomic batch push primitive; `merge`
      // names the not-yet-built reconciliation UI rather than pretending
      // to resolve conflicts automatically.
      {
        method: 'POST',
        path: '/vc/bootstrap/resolve',
        handler: async (ctx: PluginEndpointContext) => {
          if (!bootstrapService) {
            return { status: 503, body: { error: 'Bootstrap service not initialized' } };
          }
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const action = typeof body.action === 'string' ? body.action : null;
          if (!action || !['hydrate', 'merge', 'push-all', 'refuse'].includes(action)) {
            return {
              status: 400,
              body: {
                error: "action must be one of 'hydrate', 'merge', 'push-all', or 'refuse'",
              },
            };
          }

          const detection = await bootstrapService.detect(ctx.database);
          const actor = ctx.identity?.id ?? null;

          if (action === 'hydrate') {
            const result = await bootstrapService.hydrate(ctx.database, detection, actor);
            return { status: result.status === 'error' ? 500 : 200, body: result };
          }

          if (action === 'merge') {
            return { status: 501, body: bootstrapService.notImplementedMerge() };
          }

          if (action === 'refuse') {
            const result = await bootstrapService.refuse(ctx.database, detection, actor);
            return { status: 200, body: result };
          }

          const flowRows = await ctx.database.query<{ id: string }>('SELECT id FROM flowlib_flows');
          if (flowRows.length === 0) {
            return {
              status: 200,
              body: {
                action: 'push-all' satisfies BootstrapAction,
                status: 'success',
                flowsAffected: 0,
                lastInstanceCommitSha: detection.branchSha,
                message: 'No local flows to push.',
              },
            };
          }

          const commitMessage =
            typeof body.commitMessage === 'string' && body.commitMessage.trim().length > 0
              ? body.commitMessage
              : 'chore(flow): bootstrap push all flows';
          const push = await syncService.pushFlowsAtomic(
            ctx.database,
            flowRows.map((row) => row.id),
            { commitMessage, identity: actor ?? undefined },
          );
          if (!push.success) {
            return {
              status: 400,
              body: {
                action: 'push-all' satisfies BootstrapAction,
                status: 'error',
                message: push.error,
                errors: push.results
                  .filter((result) => result.status === 'error')
                  .map((result) => ({
                    path: result.filePath ?? result.flowId,
                    error: result.error ?? 'Unknown error',
                  })),
              },
            };
          }

          const branchInfo = await options.provider.getBranch(options.repo, branch);
          const finalSha = branchInfo?.sha ?? push.commitSha ?? detection.branchSha;
          if (finalSha) {
            await bootstrapService.finalizePushAll(ctx.database, finalSha);
          }
          return {
            status: 200,
            body: {
              action: 'push-all' satisfies BootstrapAction,
              status: push.results.some((result) => result.status === 'error')
                ? 'partial'
                : 'success',
              flowsAffected: push.results.filter((result) => result.status === 'pushed').length,
              errors: push.results
                .filter((result) => result.status === 'error')
                .map((result) => ({
                  path: result.filePath ?? result.flowId,
                  error: result.error ?? 'Unknown error',
                })),
              lastInstanceCommitSha: finalSha,
            },
          };
        },
      },

      // -- Break-glass: open the prod write window --
      //
      // Time-boxed override for emergencies. The actor + reason are
      // recorded on the instance state row and surfaced in /vc/health, so
      // every minute the window is open, "who opened it and why" is
      // visible to any operator. Closing happens automatically when the
      // expiry timestamp passes; DELETE /vc/break-glass closes early.
      {
        method: 'POST',
        path: '/vc/break-glass',
        handler: async (ctx: PluginEndpointContext) => {
          if (!isReadOnlyByDefault) {
            return {
              status: 400,
              body: { error: 'Break-glass is only meaningful on prod instances' },
            };
          }
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const minutes = Number(body.durationMinutes);
          if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
            return {
              status: 400,
              body: { error: 'durationMinutes must be a positive number ≤ 1440 (24h)' },
            };
          }
          const reason = typeof body.reason === 'string' ? body.reason : null;
          if (!reason || reason.trim().length === 0) {
            return {
              status: 400,
              body: { error: 'reason is required for audit' },
            };
          }
          const until = new Date(Date.now() + minutes * 60_000).toISOString();
          await instanceState.openBreakGlass(ctx.database, {
            until,
            actor: ctx.identity?.id ?? null,
            reason,
          });
          pluginLogger.warn('Break-glass window opened on prod', {
            until,
            actor: ctx.identity?.id ?? null,
            reason,
          });
          return { status: 200, body: { until, actor: ctx.identity?.id ?? null, reason } };
        },
      },

      // -- Break-glass: close the window early --
      {
        method: 'DELETE',
        path: '/vc/break-glass',
        handler: async (ctx: PluginEndpointContext) => {
          await instanceState.closeBreakGlass(ctx.database);
          pluginLogger.info('Break-glass window closed', {
            actor: ctx.identity?.id ?? null,
          });
          return { status: 200, body: { closed: true } };
        },
      },

      // ============================================================
      // Phase 2 — Status & batch push
      // ============================================================

      // -- All flow chips for the dashboard --
      //
      // Reads from the materialized cache. Reconciler refreshes the cache
      // every tick; this endpoint is a single SELECT regardless of flow
      // count. Frontend renders a chip per row.
      {
        method: 'GET',
        path: '/vc/flows-status',
        handler: async (ctx: PluginEndpointContext) => {
          const entries = await statusCache.listCached(ctx.database);
          return { status: 200, body: { flows: entries } };
        },
      },

      // -- Single flow's chip --
      //
      // Lazy fallthrough: if the cache hasn't been populated yet (first
      // load, or pre-Phase-2 instance freshly upgraded), return null and
      // let the client either wait for the next reconciler tick or call
      // POST /vc/reconcile to force one.
      {
        method: 'GET',
        path: '/vc/flows/:flowId/chip',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const entry = await statusCache.getCached(ctx.database, flowId);
          return { status: 200, body: { flowId, chip: entry } };
        },
      },

      // -- Dirty list for the "N unpushed changes" modal --
      //
      // Computed live (not cached) because the modal is interactive: the
      // user opens it, makes a selection, hits Sync. Stale-by-30s cache
      // would surface flows that have already been pushed in another tab.
      {
        method: 'GET',
        path: '/vc/dirty',
        handler: async (ctx: PluginEndpointContext) => {
          const dirty = await statusCache.listDirty(ctx.database);
          return { status: 200, body: { count: dirty.length, flows: dirty } };
        },
      },

      // -- Sync activity feed --
      //
      // Recent push / pull / PR / conflict entries across all flows. This
      // backs the Phase 5 SyncActivityPage and doubles as an operator audit
      // surface while the richer frontend is still deferred.
      {
        method: 'GET',
        path: '/vc/activity',
        handler: async (ctx: PluginEndpointContext) => {
          const limit = historyLimitSchema.parse(ctx.query.limit);
          const rows = await ctx.database.query<{
            flow_id: string;
            flow_name: string | null;
            file_path: string | null;
            action: string;
            commit_sha: string | null;
            pr_number: number | null;
            version: number | null;
            message: string | null;
            created_at: string;
            created_by: string | null;
          }>(
            `SELECT
               h.flow_id,
               f.name AS flow_name,
               c.file_path,
               h.action,
               h.commit_sha,
               h.pr_number,
               h.version,
               h.message,
               h.created_at,
               h.created_by
             FROM flowlib_vc_sync_history h
             LEFT JOIN flowlib_flows f ON f.id = h.flow_id
             LEFT JOIN flowlib_vc_sync_config c ON c.flow_id = h.flow_id
             ORDER BY h.created_at DESC
             LIMIT ?`,
            [limit],
          );
          return {
            status: 200,
            body: {
              activity: rows.map((row) => ({
                flowId: row.flow_id,
                flowName: row.flow_name,
                filePath: row.file_path,
                action: row.action,
                commitSha: row.commit_sha,
                prNumber: row.pr_number,
                version: row.version,
                message: row.message,
                createdAt: row.created_at,
                createdBy: row.created_by,
              })),
            },
          };
        },
      },

      // -- Atomic batch push (POST /vc/push) --
      //
      // Wires the `pushFlowsAtomic` primitive from Phase 0c into a single
      // HTTP call. Body shape: `{ flowIds: string[], commitMessage: string }`.
      // Returns the per-flow result table from BatchPushResult so the
      // dirty-list modal can render "3 pushed, 0 errors" with detail.
      //
      // Status code: 200 on full success, 207 on partial (some flows had
      // pre-flight errors but a commit landed for the rest), 409 on stale
      // head, 400 on invalid input.
      {
        method: 'POST',
        path: '/vc/push',
        handler: async (ctx: PluginEndpointContext) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const flowIds = Array.isArray(body.flowIds) ? body.flowIds : null;
          const commitMessage = typeof body.commitMessage === 'string' ? body.commitMessage : null;
          if (!flowIds || flowIds.length === 0 || !flowIds.every((id) => typeof id === 'string')) {
            return {
              status: 400,
              body: { error: 'flowIds must be a non-empty array of strings' },
            };
          }
          if (!commitMessage || commitMessage.trim().length === 0) {
            return {
              status: 400,
              body: { error: 'commitMessage is required' },
            };
          }

          const result = await syncService.pushFlowsAtomic(ctx.database, flowIds as string[], {
            commitMessage,
            identity: ctx.identity?.id,
          });

          // Refresh the chip cache so the dirty-list modal closes onto a
          // fresh dashboard. Best-effort: a failure here doesn't fail the
          // push response.
          try {
            await statusCache.refreshAll(ctx.database);
          } catch (err) {
            pluginLogger.warn('Status cache refresh after batch push failed', {
              error: (err as Error).message,
            });
          }

          let status = 200;
          if (!result.success) {
            // Map the error class to a useful HTTP status.
            status = /branch advanced|stale parent/i.test(result.error ?? '')
              ? 409
              : /contention|in progress/i.test(result.error ?? '')
                ? 423 // Locked
                : 400;
          } else if (result.results.some((r) => r.status === 'error')) {
            status = 207; // Multi-Status: commit landed but some flows had errors
          }
          return { status, body: result };
        },
      },

      // ============================================================
      // Phase 4 — Manifest contract
      // ============================================================

      // -- Check a manifest against this instance's credentials --
      //
      // Body: `{ manifest: AggregateManifest }`. Returns per-credential
      // satisfaction (does a credential by that name exist?) plus the
      // missing subset for UI summaries.
      //
      // v1: advisory only. The endpoint reports missing creds; gating
      // the merge is a CI concern (`flowlib check` CLI — deferred).
      //
      // The manifest body shape is validated structurally — invalid
      // shapes return 400 rather than throwing. Forward compatibility:
      // unknown top-level keys are ignored so future extensions don't
      // break older instances exposing this endpoint.
      {
        method: 'POST',
        path: '/vc/check',
        handler: async (ctx: PluginEndpointContext) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const manifest = body.manifest as AggregateManifest | undefined;
          if (
            !manifest ||
            typeof manifest !== 'object' ||
            !manifest.flows ||
            typeof manifest.flows !== 'object' ||
            manifest.version !== 1
          ) {
            return {
              status: 400,
              body: {
                error:
                  'manifest is required and must be the AggregateManifest shape (version: 1, flows: {})',
              },
            };
          }

          const result = await checkManifestAgainstInstance(ctx.database, manifest);
          // Status: 200 with `ok: false` body when something's missing —
          // the request itself succeeded; the manifest is the data being
          // queried. CI tools translate `ok: false` to a non-zero exit.
          return { status: 200, body: result };
        },
      },

      // ============================================================
      // Phase 3 — Promotion
      // ============================================================

      // -- Open a cross-branch PR for promotion --
      //
      // Body: `{ targetEnv: string, sourceEnv?: string, titleOverride?, bodyOverride? }`.
      // Defaults `sourceEnv` to the instance's configured environment.
      //
      // Status mapping:
      //   200 — PR opened (status: 'pr-opened')
      //   200 — Nothing to promote (status: 'nothing-to-promote')
      //         200 here because the call succeeded; the response body
      //         carries the no-op signal so the UI can show "in sync".
      //   400 — Invalid env / cross-repo / not configured
      //   502 — Provider error opening the PR
      {
        method: 'POST',
        path: '/vc/promote',
        handler: async (ctx: PluginEndpointContext) => {
          if (!promotionService) {
            return {
              status: 503,
              body: { error: 'Promotion service not initialized' },
            };
          }
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const targetEnv = typeof body.targetEnv === 'string' ? body.targetEnv : null;
          if (!targetEnv) {
            return {
              status: 400,
              body: { error: 'targetEnv is required' },
            };
          }
          const sourceEnv = typeof body.sourceEnv === 'string' ? body.sourceEnv : undefined;
          const titleOverride =
            typeof body.titleOverride === 'string' ? body.titleOverride : undefined;
          const bodyOverride =
            typeof body.bodyOverride === 'string' ? body.bodyOverride : undefined;

          const result = await promotionService.promote(ctx.database, {
            sourceEnv,
            targetEnv,
            titleOverride,
            bodyOverride,
            identity: ctx.identity?.id,
            // Default to the instance's own env when caller doesn't override.
            // Promotion from prod is unusual but legal in v1 — the resolver
            // will reject if prod isn't in promotionChain.
            defaultSourceEnv: environment,
          });

          let status = 200;
          if (result.status === 'invalid-env' || result.status === 'cross-repo-not-supported') {
            status = 400;
          } else if (result.status === 'branch-not-found') {
            status = 404;
          } else if (result.status === 'error') {
            status = 502;
          }
          // 'pr-opened' and 'nothing-to-promote' both stay 200 — both
          // represent successful invocations; the UI branches on `status`.
          return { status, body: result };
        },
      },

      // -- Manual reconciler trigger --
      //
      // Admin escape hatch: if a webhook was missed and the operator
      // doesn't want to wait for the next interval, this fires a tick
      // immediately. Returns the tick result so the operator can see
      // what happened (no-op / advanced / error).
      {
        method: 'POST',
        path: '/vc/reconcile',
        handler: async () => {
          if (!reconciler) {
            return { status: 503, body: { error: 'Reconciler not initialized' } };
          }
          const result = await reconciler.tick('manual');
          return { status: 200, body: result };
        },
      },

      // -- List all synced flows --
      {
        method: 'GET',
        path: '/vc/flows',
        handler: async (ctx: PluginEndpointContext) => {
          const flows = await syncService.listSyncedFlows(ctx.database);
          return { status: 200, body: { flows } };
        },
      },

      // -- Get sync history for a flow --
      {
        method: 'GET',
        path: '/vc/flows/:flowId/history',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          const limit = historyLimitSchema.parse(ctx.query.limit);
          const history = await syncService.getSyncHistory(ctx.database, flowId, limit);
          return { status: 200, body: { flowId, history } };
        },
      },

      // -- Get local-vs-remote diff for conflict resolution --
      {
        method: 'GET',
        path: '/vc/flows/:flowId/diff',
        handler: async (ctx: PluginEndpointContext) => {
          const { flowId } = ctx.params;
          try {
            const diff = await syncService.getFlowDiff(ctx.database, flowId);
            return { status: 200, body: diff };
          } catch (err) {
            const message = (err as Error).message;
            const status = /not connected|not found|No versions/i.test(message) ? 404 : 500;
            return { status, body: { error: message } };
          }
        },
      },
    ],

    // =======================================================================
    // Hooks
    // =======================================================================

    // NOTE: Remote cleanup on flow deletion (deleting the file from GitHub,
    // closing active PRs, removing draft branches) requires calling
    // DELETE /vc/flows/:flowId/disconnect before deleting the flow.
    // DB records (vc_sync_config, vc_sync_history) cascade-delete via FK.
    // The plugin hook system does not provide database access in onRequest,
    // so automatic remote cleanup on flow delete is not possible via hooks.
    hooks: {
      /**
       * Phase 1 — production read-only gate.
       *
       * On a `prod` instance, mutating verbs (POST/PUT/PATCH/DELETE) on
       * flow-content paths return 403 unless an active break-glass window
       * is open. Pull writes don't pass through this hook because the
       * reconciler operates server-side (no inbound HTTP), so this gate
       * only catches user-initiated edits.
       *
       * Known gap (deferred): internal service-layer writes (chat
       * assistant, agent flows mutating other flows) bypass this hook.
       * Closing that requires `beforeFlowMutation` on FlowsService — a
       * core PR. For Phase 1 the HTTP gate is acceptance-criteria-passing
       * and ships in isolation.
       */
      onRequest: !isReadOnlyByDefault
        ? undefined
        : async (_request, context) => {
            // Allow the plugin's own surface — push, pull, status,
            // break-glass, webhooks. None of these are flow-content edits
            // even though some use mutating verbs.
            if (isPluginOwnedPath(context.path)) {
              return;
            }

            if (!isFlowMutation(context.method, context.path)) {
              return;
            }

            // Check for an active break-glass window. The reads happen
            // here (per-request) rather than being cached, because windows
            // are short-lived and rare; the cost is one query per request
            // on the hot mutation paths only.
            try {
              if (getDb) {
                const window = await instanceState.getActiveBreakGlass(getDb());
                if (window) {
                  pluginLogger.warn('Break-glass mutation allowed on prod', {
                    method: context.method,
                    path: context.path,
                    actor: context.identity?.id ?? null,
                    breakGlassUntil: window.until,
                    breakGlassActor: window.actor,
                  });
                  return; // allow through
                }
              }
            } catch (err) {
              // If the break-glass check itself fails, fail CLOSED — the
              // safe default for prod is "no writes". Operators surface
              // this via /vc/health.
              pluginLogger.error('Break-glass check failed; falling back to read-only', {
                error: (err as Error).message,
              });
            }

            return {
              response: readOnlyResponse(
                'This is a production instance. Edit on dev and promote via PR.',
                'Open a break-glass window via POST /vc/break-glass to override.',
              ),
            };
          },
    },
  };

  // =========================================================================
  // Webhook handlers (internal)
  // =========================================================================

  async function handlePrMerged(
    db: import('@flowlib/core').PluginDatabaseApi,
    prNumber: number,
  ): Promise<void> {
    // Find the sync config with this active PR — read draft_branch BEFORE clearing it
    const rows = await db.query<{
      flow_id: string;
      draft_branch: string | null;
      repo: string;
    }>(
      'SELECT flow_id, draft_branch, repo FROM flowlib_vc_sync_config WHERE active_pr_number = ?',
      [prNumber],
    );

    for (const row of rows) {
      // Try to clean up the draft branch before clearing the reference
      if (row.draft_branch) {
        try {
          await options.provider.deleteBranch(row.repo, row.draft_branch);
        } catch {
          // Branch may already be deleted by the merge
        }
      }

      // Clear PR state, update sync status
      await db.execute(
        `UPDATE flowlib_vc_sync_config
         SET active_pr_number = NULL, active_pr_url = NULL, draft_branch = NULL, updated_at = ?
         WHERE flow_id = ?`,
        [new Date().toISOString(), row.flow_id],
      );

      // Record history
      await db.execute(
        `INSERT INTO flowlib_vc_sync_history (id, flow_id, action, pr_number, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          row.flow_id,
          'pr-merged',
          prNumber,
          `PR #${prNumber} merged`,
          new Date().toISOString(),
        ],
      );

      pluginLogger.info('PR merged — sync updated', { flowId: row.flow_id, prNumber });
    }
  }
}
