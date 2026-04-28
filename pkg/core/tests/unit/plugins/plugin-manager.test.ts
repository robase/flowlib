/**
 * Unit tests for PluginManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod/v4';
import { PluginManager } from '../../../src/services/plugin-manager';
import type {
  FlowlibPlugin,
  FlowRunHookContext,
  NodeExecutionHookContext,
} from '../../../src/types/plugin.types';
import type { ActionDefinition } from '@flowlib/action-kit';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('PluginManager', () => {
  describe('Construction', () => {
    it('should accept empty plugin list', () => {
      const pm = new PluginManager([]);
      expect(pm.getPlugins()).toHaveLength(0);
    });

    it('should accept plugins', () => {
      const plugin: FlowlibPlugin = { id: 'test-plugin' };
      const pm = new PluginManager([plugin]);
      expect(pm.getPlugins()).toHaveLength(1);
      expect(pm.hasPlugin('test-plugin')).toBe(true);
    });

    it('should throw on duplicate plugin IDs', () => {
      const p1: FlowlibPlugin = { id: 'dup' };
      const p2: FlowlibPlugin = { id: 'dup' };
      expect(() => new PluginManager([p1, p2])).toThrow('Duplicate plugin ID: "dup"');
    });
  });

  describe('Plugin Lookup', () => {
    let pm: PluginManager;
    const pluginA: FlowlibPlugin = { id: 'a', name: 'Plugin A' };
    const pluginB: FlowlibPlugin = { id: 'b', name: 'Plugin B' };

    beforeEach(() => {
      pm = new PluginManager([pluginA, pluginB]);
    });

    it('hasPlugin returns true for registered plugins', () => {
      expect(pm.hasPlugin('a')).toBe(true);
      expect(pm.hasPlugin('b')).toBe(true);
    });

    it('hasPlugin returns false for unknown plugins', () => {
      expect(pm.hasPlugin('unknown')).toBe(false);
    });

    it('getPlugin returns the plugin or null', () => {
      expect(pm.getPlugin('a')).toBe(pluginA);
      expect(pm.getPlugin('nonexistent')).toBeNull();
    });
  });

  describe('initializePlugins', () => {
    it('should call init on each plugin', async () => {
      const initFn = vi.fn();
      const plugin: FlowlibPlugin = { id: 'init-test', init: initFn };
      const pm = new PluginManager([plugin]);

      await pm.initializePlugins({
        config: {},
        logger: mockLogger,
        registerAction: vi.fn(),
        getFlowlib: vi.fn() as never,
      });

      expect(initFn).toHaveBeenCalledOnce();
    });

    it('should register plugin actions', async () => {
      const registerAction = vi.fn();
      const fakeAction: ActionDefinition<Record<string, never>> = {
        id: 'test.action',
        name: 'Test',
        description: 'desc',
        provider: {
          id: 'test',
          name: 'Test',
          icon: 'Puzzle',
          category: 'custom',
          nodeCategory: 'Custom',
        },
        params: { schema: z.object({}), fields: [] },
        execute: vi.fn(async () => ({ success: true })),
      };
      const plugin: FlowlibPlugin = { id: 'action-test', actions: [fakeAction] };
      const pm = new PluginManager([plugin]);

      await pm.initializePlugins({
        config: {},
        logger: mockLogger,
        registerAction,
        getFlowlib: vi.fn() as never,
      });

      expect(registerAction).toHaveBeenCalledWith(fakeAction);
    });

    it('should throw when plugin init fails', async () => {
      const plugin: FlowlibPlugin = {
        id: 'fail-init',
        init: () => {
          throw new Error('boom');
        },
      };
      const pm = new PluginManager([plugin]);

      await expect(
        pm.initializePlugins({
          config: {},
          logger: mockLogger,
          registerAction: vi.fn(),
          getFlowlib: vi.fn() as never,
        }),
      ).rejects.toThrow('Plugin "fail-init" initialization failed: boom');
    });
  });

  describe('shutdownPlugins', () => {
    it('should call shutdown in reverse order', async () => {
      const order: string[] = [];
      const p1: FlowlibPlugin = {
        id: 'p1',
        shutdown: () => {
          order.push('p1');
        },
      };
      const p2: FlowlibPlugin = {
        id: 'p2',
        shutdown: () => {
          order.push('p2');
        },
      };
      const pm = new PluginManager([p1, p2]);

      await pm.shutdownPlugins(mockLogger);
      expect(order).toEqual(['p2', 'p1']);
    });

    it('should continue if a plugin shutdown throws', async () => {
      const p1: FlowlibPlugin = {
        id: 'p1',
        shutdown: () => {
          throw new Error('fail');
        },
      };
      const p2: FlowlibPlugin = { id: 'p2', shutdown: vi.fn() };
      const pm = new PluginManager([p1, p2]);

      // Should not throw
      await pm.shutdownPlugins(mockLogger);
      expect(p2.shutdown).toHaveBeenCalled();
    });
  });

  describe('getPluginEndpoints', () => {
    it('should collect endpoints from all plugins', () => {
      const p1: FlowlibPlugin = {
        id: 'p1',
        endpoints: [
          { method: 'GET', path: '/p1/items', handler: async () => ({ body: [] }), isPublic: true },
        ],
      };
      const p2: FlowlibPlugin = {
        id: 'p2',
        endpoints: [
          { method: 'POST', path: '/p2/create', handler: async () => ({ body: { ok: true } }) },
        ],
      };
      const pm = new PluginManager([p1, p2]);

      const endpoints = pm.getPluginEndpoints();
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0]!.path).toBe('/p1/items');
      expect(endpoints[1]!.path).toBe('/p2/create');
    });
  });

  describe('Hook Runner: beforeFlowRun', () => {
    const baseContext: FlowRunHookContext = {
      flowId: 'f1',
      flowRunId: 'fr1',
      flowVersion: 1,
      inputs: { key: 'value' },
    };

    it('should return not-cancelled if no hooks', async () => {
      const pm = new PluginManager([]);
      const result = await pm.runBeforeFlowRun(baseContext);
      expect(result.cancelled).toBe(false);
    });

    it('should allow plugins to cancel a flow run', async () => {
      const plugin: FlowlibPlugin = {
        id: 'canceller',
        hooks: {
          beforeFlowRun: async () => ({ cancel: true, reason: 'Rate limited' }),
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runBeforeFlowRun(baseContext);
      expect(result.cancelled).toBe(true);
      expect(result.reason).toContain('Rate limited');
    });

    it('should allow plugins to modify inputs', async () => {
      const plugin: FlowlibPlugin = {
        id: 'modifier',
        hooks: {
          beforeFlowRun: async (ctx) => ({ inputs: { ...ctx.inputs, added: true } }),
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runBeforeFlowRun(baseContext);
      expect(result.cancelled).toBe(false);
      expect(result.inputs).toEqual({ key: 'value', added: true });
    });

    it('should cancel on hook error', async () => {
      const plugin: FlowlibPlugin = {
        id: 'boom',
        hooks: {
          beforeFlowRun: async () => {
            throw new Error('hook crash');
          },
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runBeforeFlowRun(baseContext);
      expect(result.cancelled).toBe(true);
      expect(result.reason).toContain('hook crash');
    });
  });

  describe('Hook Runner: beforeNodeExecute', () => {
    const baseContext: NodeExecutionHookContext = {
      flowRun: { flowId: 'f1', flowRunId: 'fr1', flowVersion: 1, inputs: {} },
      nodeId: 'n1',
      nodeType: 'core.javascript',
      inputs: {},
      params: { code: '$input' },
    };

    it('should allow plugins to skip a node', async () => {
      const plugin: FlowlibPlugin = {
        id: 'skipper',
        hooks: {
          beforeNodeExecute: async () => ({ skip: true }),
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runBeforeNodeExecute(baseContext);
      expect(result.skipped).toBe(true);
    });

    it('should allow plugins to override params', async () => {
      const plugin: FlowlibPlugin = {
        id: 'param-override',
        hooks: {
          beforeNodeExecute: async () => ({ params: { code: '$input.modified' } }),
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runBeforeNodeExecute(baseContext);
      expect(result.skipped).toBe(false);
      expect(result.params).toEqual({ code: '$input.modified' });
    });
  });

  describe('Hook Runner: afterNodeExecute', () => {
    it('should allow plugins to override output', async () => {
      const plugin: FlowlibPlugin = {
        id: 'output-modifier',
        hooks: {
          afterNodeExecute: async () => ({ output: { overridden: true } }),
        },
      };
      const pm = new PluginManager([plugin]);

      const result = await pm.runAfterNodeExecute({
        flowRun: { flowId: 'f1', flowRunId: 'fr1', flowVersion: 1, inputs: {} },
        nodeId: 'n1',
        nodeType: 'core.javascript',
        inputs: {},
        params: {},
        status: 'SUCCESS',
        output: { original: true },
        duration: 100,
      });

      expect(result.output).toEqual({ overridden: true });
    });
  });

  describe('getPluginErrorCodes', () => {
    it('should merge error codes from all plugins', () => {
      const p1: FlowlibPlugin = {
        id: 'p1',
        $ERROR_CODES: { 'p1:not_found': { message: 'Not found', status: 404 } },
      };
      const p2: FlowlibPlugin = {
        id: 'p2',
        $ERROR_CODES: { 'p2:limit': { message: 'Rate limited', status: 429 } },
      };
      const pm = new PluginManager([p1, p2]);

      const codes = pm.getPluginErrorCodes();
      expect(codes['p1:not_found']!.status).toBe(404);
      expect(codes['p2:limit']!.status).toBe(429);
    });
  });
});
