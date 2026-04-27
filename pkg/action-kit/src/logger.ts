/**
 * Structural Logger interface.
 *
 * Callers implement whatever they like; the structural shape below is
 * the only contract actions rely on. Mirrors the shape of
 * `Logger` in `@flowlib/core` by design so a single concrete logger
 * satisfies both.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
