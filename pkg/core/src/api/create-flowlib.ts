/**
 * createFlowlib() — Single async factory that returns a fully initialized FlowlibInstance.
 *
 * Replaces the two-phase `new Flowlib(config)` → `await initialize()` pattern.
 * The returned object is guaranteed to be ready for use — no initialization checks needed.
 */

import { ServiceFactory } from '../services/service-factory';
import { FlowlibConfig, FlowlibConfigSchema } from '../schemas';
import { DatabaseError } from '../types/common/errors.types';
import { LoggerManager, type ScopedLoggingConfig } from '../utils/logger';
import { getTemplateService } from '../services/templating/template.service';
import type { TemplateService } from '../services/templating/template.service';
import {
  JsExpressionService,
  type JsExpressionService as JsExpressionServiceType,
} from '../services/templating/js-expression.service';
import { PluginManager } from '../services/plugin-manager';
import type { FlowlibPlugin, FlowlibPluginDefinition } from '../types/plugin.types';
import { AuthorizationService, createAuthorizationService } from '../services/auth';
import { ActionRegistry, initializeGlobalActionRegistry } from '@flowlib/actions/registry';
import { allProviderActions } from '@flowlib/actions';
import type { CredentialAuthType } from '@flowlib/db';

import type { FlowlibInstance, FlowlibMaintenanceOptions, FlowlibMaintenanceResult } from './types';
import { createFlowsAPI } from './flows';
import { createFlowVersionsAPI } from './flow-versions';
import { createFlowRunsAPI } from './flow-runs';
import { createCredentialsAPI } from './credentials';
import { createTriggersAPI } from './triggers';
import { createAgentAPI } from './agent';
import { createChatAPI } from './chat';
import { createActionsAPI } from './actions';
import { createTestingAPI } from './testing';
import { createAuthAPI } from './auth';
import { createPluginsAPI } from './plugins';
import { createMaintenanceAPI } from './maintenance';
import { createSettingsAPI } from './settings';
import { buildCoreSettingsDescriptors } from './core-settings-descriptor';

/**
 * Seed default credentials (non-blocking helper).
 */
async function seedDefaultCredentials(sf: ServiceFactory, config: FlowlibConfig): Promise<void> {
  const seeds = config.defaultCredentials;
  if (!seeds?.length) {
    return;
  }

  const credentialsService = sf.getCredentialsService();
  const existing = await credentialsService.list();
  const existingByName = new Map(existing.map((c) => [c.name, c]));

  for (const seed of seeds) {
    try {
      const { provider, ...rest } = seed;
      const metadata = { ...rest.metadata, ...(provider ? { provider } : {}) };
      const existingCred = existingByName.get(seed.name);

      if (existingCred) {
        try {
          // For OAuth2 credentials, merge the seed config with the existing
          // config so that tokens obtained during authorization are preserved.
          let mergedConfig = rest.config;
          if (rest.authType === 'oauth2') {
            const existingDecrypted = await credentialsService.get(existingCred.id);
            const existingConfig = existingDecrypted.config ?? {};
            mergedConfig = { ...existingConfig, ...rest.config };
          }

          await credentialsService.update(existingCred.id, {
            name: rest.name,
            type: rest.type,
            authType: rest.authType as CredentialAuthType,
            config: mergedConfig,
            description: rest.description,
            isShared: rest.isShared,
            metadata,
          });
          config.logger.debug(`Upserted credential "${seed.name}" (${existingCred.id})`);
        } catch {
          // Decryption failure (e.g. encryption key changed) — delete and recreate
          config.logger.warn(
            `Failed to update credential "${seed.name}", recreating with current encryption key`,
          );
          try {
            await credentialsService.forceDelete(existingCred.id);
          } catch {
            // best-effort delete
          }
          const created = await credentialsService.create({
            name: rest.name,
            type: rest.type,
            authType: rest.authType as CredentialAuthType,
            config: rest.config,
            description: rest.description,
            isShared: rest.isShared,
            metadata,
          });
          // eslint-disable-next-line no-console
          console.log(`🔐 Re-seeded credential: ${created.name} (${created.id})`);
        }
      } else {
        const created = await credentialsService.create({
          name: rest.name,
          type: rest.type,
          authType: rest.authType as CredentialAuthType,
          config: rest.config,
          description: rest.description,
          isShared: rest.isShared,
          metadata,
        });
        // eslint-disable-next-line no-console
        console.log(`🔐 Seeded credential: ${created.name} (${created.id})`);
      }
    } catch (error) {
      config.logger.warn(`Failed to upsert credential "${seed.name}"`, error);
    }
  }
}

