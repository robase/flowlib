/**
 * Unit tests for ExecutionEventBus, RemoteEventBus, and NoopEventBus.
 *
 *   - `ExecutionEventBus` formally implements `ExecutionEventBusAdapter`
 *     (compile-time check via assignment).
 *   - `RemoteEventBus` forwards `emit` to the injected `publish` callback
 *     and `subscribe` to the injected `subscribe` callback.
 *   - `NoopEventBus.subscribe()` returns an idempotent no-op disposer.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ExecutionEventBus,
  RemoteEventBus,
  NoopEventBus,
  type ExecutionStreamEvent,
  type FlowRunUpdatedEvent,
} from '../../../src/services/execution-event-bus';
import type { ExecutionEventBusAdapter } from '../../../src/types/services';
import type { FlowRun } from '../../../src/services/flow-runs/flow-runs.model';

function makeFlowRun(): FlowRun {
  return {
    id: 'run-1',
    flowId: 'flow-1',
    flowVersionId: 'fv-1',
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    inputs: null,
    outputs: null,
    error: null,
    metadata: null,
  } as unknown as FlowRun;
}

describe('ExecutionEventBus', () => {
  it('satisfies the ExecutionEventBusAdapter interface (compile-time check)', () => {
    // If `ExecutionEventBus` ever drifts from `ExecutionEventBusAdapter`, this
    // assignment will fail at type-check time. The runtime expectation is
    // trivially that we can construct one and assign it to the adapter type.
    const bus = new ExecutionEventBus();
    const adapter: ExecutionEventBusAdapter = bus;
    expect(typeof adapter.emit).toBe('function');
    expect(typeof adapter.subscribe).toBe('function');
  });

  it('emit(flow_run.updated) routes to per-run subscribers', () => {
    const bus = new ExecutionEventBus();
    const flowRun = makeFlowRun();
    const handler = vi.fn();

    const off = bus.subscribe(flowRun.id, handler);
    const event: FlowRunUpdatedEvent = { type: 'flow_run.updated', flowRun };
    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);

    off();
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('RemoteEventBus', () => {
  it('calls injected publish callback on emit', async () => {
    const publish = vi.fn();
    const subscribe = vi.fn(() => () => {
      // noop
    });
    const bus = new RemoteEventBus({ publish, subscribe });

    const flowRun = makeFlowRun();
    const event: FlowRunUpdatedEvent = { type: 'flow_run.updated', flowRun };
    await bus.emit(event);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });

  it('forwards subscribe to the injected callback and disposer cleans up', () => {
    const publish = vi.fn();
    const off = vi.fn();
    const subscribe = vi.fn(() => off);
    const bus = new RemoteEventBus({ publish, subscribe });

    const handler = vi.fn();
    const dispose = bus.subscribe('run-1', handler);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('run-1', handler);

    dispose();
    expect(off).toHaveBeenCalledTimes(1);

    // Idempotent — calling twice doesn't double-dispose.
    dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('handles async subscribe callbacks (host returns Promise<() => void>)', async () => {
    const off = vi.fn();
    const subscribe = vi.fn(() => Promise.resolve(off));
    const bus = new RemoteEventBus({
      publish: vi.fn(),
      subscribe,
    });

    const dispose = bus.subscribe('run-1', vi.fn());

    // Let the promise resolve.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('honors disposal even if subscribe resolves after dispose was called', async () => {
    const off = vi.fn();
    let resolveSubscribe: (fn: () => void) => void = () => {};
    const subscribe = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveSubscribe = resolve;
        }),
    );
    const bus = new RemoteEventBus({
      publish: vi.fn(),
      subscribe,
    });

    const dispose = bus.subscribe('run-1', vi.fn());
    // Caller disposes BEFORE the host resolves the subscription.
    dispose();
    // Now the host resolves — the bus must tear down immediately.
    resolveSubscribe(off);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('NoopEventBus', () => {
  it('drops emits silently and subscribe returns an idempotent no-op disposer', () => {
    const bus = new NoopEventBus();
    const handler = vi.fn();
    const event: ExecutionStreamEvent = { type: 'heartbeat' };

    bus.emit(event);
    const dispose = bus.subscribe('run-1', handler);

    // Calling the disposer twice is safe.
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();

    // Handler is never invoked.
    expect(handler).not.toHaveBeenCalled();
  });

  it('satisfies the ExecutionEventBusAdapter interface', () => {
    const bus = new NoopEventBus();
    const adapter: ExecutionEventBusAdapter = bus;
    expect(typeof adapter.emit).toBe('function');
    expect(typeof adapter.subscribe).toBe('function');
  });
});
