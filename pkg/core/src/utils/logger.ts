/* eslint-disable no-console */
import { Logger, LoggingConfig } from 'src/schemas';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Predefined log scopes for Flowlib feature areas.
 * Use these when creating scoped loggers for consistent naming.
 */
export const LogScope = {
  /** Flow execution orchestration */
  EXECUTION: 'execution',
  /** Flow validation */
  VALIDATION: 'validation',
  /** Batch processing (AI providers) */
  BATCH: 'batch',
  /** Database operations */
  DATABASE: 'database',
  /** Node execution */
  NODE: 'node',
  /** Graph operations (topological sort, etc.) */
  GRAPH: 'graph',
  /** Credential management */
  CREDENTIALS: 'credentials',
  /** AI/LLM operations */
  AI: 'ai',
  /** Template rendering */
  TEMPLATE: 'template',
  /** React Flow rendering */
  RENDERER: 'renderer',
  /** Flow management (CRUD) */
  FLOWS: 'flows',
  /** Flow version management */
  VERSIONS: 'versions',
  /** HTTP/API layer */
  HTTP: 'http',
} as const;

export type LogScopeName = (typeof LogScope)[keyof typeof LogScope] | string;

/**
 * Configuration for scope-specific log levels
 */
export interface ScopedLoggingConfig extends LoggingConfig {
  /** Per-scope log level overrides */
  scopes?: Record<string, LogLevel>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ANSI color codes for log levels
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m', // Green
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  silent: '\x1b[0m', // Reset
};

// Scope colors for visual distinction
const SCOPE_COLORS: Record<string, string> = {
  execution: '\x1b[35m', // Magenta
  validation: '\x1b[33m', // Yellow
  batch: '\x1b[36m', // Cyan
  database: '\x1b[34m', // Blue
  node: '\x1b[32m', // Green
  graph: '\x1b[35m', // Magenta
  credentials: '\x1b[31m', // Red
  ai: '\x1b[36m', // Cyan
  template: '\x1b[33m', // Yellow
  renderer: '\x1b[34m', // Blue
  flows: '\x1b[32m', // Green
  versions: '\x1b[35m', // Magenta
  http: '\x1b[36m', // Cyan
};

const RESET_COLOR = '\x1b[0m';
const DIM_COLOR = '\x1b[2m';

/**
 * Enhanced logger that respects log level configuration
 */
export class BaseLogger implements Logger {
  private readonly logLevel: LogLevel;
  private readonly context?: string;

