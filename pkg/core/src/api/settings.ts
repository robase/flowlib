/**
 * Settings API — generic namespaced key/value store on the FlowlibInstance.
 *
 * Used by both core surfaces and plugin code. Plugins typically read their
 * own settings during init() with `getOrDefault(key, fallback)` so that the
 * resolution chain stays "constructor option > DB override > schema default".
 */

import type { ServiceFactory } from '../services/service-factory';
import type { PluginManager } from '../services/plugin-manager';
import type { SettingsAPI, SettingsDescriptorGroup, SettingsFieldDescriptor } from './types';
import type { Logger } from '../schemas';

export function createSettingsAPI(
  sf: ServiceFactory,
  pluginManager: PluginManager,
  _logger: Logger,
  /**
   * Built-in descriptor groups contributed by `@flowlib/core` itself
   * (logging, execution, triggers, theme, db/encryption display fields).
   * Prepended to the plugin-contributed list so the UI shows core first.
   */
  coreDescriptors: SettingsDescriptorGroup[] = [],
): SettingsAPI {
  return {
    get(key) {
      return sf.getSettingsService().get(key);
    },

    getOrDefault(key, defaultValue) {
      return sf.getSettingsService().getOrDefault(key, defaultValue);
    },

    list(options) {
      return sf.getSettingsService().list(options);
    },

    getSanitized(key) {
      return sf.getSettingsService().getSanitized(key);
    },

    set(input) {
      return sf.getSettingsService().set(input);
    },

    delete(key, identity) {
      return sf.getSettingsService().delete(key, identity);
    },

    onChange(prefix, handler) {
      return sf.getSettingsService().onChange(prefix, handler);
    },

    /**
     * Aggregated descriptor list sourced from core + registered plugins.
     * Drives the generic `/settings` UI page.
     */
    getDescriptors(): SettingsDescriptorGroup[] {
      const plugins = pluginManager.getPlugins();
      const descriptors: SettingsDescriptorGroup[] = [...coreDescriptors];
      for (const plugin of plugins) {
        const settings = (plugin as unknown as { settings?: unknown }).settings;
        if (!settings) {
          continue;
        }
        if (Array.isArray(settings)) {
          descriptors.push({
            namespace: plugin.id,
            label: plugin.name ?? plugin.id,
            fields: settings as SettingsFieldDescriptor[],
          });
          continue;
        }
        const group = settings as Partial<SettingsDescriptorGroup>;
        descriptors.push({
          namespace: group.namespace ?? plugin.id,
          label: group.label ?? plugin.name ?? plugin.id,
          description: group.description,
          fields: group.fields ?? [],
        });
      }
      return descriptors;
    },
  };
}
