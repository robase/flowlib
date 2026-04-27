/**
 * createInvect() — Single async factory that returns a fully initialized InvectInstance.
 *
 * Replaces the two-phase `new Invect(config)` → `await initialize()` pattern.
 * The returned object is guaranteed to be ready for use — no initialization checks needed.
 */

import { ServiceFactory } from '../services/service-factory';
import { InvectConfig, InvectConfigSchema } from '../schemas';
import { DatabaseError } from '../types/common/errors.types';
import { LoggerManager, type ScopedLoggingConfig } from '../utils/logger';
import { getTemplateService } from '../services/templating/template.service';
import type { TemplateService } from '../services/templating/template.service';
import {
  JsExpressionService,
  type JsExpressionService as JsExpressionServiceType,
} from '../services/templating/js-expression.service';
import { PluginManager } from '../services/plugin-manager';
import type { InvectPlugin, InvectPluginDefinition } from '../types/plugin.types';
import { AuthorizationService, createAuthorizationService } from '../services/auth';
import { ActionRegistry, initializeGlobalActionRegistry, registerBuiltinActions } from '../actions';
import type { CredentialAuthType } from '../database/schema-sqlite';

import type { InvectInstance, InvectMaintenanceOptions, InvectMaintenanceResult } from './types';
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

/**
 * Seed default credentials (non-blocking helper).
 */
async function seedDefaultCredentials(sf: ServiceFactory, config: InvectConfig): Promise<void> {
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
 * Create a fully initialized Invect instance.
 *
 * This is the recommended way to create an Invect instance. Unlike `new Invect(config)`,
 * the returned object is guaranteed to be fully initialized and ready for use.
 *
 * @example
 * ```typescript
 * const flowlib = await createInvect({
 *   database: { type: 'sqlite', connectionString: 'file:./dev.db' },
 * });
 *
 * const flow = await flowlib.flows.create({ name: 'My Flow' });
 * const result = await flowlib.runs.start(flow.id, { input: 'hello' });
 *
 * await flowlib.shutdown();
 * ```
 */
export async function createInvect(config: InvectConfig): Promise<InvectInstance> {
  const initStart = Date.now();
  // Parse and validate config. Cast back to `InvectConfig` because the
  // `services` block is typed as `unknown` in the Zod schema (adapter
  // instances aren't validatable) but `InvectConfig` overlays the typed
  // `InvectServiceOverrides` shape — so the parsed object is structurally
  // a strict subset of the input type.
  const parsedConfig = InvectConfigSchema.parse(config) as InvectConfig;

  // Explicit opt-in skip — host (e.g. framework adapter) is responsible for
  // setting this flag. Core does not sniff the environment.
  if (parsedConfig.skipDatabaseInit) {
    throw new DatabaseError('Invect Core initialization skipped (skipDatabaseInit=true)', {
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

  logger.info('Initializing Invect Core...', {
    databaseType: parsedConfig.database?.type,
    hasConnectionString: !!parsedConfig.database?.connectionString,
    pluginCount: parsedConfig.plugins?.length ?? 0,
  });

  try {
    // Initialize authorization service
    const authService: AuthorizationService = createAuthorizationService({ logger });

    // Initialize plugin manager — extract backend plugins from unified definitions
    const rawPlugins = (parsedConfig.plugins as InvectPluginDefinition[] | undefined) ?? [];
    const backendPlugins = rawPlugins
      .map((p) => p.backend)
      .filter((p): p is InvectPlugin => p !== null && p !== undefined);
    const pluginManager = new PluginManager(backendPlugins);

    // Initialize action registry + built-in actions
    const actionRegistry: ActionRegistry = initializeGlobalActionRegistry(logger);
    registerBuiltinActions(actionRegistry);
    logger.info(
      `Registered ${actionRegistry.size} built-in actions from ${actionRegistry.getProviders().length} providers`,
    );

    // Initialize plugins (register plugin actions, call init hooks)
    // Use a lazy accessor since the InvectInstance is not yet built at this point.
    // Plugins that call getInvect() during init() will get an error; it's only
    // available after initialization completes (in endpoint handlers, hooks, etc.).
    let _invectInstance: InvectInstance | null = null;
    const getInvect = (): InvectInstance => {
      if (!_invectInstance) {
        throw new Error(
          'InvectInstance is not yet available. getInvect() cannot be called during plugin init(). ' +
            'It is available in endpoint handlers, hooks, and after initialization completes.',
        );
      }
      return _invectInstance;
    };

    await pluginManager.initializePlugins({
      config: parsedConfig as unknown as Record<string, unknown>,
      logger,
      registerAction: (action) => {
        actionRegistry.register(action);
      },
      getInvect,
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

    // Assemble the instance
    const instance: InvectInstance = {
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
        logger.info('Shutting down Invect Core...');

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

          logger.info('Invect Core shutdown completed');
        } catch (error) {
          logger.error('Error during Invect Core shutdown', error);
          throw new DatabaseError('Invect Core shutdown failed', { error });
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
        options: InvectMaintenanceOptions = {},
      ): Promise<InvectMaintenanceResult> {
        const timestamp =
          options.now instanceof Date
            ? options.now.toISOString()
            : typeof options.now === 'string'
              ? options.now
              : new Date().toISOString();
        const result: InvectMaintenanceResult = {
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

    // Wire InvectInstance into ChatStreamService (post-init, breaking the circular dep)
    const chatService = sf.getChatStreamService();
    chatService.setInvectInstance(instance);

    // Seed default credentials (non-blocking)
    seedDefaultCredentials(sf, parsedConfig).catch((err) => {
      logger.error('Default credential seeding failed', err);
    });

    // Make instance available to plugins via the lazy getInvect() accessor
    _invectInstance = instance;

    logger.info(`Invect Core fully initialized in ${Date.now() - initStart}ms`);

    return instance;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }
    logger.error(`Failed to initialize Invect Core after ${Date.now() - initStart}ms`, error);
    throw new DatabaseError('Invect Core initialization failed', { error });
  }
}
