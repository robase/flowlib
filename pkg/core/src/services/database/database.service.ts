// Framework-agnostic Database Service for Flowlib core

import { DatabaseConnectionFactory, type DatabaseConnection } from '../../database/connection';
import { verifySchema, type SchemaVerificationOptions } from '../../database/schema-verification';
import { CORE_SCHEMA } from '@flowlib/db';
import { DatabaseError } from 'src/types/common/errors.types';
import { FlowRunsModel } from '../flow-runs/flow-runs.model';
import { FlowsModel } from '../flows/flows.model';
import { BatchJobsModel } from '../batch-jobs/batch-jobs.model';
import { FlowVersionsModel } from '../flow-versions/flow-versions.model';
import { NodeExecutionsModel } from '../node-executions/node-executions.model';
import { FlowTriggersModel } from '../triggers/flow-triggers.model';
import { ChatMessagesModel } from '../chat/chat-messages.model';

import { FlowlibDatabaseConfig, Logger } from 'src/schemas';
import type { FlowlibPlugin } from 'src/types/plugin.types';
import type { FlowlibAdapter } from '../../database/adapter';
import { createAdapterFromConnection } from '../../database/adapters/connection-bridge';

/**
 * Describes tables that a plugin needs checked at startup.
 */
interface PluginTableRequirement {
  pluginId: string;
  pluginName: string;
  tables: string[];
  setupInstructions?: string;
}

/**
 * Core database service implementation
 */
export class DatabaseService {
  private connection: DatabaseConnection | null = null;
  private _database: Database | null = null;
  private _adapter: FlowlibAdapter | null = null;
  private schemaVerificationOptions?: SchemaVerificationOptions;
  private pluginTableRequirements: PluginTableRequirement[] = [];

  constructor(
    private readonly hostDbConfig: FlowlibDatabaseConfig,
    private readonly logger: Logger = console,
    schemaVerification?: SchemaVerificationOptions,
    plugins?: FlowlibPlugin[],
  ) {
    this.schemaVerificationOptions = schemaVerification;
    this.pluginTableRequirements = DatabaseService.extractPluginTableRequirements(plugins ?? []);
  }

  /**
   * Get the Database instance with all model classes
   */
  get database(): Database {
    if (!this._database) {
      throw new DatabaseError('Database not initialized - call initialize() first');
    }
    return this._database;
  }

  /**
   * Get the FlowlibAdapter instance for direct adapter access
   */
  get adapter(): FlowlibAdapter {
    if (!this._adapter) {
      throw new DatabaseError('Database not initialized - call initialize() first');
    }
    return this._adapter;
  }

  /**
   * Direct access to flows model
   */
  get flows() {
    return this.database.flows;
  }

  /**
   * Direct access to flow versions model
   */
  get flowVersions() {
    return this.database.flowVersions;
  }

  /**
   * Direct access to flow executions model
   */
  get flowRuns() {
    return this.database.flowRuns;
  }

  /**
   * Direct access to execution traces model
   */
  get nodeExecutions() {
    return this.database.executionTraces;
  }

  /**
   * Direct access to batch jobs model
   */
  get flowTriggers() {
    return this.database.flowTriggers;
  }

  /**
   * Direct access to chat messages model
   */
  get chatMessages() {
    return this.database.chatMessages;
  }