  constructor(config: LoggingConfig, context?: string) {
    this.logLevel = config.level === 'silent' ? 'silent' : config.level;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const now = new Date();
    const timestamp =
      now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');
    const contextStr = this.context ? `[${this.context}]` : '';
    const color = LOG_COLORS[level];
    const levelStr = `${color}${level.toUpperCase().padEnd(6)}${RESET_COLOR}`;
    const metaStr = meta
      ? ` ${JSON.stringify(
          meta,
          (_key, value: unknown) => {
            if (value instanceof Error) {
              return { message: value.message, name: value.name, stack: value.stack };
            }
            return value;
          },
          2,
        )}`
      : '';

    return `${timestamp} | ${levelStr}|${contextStr} ${message}${metaStr}`;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: unknown, _extra?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

/**
 * Scoped logger that supports independent log levels per scope/feature area.
 *
 * @example
 * ```typescript
 * const loggerManager = new LoggerManager({
 *   level: 'info',
 *   scopes: {
 *     execution: 'debug',  // Verbose logging for execution
 *     validation: 'warn',  // Only warnings for validation
 *     batch: 'silent',     // Disable batch logging
 *   }
 * });
 *
 * const executionLogger = loggerManager.getLogger('execution');
 * executionLogger.debug('Starting flow execution'); // This will log
 *
 * const validationLogger = loggerManager.getLogger('validation');
 * validationLogger.debug('Validating flow'); // This will NOT log (below warn)
 * ```
 */
export class ScopedLogger implements Logger {
  constructor(
    private readonly scope: string,
    private readonly effectiveLevel: LogLevel,
    private readonly context?: string,
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.effectiveLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const now = new Date();
    const timestamp =
      now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');

    // Build scope/context string
    const scopeColor = SCOPE_COLORS[this.scope] || '\x1b[37m'; // Default white
    const scopeStr = `${scopeColor}[${this.scope}]${RESET_COLOR}`;
    const contextStr = this.context ? `${DIM_COLOR}(${this.context})${RESET_COLOR}` : '';

    const color = LOG_COLORS[level];
    const levelStr = `${color}${level.toUpperCase().padEnd(6)}${RESET_COLOR}`;
    const metaStr = meta
      ? ` ${JSON.stringify(
          meta,
          (_key, value: unknown) => {
            if (value instanceof Error) {
              return { message: value.message, name: value.name, stack: value.stack };
            }
            return value;
          },
          2,
        )}`
      : '';

    return `${timestamp} | ${levelStr}| ${scopeStr}${contextStr} ${message}${metaStr}`;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: unknown, _extra?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: string): ScopedLogger {
    const fullContext = this.context ? `${this.context}:${context}` : context;
    return new ScopedLogger(this.scope, this.effectiveLevel, fullContext);
  }

  /**
   * Get the current scope name
   */
  getScope(): string {
    return this.scope;
  }

  /**
   * Get the effective log level for this logger
   */
  getLevel(): LogLevel {
    return this.effectiveLevel;
  }
}

/**
 * Logger manager that creates and manages scoped loggers with independent log levels.
 *
 * This allows different feature areas of Flowlib to have different log levels,
 * making it easier to debug specific functionality without noise from other areas.
 *
 * @example
 * ```typescript
 * // In Flowlib config:
 * const config: FlowlibConfig = {
 *   logging: {
 *     level: 'info',  // Default level
 *     scopes: {
 *       execution: 'debug',   // Verbose execution logs
 *       validation: 'warn',   // Only validation warnings
 *       batch: 'silent',      // No batch processing logs
 *       database: 'error',    // Only database errors
 *     }
 *   }
 * };
 *
 * // Usage in services:
 * class FlowOrchestrationService {
 *   private readonly logger: ScopedLogger;
 *
 *   constructor(loggerManager: LoggerManager) {
 *     this.logger = loggerManager.getLogger('execution');
 *   }
 * }
 * ```
 */
export class LoggerManager {
  private defaultLevel: LogLevel;
  private readonly scopeLevels: Map<string, LogLevel>;
  private readonly loggerCache: Map<string, ScopedLogger>;

  constructor(config: ScopedLoggingConfig) {
    this.defaultLevel = config.level || 'info';
    this.scopeLevels = new Map(Object.entries(config.scopes || {}));
    this.loggerCache = new Map();
  }

  /**
   * Get a scoped logger for a specific feature area
   *
   * @param scope - The scope/feature area name (use LogScope constants for consistency)
   * @param context - Optional additional context (e.g., class name, method name)
   * @returns A ScopedLogger instance with the appropriate log level
   */
  getLogger(scope: LogScopeName, context?: string): ScopedLogger {
    const cacheKey = context ? `${scope}:${context}` : scope;

    if (!this.loggerCache.has(cacheKey)) {
      const effectiveLevel = this.scopeLevels.get(scope) ?? this.defaultLevel;
      const logger = new ScopedLogger(scope, effectiveLevel, context);
      this.loggerCache.set(cacheKey, logger);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- just set above
    return this.loggerCache.get(cacheKey)!;
  }

  /**
   * Get a basic logger (no scope) for backward compatibility
   */
  getBasicLogger(context?: string): BaseLogger {
    return new BaseLogger({ level: this.defaultLevel }, context);
  }

  /**
   * Update the log level for a specific scope at runtime
   */
  setLogLevel(scope: string, level: LogLevel): void {
    this.scopeLevels.set(scope, level);
    // Clear cached loggers for this scope so they get recreated with new level
    for (const key of this.loggerCache.keys()) {
      if (key === scope || key.startsWith(`${scope}:`)) {
        this.loggerCache.delete(key);
      }
    }
  }

  /**
   * Update the default log level at runtime
   */
  setDefaultLevel(level: LogLevel): void {
    this.defaultLevel = level;
    // Clear all cached loggers
    this.loggerCache.clear();
  }

  /**
   * Get current configuration for all scopes
   */
  getConfig(): { defaultLevel: LogLevel; scopes: Record<string, LogLevel> } {
    return {
      defaultLevel: this.defaultLevel,
      scopes: Object.fromEntries(this.scopeLevels),
    };
  }

  /**
   * Check if a scope would log at a given level
   */
  wouldLog(scope: string, level: LogLevel): boolean {
    const effectiveLevel = this.scopeLevels.get(scope) ?? this.defaultLevel;
    return LOG_LEVELS[level] >= LOG_LEVELS[effectiveLevel];
  }
}