/**
 * Create a fully initialized Flowlib instance.
 *
 * This is the recommended way to create an Flowlib instance. Unlike `new Flowlib(config)`,
 * the returned object is guaranteed to be fully initialized and ready for use.
 *
 * @example
 * ```typescript
 * const flowlib = await createFlowlib({
 *   database: { type: 'sqlite', connectionString: 'file:./dev.db' },
 * });
 *
 * const flow = await flowlib.flows.create({ name: 'My Flow' });
 * const result = await flowlib.runs.start(flow.id, { input: 'hello' });
 *
 * await flowlib.shutdown();
 * ```
 */
export async function createFlowlib(config: FlowlibConfig): Promise<FlowlibInstance> {
  const initStart = Date.now();
  // Parse and validate config. Cast back to `FlowlibConfig` because the
  // `services` block is typed as `unknown` in the Zod schema (adapter
  // instances aren't validatable) but `FlowlibConfig` overlays the typed
  // `FlowlibServiceOverrides` shape — so the parsed object is structurally
  // a strict subset of the input type.
  const parsedConfig = FlowlibConfigSchema.parse(config) as FlowlibConfig;

  // Explicit opt-in skip — host (e.g. framework adapter) is responsible for
  // setting this flag. Core does not sniff the environment.
  if (parsedConfig.skipDatabaseInit) {
    throw new DatabaseError('Flowlib Core initialization skipped (skipDatabaseInit=true)', {
      reason: 'build_time_skip',
    });
  }

  // Initialize logger
  const loggingConfig: ScopedLoggingConfig = {
    level: parsedConfig.logging?.level || 'info',
    scopes: parsedConfig.logging?.scopes,
  };
  const loggerManager = new LoggerManager(loggingConfig);
  parsedConfig.logger = loggerManager.getBasicLogger();
  const logger = parsedConfig.logger;

  logger.info('Initializing Flowlib Core...', {
    databaseType: parsedConfig.database?.type,
    hasConnectionString: !!parsedConfig.database?.connectionString,
    pluginCount: parsedConfig.plugins?.length ?? 0,
  });

  try {
    // Initialize authorization service. Pass `parsedConfig.auth` through so
    // RBAC settings (`enabled`, `roleMapper`, `customRoles`, `customAuthorize`,
    // `publicRoutes`, `defaultRole`) declared in `FlowlibConfig.auth` actually
    // reach the service. Previously this was instantiated with `{ logger }`
    // only — the `auth` field on `FlowlibConfig` had no effect.
    const authService: AuthorizationService = createAuthorizationService({
      config: (parsedConfig as { auth?: import('../types/auth.types').FlowlibAuthConfig }).auth,
      logger,
    });

    // Initialize plugin manager — extract backend plugins from unified definitions
    const rawPlugins = (parsedConfig.plugins as FlowlibPluginDefinition[] | undefined) ?? [];
    const backendPlugins = rawPlugins
      .map((p) => p.backend)
      .filter((p): p is FlowlibPlugin => p !== null && p !== undefined);
    const pluginManager = new PluginManager(backendPlugins);

    // Initialize action registry + built-in actions
    const actionRegistry: ActionRegistry = initializeGlobalActionRegistry(logger);
    actionRegistry.registerMany(allProviderActions);
    logger.info(
      `Registered ${actionRegistry.size} built-in actions from ${actionRegistry.getProviders().length} providers`,
    );

    // Initialize plugins (register plugin actions, call init hooks)
    // Use a lazy accessor since the FlowlibInstance is not yet built at this point.
    // Plugins that call getFlowlib() during init() will get an error; it's only
    // available after initialization completes (in endpoint handlers, hooks, etc.).
    let _flowlibInstance: FlowlibInstance | null = null;
    const getFlowlib = (): FlowlibInstance => {
      if (!_flowlibInstance) {
        throw new Error(
          'FlowlibInstance is not yet available. getFlowlib() cannot be called during plugin init(). ' +
            'It is available in endpoint handlers, hooks, and after initialization completes.',
        );
      }
      return _flowlibInstance;
    };

    await pluginManager.initializePlugins({
      config: parsedConfig as unknown as Record<string, unknown>,
      logger,
      registerAction: (action) => {
        actionRegistry.register(action);
      },
      getFlowlib,
    });

    if (pluginManager.getPlugins().length > 0) {
      logger.info(
        `Initialized ${pluginManager.getPlugins().length} plugin(s): ${pluginManager
          .getPlugins()
          .map((p) => p.id)
          .join(', ')}`,
      );
    }

    // Initialize JS expression engine (sandboxed QuickJS runtime for data mapper)
    let jsExpressionService: JsExpressionServiceType | null = null;
    let templateService: TemplateService | null = null;
    try {
      jsExpressionService = new JsExpressionService({}, logger);
      await jsExpressionService.initialize();
      templateService = getTemplateService(jsExpressionService, logger);
      logger.debug('JS expression engine + template service initialized');
    } catch (error) {
      jsExpressionService = null;
      templateService = null;
      logger.warn(
        'JS expression engine unavailable; continuing without data mapper and template expression support',
        { error: error instanceof Error ? (error.stack ?? error.message) : String(error) },
      );
    }

    // Initialize service factory
    logger.info('Initializing ServiceFactory (database connection)...');
    const sfStart = Date.now();
    const sf = new ServiceFactory(
      parsedConfig,
      actionRegistry,
      pluginManager,
      jsExpressionService ?? undefined,
      templateService ?? undefined,
    );
    await sf.initialize();
    logger.info(`ServiceFactory initialized in ${Date.now() - sfStart}ms (DB connected)`);

    // Build sub-APIs
    logger.debug('Building sub-APIs...');
    const flows = createFlowsAPI(sf, logger);
    const versions = createFlowVersionsAPI(sf, logger);
    const runs = createFlowRunsAPI(sf, logger);
    const credentials = createCredentialsAPI(sf, logger);
    const triggers = createTriggersAPI(sf, logger);
    const agent = createAgentAPI(sf);
    const chat = createChatAPI(sf);
    const actions = createActionsAPI(actionRegistry, sf, logger);
    const testing = createTestingAPI(
      sf,
      actionRegistry,
      jsExpressionService,
      templateService,
      parsedConfig,
    );
    const auth = createAuthAPI(authService, pluginManager, sf);
    const plugins = createPluginsAPI(pluginManager, sf);
    const maintenance = createMaintenanceAPI(sf);
    const coreDescriptors = buildCoreSettingsDescriptors(parsedConfig);
    const settings = createSettingsAPI(sf, pluginManager, logger, coreDescriptors);

    // Assemble the instance
    const instance: FlowlibInstance = {
      flows,
      versions,
      runs,
      credentials,
      triggers,
      agent,
      chat,
      actions,
      testing,
      auth,
      plugins,
      settings,
      maintenance,

      // Root-level logging
      getLogger(scope, context?) {
        return loggerManager.getLogger(scope, context);
      },
      getLoggerManager() {
        return loggerManager;
      },
      setLogLevel(scope, level) {
        loggerManager.setLogLevel(scope, level);
      },

      // Lifecycle
      async shutdown() {
        logger.info('Shutting down Flowlib Core...');

        try {
          // Mark in-progress flows as failed before tearing down services
          if (sf.isInitialized()) {
            try {
              const flowRunsService = sf.getFlowRunsService();
              const failedCount = await flowRunsService.failStaleRuns(0);
              if (failedCount > 0) {
                logger.warn(
                  `Graceful shutdown: marked ${failedCount} in-progress flow run(s) as FAILED`,
                );
              }
            } catch (error) {
              logger.error('Failed to mark in-progress runs during shutdown', error);
            }
          }

          // Shutdown plugins (reverse order)
          await pluginManager.shutdownPlugins(logger);

          // Close service factory
          await sf.close();

          // Dispose JS expression engine
          if (jsExpressionService) {
            jsExpressionService.dispose();
          }

          logger.info('Flowlib Core shutdown completed');
        } catch (error) {
          logger.error('Error during Flowlib Core shutdown', error);
          throw new DatabaseError('Flowlib Core shutdown failed', { error });
        }
      },

      async startBatchPolling() {
        await sf.getBaseAIClient().startBatchPolling();
      },

      async stopBatchPolling() {
        await sf.getBaseAIClient().stopBatchPolling();
      },

      async startMaintenancePolling() {
        await sf.getOrchestrationService().startMaintenancePolling();
      },

      async stopMaintenancePolling() {
        await sf.getOrchestrationService().stopMaintenancePolling();
      },

      async startCronScheduler() {
        const cronEnabled = parsedConfig.triggers?.cronEnabled ?? true;
        if (!cronEnabled) {
          logger.info('Cron scheduler disabled via config');
          return;
        }
        logger.info('Starting cron scheduler');
        await sf.getCronScheduler().start();
      },

      stopCronScheduler() {
        logger.info('Stopping cron scheduler');
        sf.getCronScheduler().stop();
      },

      async refreshCronScheduler() {
        await sf.getCronScheduler().refresh();
      },

      async runMaintenance(
        options: FlowlibMaintenanceOptions = {},
      ): Promise<FlowlibMaintenanceResult> {
        const timestamp =
          options.now instanceof Date
            ? options.now.toISOString()
            : typeof options.now === 'string'
              ? options.now
              : new Date().toISOString();
        const result: FlowlibMaintenanceResult = {
          timestamp,
        };

        if (options.pollBatchJobs !== false) {
          result.batchPolling = await sf.getBaseAIClient().pollBatchJobsForAllProviders();
        }

        if (options.resumePausedFlows !== false) {
          result.flowResumption = await sf.getOrchestrationService().runBatchResumptionSweep();
        }

        if (options.failStaleRuns !== false) {
          result.staleRuns = await sf.getOrchestrationService().runStaleRunSweep();
        }

        if (options.executeCronTriggers !== false) {
          const cronEnabled = parsedConfig.triggers?.cronEnabled ?? true;
          if (cronEnabled) {
            result.cronTriggers = await sf.getTriggersService().executeDueCronTriggers({
              now: options.now,
            });
          } else {
            result.cronTriggers = {
              timestamp,
              checkedCount: 0,
              dueCount: 0,
              claimedCount: 0,
              executedCount: 0,
              skippedCount: 0,
              failedCount: 0,
              disabled: true,
            };
          }
        }

        return result;
      },

      async healthCheck() {
        const h = await sf.healthCheck();
        return h.services;
      },
    };

    // Wire FlowlibInstance into ChatStreamService (post-init, breaking the circular dep)
    const chatService = sf.getChatStreamService();
    chatService.setFlowlibInstance(instance);

    // Seed default credentials (non-blocking)
    seedDefaultCredentials(sf, parsedConfig).catch((err) => {
      logger.error('Default credential seeding failed', err);
    });

    // Make instance available to plugins via the lazy getFlowlib() accessor
    _flowlibInstance = instance;

    // Run plugin settings appliers — plugins that contributed a `settings`
    // descriptor stash a callback in `ctx.store` during init (since
    // `getFlowlib()` isn't valid yet at that point). This is where they
    // get to overlay DB-persisted settings and subscribe to onChange.
    try {
      await pluginManager.runSettingsAppliers(instance);
    } catch (error) {
      logger.warn('Plugin settings appliers failed', error);
    }

    // ── Hot-reload core settings ────────────────────────────────────────
    //
    // Subscribe to settings changes for the core-owned editable fields
    // (logging level + per-scope overrides, triggers.cronEnabled). Plugin
    // descriptors handle their own hot-reload in their `init()`.
    //
    // Persisted values from a prior run are also applied here so a fresh
    // process boots up with whatever the operator last set in the UI.
    try {
      const persistedDefaultLevel = await settings.get<string>('core.logging.level');
      if (
        persistedDefaultLevel === 'debug' ||
        persistedDefaultLevel === 'info' ||
        persistedDefaultLevel === 'warn' ||
        persistedDefaultLevel === 'error' ||
        persistedDefaultLevel === 'silent'
      ) {
        loggerManager.setDefaultLevel(persistedDefaultLevel);
      }
      const persistedScopes = await settings.list({ namespace: 'core.logging' });
      for (const row of persistedScopes) {
        const m = /^core\.logging\.scopes\.(.+)$/.exec(row.key);
        if (!m || typeof row.value !== 'string') {
          continue;
        }
        const lvl = row.value;
        if (
          lvl === 'debug' ||
          lvl === 'info' ||
          lvl === 'warn' ||
          lvl === 'error' ||
          lvl === 'silent'
        ) {
          loggerManager.setLogLevel(m[1], lvl);
        }
      }
    } catch (error) {
      logger.warn('Failed to overlay persisted core.logging settings', error);
    }

    settings.onChange('core.logging', (event) => {
      if (event.type !== 'set' || typeof event.value !== 'string') {
        return;
      }
      const lvl = event.value;
      const isLevel =
        lvl === 'debug' ||
        lvl === 'info' ||
        lvl === 'warn' ||
        lvl === 'error' ||
        lvl === 'silent';
      if (event.key === 'core.logging.level' && isLevel) {
        loggerManager.setDefaultLevel(lvl);
        return;
      }
      const m = /^core\.logging\.scopes\.(.+)$/.exec(event.key);
      if (m && isLevel) {
        loggerManager.setLogLevel(m[1], lvl);
      }
    });

    // triggers.cronEnabled — toggle the scheduler on the live instance.
    try {
      const persistedCron = await settings.get<boolean>('core.triggers.cronEnabled');
      if (persistedCron === false) {
        instance.stopCronScheduler();
      }
    } catch (error) {
      logger.warn('Failed to overlay persisted core.triggers.cronEnabled', error);
    }

    settings.onChange('core.triggers', async (event) => {
      if (event.type !== 'set' || event.key !== 'core.triggers.cronEnabled') {
        return;
      }
      if (event.value === true) {
        try {
          await instance.startCronScheduler();
        } catch (error) {
          logger.error('Failed to start cron scheduler from settings change', error);
        }
      } else if (event.value === false) {
        instance.stopCronScheduler();
      }
    });

    logger.info(`Flowlib Core fully initialized in ${Date.now() - initStart}ms`);

    return instance;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }
    logger.error(`Failed to initialize Flowlib Core after ${Date.now() - initStart}ms`, error);
    throw new DatabaseError('Flowlib Core initialization failed', { error });
  }
}
