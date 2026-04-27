/**
 * Active Chat Sessions
 *
 * In-process registry of in-flight chat streams. Lets a single turn of
 * generation survive client disconnects (e.g. page refresh) by decoupling
 * the agent loop from the HTTP request that spawned it.
 *
 * Each session holds:
 *   - a bounded FIFO buffer of events emitted so far (for replay on reattach)
 *   - a set of live subscribers fanning out new events in real time
 *   - a "done" flag + optional final error
 *   - an eviction timer that fires RECONNECT_GRACE_MS after completion so
 *     late reattaches still land
 *
 * Single-process only. Multi-instance deployments need sticky sessions or a
 * Redis-backed implementation of this same shape.
 */

import type { Logger } from 'src/schemas';
import type { ChatStreamEvent } from './chat-types';

/** Grace window to keep a completed session around for a late reattach. */
const RECONNECT_GRACE_MS = 60_000;
/**
 * Hard cap on the per-session event buffer. Normal turns emit ~50–300 events;
 * a very tool-heavy agent might emit more. Truncating the oldest keeps us
 * from pinning memory on a runaway session.
 */
const MAX_BUFFERED_EVENTS = 5_000;
/**
 * Absolute fallback TTL — evict any session older than this even if the
 * adapter never called `close()` (runaway, bug, or crashed producer).
 */
const MAX_SESSION_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes

export interface ActiveChatSession {
  /** Public identifier exposed to clients. */
  readonly id: string;
  /** Optional flow scope — used by the frontend to route reattaches. */
  readonly flowId?: string;
  /** Wall-clock start, set at create. */
  readonly startedAt: number;
  /** Set once the producer finishes (successfully or with error). */
  done: boolean;
  /** Final error if the producer threw. */
  error?: string;
  /** FIFO of every event emitted. Replayed verbatim on reattach. */
  readonly events: ChatStreamEvent[];
  /** Live fan-out — each subscriber receives a new event as it's pushed. */
  readonly subscribers: Set<(event: ChatStreamEvent | null) => void>;
  /** Timer that evicts the session from the registry. */
  evictTimer?: ReturnType<typeof setTimeout>;
}

export type ChatSessionUnsubscribe = () => void;

export class ActiveChatSessions {
  private readonly sessions = new Map<string, ActiveChatSession>();

  constructor(private readonly logger: Logger) {}

  /**
   * Register a new session. The caller is responsible for producing events
   * via `push()` and calling `close()` when generation finishes.
   */
  create(options: { flowId?: string; id?: string } = {}): ActiveChatSession {
    const id = options.id ?? crypto.randomUUID();
    const session: ActiveChatSession = {
      id,
      flowId: options.flowId,
      startedAt: Date.now(),
      done: false,
      events: [],
      subscribers: new Set(),
    };
    // Absolute TTL fallback so a stuck producer can't leak forever.
    session.evictTimer = setTimeout(() => {
      if (!session.done) {
        this.logger.warn(`Chat session ${id} exceeded max lifetime, evicting`);
        this.close(id, 'Session exceeded maximum lifetime');
      }
    }, MAX_SESSION_LIFETIME_MS);
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ActiveChatSession | null {
    return this.sessions.get(id) ?? null;
  }

  /**
   * Append an event and fan it out to every live subscriber.
   * Drops the oldest event if the buffer exceeds its cap so replay never
   * blows up on runaway turns.
   */
  push(id: string, event: ChatStreamEvent): void {
    const session = this.sessions.get(id);
    if (!session || session.done) {
      return;
    }

    session.events.push(event);
    if (session.events.length > MAX_BUFFERED_EVENTS) {
      session.events.shift();
    }
    for (const subscriber of session.subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        this.logger.warn('Chat session subscriber threw, removing', { error: err });
        session.subscribers.delete(subscriber);
      }
    }
  }