  /**
   * Initialize the database connection and models
   */
  async initialize(): Promise<void> {
    if (this.connection) {
      this.logger.debug('Database connection already initialized');
      return;
    }

    const dbInitStart = Date.now();
    this.logger.info('Starting database initialization...', {
      dbType: this.hostDbConfig?.type,
      hasConnectionString: !!this.hostDbConfig?.connectionString,
      connectionStringPrefix: this.hostDbConfig?.connectionString
        ? this.redactConnectionString(this.hostDbConfig.connectionString).substring(0, 30) + '...'
        : undefined,
    });

    // --- Step 1: Establish the database connection ---
    try {
      this.logger.debug('Step 1: Creating database connection...');
      const connStart = Date.now();
      this.connection = await DatabaseConnectionFactory.createHostDBConnection(
        this.hostDbConfig,
        this.logger,
      );
      this.logger.info(`Step 1: Database connection created in ${Date.now() - connStart}ms`);
    } catch (error) {
      this.logger.error(`Step 1: Database connection FAILED after ${Date.now() - dbInitStart}ms`, {
        error: error instanceof Error ? error.message : error,
      });
      this.logConnectionError(error);
      throw new DatabaseError(
        `Failed to connect to the database: ${error instanceof Error ? error.message : error}`,
        { error, originalStack: error instanceof Error ? error.stack : undefined },
      );
    }

    // --- Step 2: Verify connectivity with a simple query ---
    try {
      this.logger.debug('Step 2: Running connectivity check...');
      const checkStart = Date.now();
      await this.runConnectivityCheck(this.connection);
      this.logger.info(`Step 2: Connectivity check passed in ${Date.now() - checkStart}ms`);
    } catch (error) {
      this.logger.error(`Step 2: Connectivity check FAILED after ${Date.now() - dbInitStart}ms`, {
        error: error instanceof Error ? error.message : error,
      });
      this.logConnectivityError(error);
      throw new DatabaseError(
        `Database connectivity check failed: ${error instanceof Error ? error.message : error}`,
        { error },
      );
    }

    // --- Step 3: Check that core Flowlib tables exist ---
    this.logger.debug('Step 3: Checking core tables...');
    const tableCheckStart = Date.now();
    await this.runCoreTableCheck(this.connection);
    this.logger.info(`Step 3: Core table check passed in ${Date.now() - tableCheckStart}ms`);

    // --- Step 3b: Check that plugin-required tables exist ---
    this.logger.debug('Step 3b: Checking plugin tables...');
    await this.runPluginTableChecks(this.connection);
    this.logger.debug('Step 3b: Plugin table checks passed');

    // --- Step 4: Initialize the database models ---
    this.logger.debug('Step 4: Initializing database models...');
    this._adapter = createAdapterFromConnection(this.connection);
    this._database = new Database(this.connection, this.logger, this._adapter);

    // --- Step 5: Run detailed schema verification ---
    if (this.schemaVerificationOptions) {
      this.logger.debug('Step 5: Running schema verification...');
      await verifySchema(this.connection, this.logger, this.schemaVerificationOptions);
    }

    this.logger.info(`Database service initialized successfully in ${Date.now() - dbInitStart}ms`);
  }

  /**
   * Get the database connection for sharing with other services
   */
  getConnection(): DatabaseConnection {
    if (!this.connection) {
      throw new DatabaseError('Database not initialized - call initialize() first');
    }
    return this.connection;
  }

