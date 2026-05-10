/**
 * Audit logger for MCP tool invocations.
 */

import type { AuditEntry, McpPluginOptions } from '../shared/types';

type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
};

export class AuditLogger {
  private enabled: boolean;
  private logLevel: 'debug' | 'info' | 'warn';

  constructor(
    private readonly logger: Logger,
    options?: McpPluginOptions['audit'],
  ) {
    this.enabled = options?.enabled ?? true;
    this.logLevel = options?.logLevel ?? 'info';
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  setLogLevel(value: 'debug' | 'info' | 'warn'): void {
    this.logLevel = value;
  }

  log(entry: AuditEntry): void {
    if (!this.enabled) {
      return;
    }

    const msg = `[MCP Audit] ${entry.tool} ${entry.status} (${entry.durationMs}ms) user=${entry.userId ?? 'unknown'}`;
    const meta = {
      sessionId: entry.sessionId,
      userId: entry.userId,
      userRole: entry.userRole,
      tool: entry.tool,
      status: entry.status,
      durationMs: entry.durationMs,
      ...(entry.error ? { error: entry.error } : {}),
    };

    switch (this.logLevel) {
      case 'debug':
        this.logger.debug(msg, meta);
        break;
      case 'warn':
        this.logger.warn(msg, meta);
        break;
      default:
        this.logger.info(msg, meta);
    }
  }

  /** Create an audit entry helper that tracks timing */
  startTimer(
    tool: string,
    options?: { sessionId?: string; userId?: string; userRole?: string },
  ): { finish: (result: { status: 'success' | 'error'; error?: string }) => void } {
    const start = Date.now();
    return {
      finish: (result) => {
        this.log({
          timestamp: new Date().toISOString(),
          tool,
          params: {}, // Params are not logged by default for security
          durationMs: Date.now() - start,
          sessionId: options?.sessionId,
          userId: options?.userId,
          userRole: options?.userRole,
          ...result,
        });
      },
    };
  }
}
