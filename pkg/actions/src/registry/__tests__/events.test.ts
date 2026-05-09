/**
 * Tests for the ActionRegistry's EventEmitter-style register/unregister
 * surface (added in P0 for `@flowlib/agents` Stream G — live tool-list
 * hot-reload).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ActionRegistry } from '../index';
import type { ActionDefinition } from '@flowlib/action-kit';

function makeAction(id: string): ActionDefinition {
  return {
    id,
    name: `Test ${id}`,
    description: 'Test action',
    provider: {
      id: 'test',
      name: 'Test Provider',
      icon: 'TestTube',
      category: 'utility',
    },
    params: {
      schema: z.object({ value: z.string() }),
      fields: [
        {
          name: 'value',
          label: 'Value',
          type: 'string',
        },
      ],
    },
    async execute() {
      return { success: true, output: {} };
    },
  } as unknown as ActionDefinition;
}

describe('ActionRegistry register/unregister events', () => {
  it('fires onRegister when an action is registered', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    registry.onRegister(listener);

    const action = makeAction('test.alpha');
    registry.register(action);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(action);
  });

  it('fires multiple listeners in subscription order', () => {
    const registry = new ActionRegistry();
    const order: number[] = [];
    registry.onRegister(() => order.push(1));
    registry.onRegister(() => order.push(2));
    registry.onRegister(() => order.push(3));

    registry.register(makeAction('test.beta'));
    expect(order).toEqual([1, 2, 3]);
  });

  it('fires onUnregister when an action is removed', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    registry.onUnregister(listener);

    registry.register(makeAction('test.gamma'));
    const removed = registry.unregister('test.gamma');

    expect(removed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('test.gamma');
  });

  it('does not fire onUnregister when id is unknown', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    registry.onUnregister(listener);

    const removed = registry.unregister('test.never-registered');
    expect(removed).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire after the unsubscribe function is called', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onRegister(listener);

    registry.register(makeAction('test.delta'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    registry.register(makeAction('test.epsilon'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors — one throwing listener does not block others', () => {
    const registry = new ActionRegistry();
    const good = vi.fn();
    registry.onRegister(() => {
      throw new Error('boom');
    });
    registry.onRegister(good);

    expect(() => registry.register(makeAction('test.zeta'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('overwriting an action fires onRegister again', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    registry.onRegister(listener);

    registry.register(makeAction('test.eta'));
    registry.register(makeAction('test.eta'));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unregister removes action from registry state', () => {
    const registry = new ActionRegistry();
    registry.register(makeAction('test.theta'));
    expect(registry.has('test.theta')).toBe(true);

    registry.unregister('test.theta');
    expect(registry.has('test.theta')).toBe(false);
    expect(registry.get('test.theta')).toBeUndefined();
  });

  it('unsubscribe is idempotent', () => {
    const registry = new ActionRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onRegister(listener);
    unsubscribe();
    unsubscribe();
    registry.register(makeAction('test.iota'));
    expect(listener).not.toHaveBeenCalled();
  });
});
