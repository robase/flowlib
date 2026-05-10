/**
 * Session manager for MCP Streamable HTTP transport.
 *
 * One `{ transport, server }` pair per MCP session id. Sessions are created
 * when the client sends `initialize` and torn down on DELETE or TTL expiry.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  lastSeenAt: number;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = 30 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** Update the session TTL. Future cleanup ticks use the new value. */
  setTtlMs(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      this.ttlMs = Math.floor(value);
    }
  }

  /** Start periodic cleanup of expired sessions */
  startCleanup(intervalMs: number = 60_000): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired();
    }, intervalMs);
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === 'object' &&
      'unref' in this.cleanupTimer
    ) {
      this.cleanupTimer.unref();
    }
  }

  /** Stop periodic cleanup */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Register a new session */
  set(sessionId: string, entry: Omit<SessionEntry, 'createdAt' | 'lastSeenAt'>): void {
    const now = Date.now();
    this.sessions.set(sessionId, { ...entry, createdAt: now, lastSeenAt: now });
  }

  /** Get a session's entry and refresh its lastSeenAt */
  touch(sessionId: string): SessionEntry | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastSeenAt = Date.now();
    }
    return entry;
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }
    this.sessions.delete(sessionId);
    await this.closeEntry(entry);
    return true;
  }

  /** Remove sessions that exceed the TTL (since lastSeenAt) */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const toClose: SessionEntry[] = [];
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastSeenAt > this.ttlMs) {
        this.sessions.delete(id);
        toClose.push(entry);
      }
    }
    for (const entry of toClose) {
      await this.closeEntry(entry);
    }
    return toClose.length;
  }

  get size(): number {
    return this.sessions.size;
  }

  async closeAll(): Promise<void> {
    this.stopCleanup();
    const entries = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const entry of entries) {
      await this.closeEntry(entry);
    }
  }

  private async closeEntry(entry: SessionEntry): Promise<void> {
    try {
      await entry.transport.close();
    } catch {
      // best-effort
    }
    try {
      await entry.server.close();
    } catch {
      // best-effort
    }
  }
}
