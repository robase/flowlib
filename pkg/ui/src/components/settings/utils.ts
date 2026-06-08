/**
 * Core-contributed settings groups all live under the `core.*` namespace
 * (core.logging, core.triggers, core.execution, core.interface, core.infra).
 * Everything else is contributed by a registered plugin.
 */
export function isCoreNamespace(namespace: string): boolean {
  return namespace === 'core' || namespace.startsWith('core.');
}

export type SettingsSource = 'core' | 'plugin';

export function sourceForNamespace(namespace: string): SettingsSource {
  return isCoreNamespace(namespace) ? 'core' : 'plugin';
}
