import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Scoped output-channel logger.
 *
 * Two channels back the system: `Flowlib` for host-side messages and
 * `Flowlib (Webview)` for forwarded webview console output. Each call site
 * grabs a `ScopedLogger` via `Channel#scoped(scope)`; lines prefix `scope`
 * so tail-reading the panel makes provenance obvious without splitting into
 * dozens of channels.
 *
 * Logged `data` is JSON-serialised and run through `redactSecrets` before
 * the channel write — keys matching `authorization` / `api_key` / `token` /
 * `password` / `secret` / `bearer` get their values replaced with
 * `"[redacted]"` so accidental forward of credential payloads doesn't leak.
 */
export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/**
 * Lower-level scoped writer. Returned by `Channel#scoped` for callers that
 * want to share a channel between several distinct subsystems
 * (e.g. `logger.scoped('FlowEditorProvider')`, `logger.scoped('BackendClient')`).
 */
export interface ScopedLogger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

class ChannelImpl implements Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string, channel?: vscode.OutputChannel) {
    this.channel = channel ?? vscode.window.createOutputChannel(name);
  }

  debug(msg: string, data?: unknown): void {
    this.write(undefined, 'debug', msg, data);
  }

  info(msg: string, data?: unknown): void {
    this.write(undefined, 'info', msg, data);
  }

  warn(msg: string, data?: unknown): void {
    this.write(undefined, 'warn', msg, data);
  }

  error(msg: string, data?: unknown): void {
    this.write(undefined, 'error', msg, data);
  }

  show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  dispose(): void {
    this.channel.dispose();
  }

  scoped(scope: string): ScopedLogger {
    return {
      debug: (msg, data) => this.write(scope, 'debug', msg, data),
      info: (msg, data) => this.write(scope, 'info', msg, data),
      warn: (msg, data) => this.write(scope, 'warn', msg, data),
      error: (msg, data) => this.write(scope, 'error', msg, data),
    };
  }

  /**
   * Direct channel access — needed by the test-only reset helper to ensure
   * `dispose()` actually disposes the underlying VSCode channel.
   */
  rawChannel(): vscode.OutputChannel {
    return this.channel;
  }

  private write(scope: string | undefined, level: LogLevel, msg: string, data: unknown): void {
    const stamp = new Date().toISOString();
    const prefix = scope
      ? `[${stamp}] [${level.toUpperCase()}] [${scope}]`
      : `[${stamp}] [${level.toUpperCase()}]`;
    if (data === undefined) {
      this.channel.appendLine(`${prefix} ${msg}`);
      return;
    }
    let serialised: string;
    try {
      const json = typeof data === 'string' ? data : JSON.stringify(data);
      serialised = redactSecrets(json);
    } catch {
      serialised = String(data);
    }
    this.channel.appendLine(`${prefix} ${msg} ${serialised}`);
  }
}

/**
 * Redact obvious secret-shaped values from a JSON string. Conservative —
 * only fires on canonical key names. Bearer tokens after `Authorization:`
 * are also nuked. Used in test assertions, so kept exported.
 */
export function redactSecrets(s: string): string {
  return (
    s
      // JSON object key:value where key looks secret-shaped
      .replace(
        /("(?:authorization|api[_-]?key|token|password|secret|bearer)"\s*:\s*)"[^"]*"/gi,
        '$1"[redacted]"',
      )
      // Plain "Authorization: Bearer xxxxx" headers stuffed into log strings
      .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
      // OpenAI-style sk-… tokens that show up unwrapped in the wild
      .replace(/sk-[A-Za-z0-9]{16,}/g, 'sk-[redacted]')
  );
}

let extensionChannel: ChannelImpl | undefined;
let webviewChannel: ChannelImpl | undefined;

/** Lazily create / return the host-side `Flowlib` channel. */
export function getExtensionLogger(): Logger & { scoped(scope: string): ScopedLogger } {
  if (!extensionChannel) {
    extensionChannel = new ChannelImpl('Flowlib');
  }
  return extensionChannel;
}

/** Lazily create / return the webview-forwarded `Flowlib (Webview)` channel. */
export function getWebviewLogger(): Logger & { scoped(scope: string): ScopedLogger } {
  if (!webviewChannel) {
    webviewChannel = new ChannelImpl('Flowlib (Webview)');
  }
  return webviewChannel;
}

/** Test-only: drop cached singletons so a fresh activation gets fresh channels. */
export function _resetLoggersForTests(
  injectedHost?: vscode.OutputChannel,
  injectedWebview?: vscode.OutputChannel,
): void {
  extensionChannel?.dispose();
  webviewChannel?.dispose();
  extensionChannel = injectedHost ? new ChannelImpl('Flowlib', injectedHost) : undefined;
  webviewChannel = injectedWebview
    ? new ChannelImpl('Flowlib (Webview)', injectedWebview)
    : undefined;
}