  /**
   * Execute a SQL query on a provided queryDatabase
   */
  async executeQuery(
    query: string,
    queryDBConfig: FlowlibDatabaseConfig,
  ): Promise<Record<string, unknown>[]> {
    try {
      this.logger.debug('Executing query on external database', {
        query,
        dbType: queryDBConfig.type,
      });

      // Create or get existing query database connection
      const queryConnection = await DatabaseConnectionFactory.createQueryDbConnection(
        queryDBConfig,
        this.logger,
      );

      // Execute the query using the unified driver interface
      const result = await queryConnection.driver.queryAll<Record<string, unknown>>(query);

      this.logger.debug('Query executed successfully', {
        rowCount: Array.isArray(result) ? result.length : 'unknown',
        dbType: queryDBConfig.type,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to execute query on external database', {
        error: error instanceof Error ? error.message : error,
        query,
        dbType: queryDBConfig.type,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new DatabaseError(
        `Query execution failed on ${queryDBConfig.type} database: ${
          error instanceof Error ? error.message : error
        }`,
        {
          error,
          query,
          dbConfig: queryDBConfig,
          originalStack: error instanceof Error ? error.stack : undefined,
        },
      );
    }
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<void> {
    this.logger.debug('Performing database health check');

    if (!this.connection) {
      throw new DatabaseError('Database not initialized - call initialize() first');
    }

    try {
      // Simple connectivity test using the unified driver
      await this.connection.driver.queryAll('SELECT 1 as health');

      this.logger.debug('Database health check passed');
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new DatabaseError('Database health check failed', { error });
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.logger.debug('Closing database connection');
      this.connection = null;
      this._database = null;
      this.logger.info('Database connection closed');
    }
  }

  // ===========================================================================
  // Plugin table requirement extraction
  // ===========================================================================

  /**
   * Extract table requirements from plugin declarations.
   *
   * A plugin can declare required tables via:
   * 1. `requiredTables: string[]` — explicit list (preferred)
   * 2. `schema: { tableName: ... }` — inferred from abstract schema definitions
   *
   * If both are present, `requiredTables` takes precedence.
   */
  static extractPluginTableRequirements(plugins: FlowlibPlugin[]): PluginTableRequirement[] {
    const requirements: PluginTableRequirement[] = [];

    for (const plugin of plugins) {
      let tables: string[] = [];

      if (plugin.requiredTables && plugin.requiredTables.length > 0) {
        // Explicit declaration takes priority
        tables = [...plugin.requiredTables];
      } else if (plugin.schema) {
        // Infer from abstract schema — each entry's tableName (or snake_case key)
        for (const [key, def] of Object.entries(plugin.schema)) {
          const tableName = (def as { tableName?: string }).tableName ?? key;
          const disabled = (def as { disableMigration?: boolean }).disableMigration;
          if (!disabled) {
            tables.push(tableName);
          }
        }
      }

      if (tables.length > 0) {
        requirements.push({
          pluginId: plugin.id,
          pluginName: plugin.name ?? plugin.id,
          tables,
          setupInstructions: plugin.setupInstructions,
        });
      }
    }

    return requirements;
  }

  // ===========================================================================
  // Startup check helpers
  // ===========================================================================

  /**
   * Run a simple `SELECT 1` query to verify the database is reachable.
   */
  private async runConnectivityCheck(connection: DatabaseConnection): Promise<void> {
    await connection.driver.queryAll('SELECT 1 as health');
  }

  /**
   * Check that the essential Flowlib tables exist in the database.
   * This catches the most common developer mistake: running the app
   * before applying the database schema.
   *
   * Only checks for table *existence*, not column correctness (that's
   * what the opt-in `schemaVerification` does).
   */
  private async runCoreTableCheck(connection: DatabaseConnection): Promise<void> {
    // Collect the expected core table names from the abstract schema
    const expectedTables: string[] = [];
    for (const def of Object.values(CORE_SCHEMA)) {
      const tableDef = def as { tableName?: string; disableMigration?: boolean };
      if (tableDef.disableMigration) {
        continue;
      }
      if (tableDef.tableName) {
        expectedTables.push(tableDef.tableName);
      }
    }

    // Get actual table names from the database
    let actualTableNames: Set<string>;
    try {
      actualTableNames = await this.listTableNames(connection);
    } catch (error) {
      // If we can't even list tables, the database is probably unreachable
      // or misconfigured — the connectivity check should have caught this,
      // but log and proceed gracefully.
      this.logger.warn('Could not introspect database tables. Skipping startup table check.', {
        error: error instanceof Error ? error.message : error,
      });
      return;
    }

    const missingTables = expectedTables.filter((t) => !actualTableNames.has(t));

    if (missingTables.length === 0) {
      this.logger.debug('Core table check passed', {
        tablesFound: expectedTables.length,
      });
      return;
    }

    // --- Build a helpful error message ---
    const allMissing = missingTables.length === expectedTables.length;

    const lines: string[] = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║              ⚠  FLOWLIB — DATABASE NOT READY  ⚠            ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
    ];

    if (allMissing) {
      lines.push(
        'Your database exists but has no Flowlib tables.',
        "This usually means you haven't pushed the schema yet.",
      );
    } else {
      lines.push(
        `Your database is missing ${missingTables.length} of ${expectedTables.length} required Flowlib tables:`,
        `  Missing: ${missingTables.join(', ')}`,
        '',
        'This usually means your schema is out of date.',
      );
    }

    lines.push('');

    // Fix instructions — point users to the Flowlib CLI
    lines.push(
      'To fix this, run:',
      '',
      '  npx flowlib-cli generate   # generate schema files (core + plugins)',
      '  npx drizzle-kit push   # push schema to the database',
      '',
      'Or if you use migrations:',
      '',
      '  npx flowlib-cli generate   # generate schema files',
      '  npx drizzle-kit generate',
      '  npx flowlib-cli migrate    # apply migrations',
      '',
      'The Flowlib CLI reads your flowlib.config.ts to discover installed',
      'plugins and generates the correct schema for all of them.',
      '',
    );

    const message = lines.join('\n');
    this.logger.error(message);

    throw new DatabaseError(
      `Database is missing ${allMissing ? 'all' : missingTables.length} required Flowlib table(s). ` +
        `Run schema migrations before starting the server. See logs above for instructions.`,
      { missingTables },
    );
  }

  /**
   * Check that tables required by plugins exist in the database.
   *
   * Each plugin can declare `requiredTables` (explicit list) or have them
   * inferred from its `schema` definition. This method checks all of them
   * in a single pass and produces a clear, attributed error message so the
   * developer knows exactly which plugin needs which tables.
   */
  private async runPluginTableChecks(connection: DatabaseConnection): Promise<void> {
    if (this.pluginTableRequirements.length === 0) {
      return; // No plugins declared required tables
    }

    // Get actual table names from the database
    let actualTableNames: Set<string>;
    try {
      actualTableNames = await this.listTableNames(connection);
    } catch {
      // If introspection fails, skip gracefully (core check already warned)
      return;
    }

    // Collect all missing tables grouped by plugin
    const pluginsWithMissing: Array<{
      pluginId: string;
      pluginName: string;
      missingTables: string[];
      setupInstructions?: string;
    }> = [];

    for (const req of this.pluginTableRequirements) {
      const missing = req.tables.filter((t) => !actualTableNames.has(t));
      if (missing.length > 0) {
        pluginsWithMissing.push({
          pluginId: req.pluginId,
          pluginName: req.pluginName,
          missingTables: missing,
          setupInstructions: req.setupInstructions,
        });
      }
    }

    if (pluginsWithMissing.length === 0) {
      const totalTables = this.pluginTableRequirements.reduce((sum, r) => sum + r.tables.length, 0);
      this.logger.debug('Plugin table check passed', {
        plugins: this.pluginTableRequirements.length,
        tablesChecked: totalTables,
      });
      return;
    }

    // --- Build a helpful, plugin-attributed error message ---
    const totalMissing = pluginsWithMissing.reduce((sum, p) => sum + p.missingTables.length, 0);

    const lines: string[] = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║          ⚠  FLOWLIB — PLUGIN TABLES MISSING  ⚠             ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `${totalMissing} table(s) required by ${pluginsWithMissing.length} plugin(s) are missing from the database:`,
      '',
    ];

    for (const plugin of pluginsWithMissing) {
      lines.push(
        `  Plugin: ${plugin.pluginName} (${plugin.pluginId})`,
        `  Missing tables: ${plugin.missingTables.join(', ')}`,
      );

      if (plugin.setupInstructions) {
        lines.push(`  Fix: ${plugin.setupInstructions}`);
      }

      lines.push('');
    }

    // Check if any plugin provided custom instructions
    const hasCustomInstructions = pluginsWithMissing.some((p) => p.setupInstructions);

    if (!hasCustomInstructions) {
      // Generic fix instructions — point to the CLI
      lines.push(
        'To fix this, run:',
        '',
        '  npx flowlib-cli generate   # generate schema files (core + plugins)',
        '  npx drizzle-kit push   # push schema to the database',
        '',
        'The Flowlib CLI reads your flowlib.config.ts, discovers all plugins',
        'and their required tables, and generates the complete schema.',
      );
    }

    lines.push(
      '',
      'If a plugin defines a schema, `npx flowlib-cli generate` will include it',
      'automatically. For plugins with externally-managed tables, see the',
      "plugin's README for additional schema setup instructions.",
      '',
    );

    const message = lines.join('\n');
    this.logger.error(message);

    throw new DatabaseError(
      `Database is missing ${totalMissing} table(s) required by plugin(s): ` +
        pluginsWithMissing
          .map((p) => `${p.pluginName} (${p.missingTables.join(', ')})`)
          .join('; ') +
        `. Push the schema before starting the server. See logs above for instructions.`,
      {
        pluginsWithMissing: pluginsWithMissing.map((p) => ({
          pluginId: p.pluginId,
          missingTables: p.missingTables,
        })),
      },
    );
  }

  /**
   * Get a set of table names from the database.
   */
  private async listTableNames(connection: DatabaseConnection): Promise<Set<string>> {
    const names = new Set<string>();

    switch (connection.type) {
      case 'sqlite': {
        const query = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'`;
        const rows = (await connection.driver.queryAll(query)) as Array<{ name: string }>;
        for (const row of rows) {
          names.add(row.name);
        }
        break;
      }
      case 'postgresql': {
        const rows = (await connection.driver.queryAll(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        )) as Array<{ table_name: string }>;
        for (const row of rows) {
          names.add(row.table_name);
        }
        break;
      }
      case 'mysql': {
        const rows = (await connection.driver.queryAll(
          `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
        )) as Array<Record<string, string>>;
        for (const row of rows) {
          names.add(row['TABLE_NAME']);
        }
        break;
      }
    }

    return names;
  }

  /**
   * Log a helpful error when the database connection itself fails.
   */
  private logConnectionError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    const dbType = this.hostDbConfig.type;
    const connStr = this.hostDbConfig.connectionString;

    const lines: string[] = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║             ⚠  FLOWLIB — DATABASE CONNECTION FAILED  ⚠     ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `Database type:       ${dbType}`,
      `Connection string:   ${connStr ? this.redactConnectionString(connStr) : '(none — using binding)'}`,
      `Error:               ${msg}`,
      '',
    ];

    if (dbType === 'sqlite') {
      if (msg.includes('SQLITE_CANTOPEN') || msg.includes('unable to open')) {
        lines.push(
          'The SQLite database file could not be opened.',
          'Check that the path is correct and the directory exists.',
          '',
          `  Configured path: ${connStr}`,
        );
      } else {
        lines.push(
          'Could not connect to the SQLite database.',
          'Make sure the connection string in your config is valid.',
          '',
          'Common formats:',
          '  file:./dev.db          (relative path)',
          '  file:/absolute/path.db (absolute path)',
        );
      }
    } else if (dbType === 'postgresql') {
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        lines.push(
          'Could not reach the PostgreSQL server.',
          'Make sure PostgreSQL is running and the connection string is correct.',
          '',
          'Common causes:',
          '  • PostgreSQL is not running (start with: pg_ctl start)',
          '  • Wrong host/port in connection string',
          '  • Firewall blocking the connection',
        );
      } else if (msg.includes('authentication') || msg.includes('password')) {
        lines.push(
          'PostgreSQL authentication failed.',
          'Check that the username and password in your connection string are correct.',
        );
      } else if (msg.includes('does not exist')) {
        lines.push(
          'The PostgreSQL database does not exist.',
          'Create it with: createdb <database_name>',
        );
      } else {
        lines.push('Could not connect to PostgreSQL. Verify your DATABASE_URL is correct.');
      }
    } else if (dbType === 'mysql') {
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        lines.push(
          'Could not reach the MySQL server.',
          'Make sure MySQL is running and the connection string is correct.',
        );
      } else {
        lines.push('Could not connect to MySQL. Verify your connection string.');
      }
    }

    lines.push('');
    this.logger.error(lines.join('\n'));
  }

  /**
   * Log a helpful error when the connectivity probe (SELECT 1) fails.
   */
  private logConnectivityError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);

    const lines: string[] = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║        ⚠  FLOWLIB — DATABASE CONNECTIVITY CHECK FAILED ⚠   ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      'A connection was established but a simple SELECT query failed.',
      `Error: ${msg}`,
      '',
      'This may indicate:',
      '  • The database server dropped the connection',
      '  • Insufficient permissions for the database user',
      '  • The database file is corrupted (SQLite)',
      '',
    ];

    this.logger.error(lines.join('\n'));
  }

  /**
   * Redact credentials from a connection string for safe logging.
   */
  private redactConnectionString(connStr: string): string {
    // Hide passwords in postgres/mysql URLs: postgres://user:PASS@host → postgres://user:***@host
    return connStr.replace(/:([^/:@]+)@/, ':***@');
  }
}

/**
 * Database Models Factory - Creates all model instances with shared connection and logger
 */
class Database {
  public readonly flows: FlowsModel;
  public readonly flowVersions: FlowVersionsModel;
  public readonly flowRuns: FlowRunsModel;
  public readonly executionTraces: NodeExecutionsModel;
  public readonly batchJobs: BatchJobsModel;
  public readonly flowTriggers: FlowTriggersModel;
  public readonly chatMessages: ChatMessagesModel;

  constructor(_connection: DatabaseConnection, logger: Logger, adapter: FlowlibAdapter) {
    this.flows = new FlowsModel(adapter, logger);
    this.flowVersions = new FlowVersionsModel(adapter, logger);
    this.flowRuns = new FlowRunsModel(adapter, logger);
    this.executionTraces = new NodeExecutionsModel(adapter, logger);
    this.batchJobs = new BatchJobsModel(adapter, logger);
    this.flowTriggers = new FlowTriggersModel(adapter, logger);
    this.chatMessages = new ChatMessagesModel(adapter, logger);
  }
}