  /**
   * Mark a session complete. Fans out a null sentinel to every subscriber so
   * iterators can exit their loop, then schedules eviction after the grace
   * window so late reattaches still get the full replay.
   */
  close(id: string, error?: string): void {
    const session = this.sessions.get(id);
    if (!session || session.done) {
      return;
    }

    session.done = true;
    if (error) {
      session.error = error;
    }

    for (const subscriber of session.subscribers) {
      try {
        subscriber(null);
      } catch {
        // best-effort teardown
      }
    }

    if (session.evictTimer) {
      clearTimeout(session.evictTimer);
    }
    session.evictTimer = setTimeout(() => {
      this.sessions.delete(id);
    }, RECONNECT_GRACE_MS);
  }

  /**
   * Subscribe to a session as an async iterator. Replays every buffered event
   * first (so a refreshed client sees its full prior state), then tails live
   * events until the session closes.
   *
   * If `signal` fires, the iterator exits but the session itself continues
   * running so other subscribers (or a later reattach) can still consume it.
   */
  async *subscribe(id: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const session = this.sessions.get(id);
    if (!session) {
      yield { type: 'error', message: `Chat session ${id} not found`, recoverable: false };
      return;
    }

    // Replay buffered events synchronously — a fresh reattach needs to catch
    // up to the live edge before it can meaningfully tail.
    const replay = session.events.slice();
    for (const event of replay) {
      if (signal?.aborted) {
        return;
      }
      yield event;
    }

    // Tail — register a subscriber that pushes into a local queue, then yield
    // each queued item in order. If the session is already done, we've already
    // replayed everything and can just return.
    if (session.done) {
      return;
    }

    const queue: (ChatStreamEvent | null)[] = [];
    let waiter: ((v: void) => void) | null = null;
    const subscriber = (event: ChatStreamEvent | null) => {
      queue.push(event);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    };
    session.subscribers.add(subscriber);

    const onAbort = () => {
      subscriber(null);
    };
    if (signal) {
      if (signal.aborted) {
        session.subscribers.delete(subscriber);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
        }
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === null || next === undefined) {
            return;
          }
          if (signal?.aborted) {
            return;
          }
          yield next;
        }
      }
    } finally {
      session.subscribers.delete(subscriber);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Evict any session that has either:
   *   - exceeded `MAX_SESSION_LIFETIME_MS` since `startedAt` (runaway producer), OR
   *   - completed (`done=true`) AND lived past `RECONNECT_GRACE_MS`
   *     (i.e. the per-session evict timer would have fired by now).
   *
   * PR 5/14 (flowlib-hosted/UPSTREAM.md) — provided so hosts on serverless
   * / edge runtimes can drive eviction from an external cron entry point
   * (`flowlib.maintenance.evictExpiredChatSessions()`) instead of relying on
   * per-session `setTimeout`s that don't run between worker invocations.
   * Long-lived Node processes use the in-process `setTimeout`s (set in
   * `create()` and `close()`) and rarely need to call this.
   *
   * Returns the number of sessions evicted.
   */
  evictExpiredSessions(now: number = Date.now()): { count: number } {
    let count = 0;
    for (const [id, session] of this.sessions) {
      const aged = now - session.startedAt > MAX_SESSION_LIFETIME_MS;
      const completedAndExpired = session.done && now - session.startedAt > RECONNECT_GRACE_MS;
      if (!aged && !completedAndExpired) {
        continue;
      }
      if (session.evictTimer) {
        clearTimeout(session.evictTimer);
      }
      // Live subscribers must see closure before the session disappears.
      if (!session.done) {
        for (const subscriber of session.subscribers) {
          try {
            subscriber(null);
          } catch {
            // best-effort teardown
          }
        }
      }
      this.sessions.delete(id);
      count += 1;
    }
    if (count > 0) {
      this.logger.debug('Evicted expired chat sessions', { count });
    }
    return { count };
  }

  /** Evict every session — called on shutdown. */
  shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.evictTimer) {
        clearTimeout(session.evictTimer);
      }
      for (const subscriber of session.subscribers) {
        try {
          subscriber(null);
        } catch {
          // best-effort
        }
      }
    }
    this.sessions.clear();
  }

  /** Diagnostic — live session count. */
  size(): number {
    return this.sessions.size;
  }
}
