/**
 * Built-in `@flowlib/core` settings descriptor groups.
 *
 * Surfaces core-owned configuration on the generic /settings page in the
 * same shape plugins use. Editable fields (logging level + scopes,
 * triggers.cronEnabled) are hot-reloaded via `wireCoreSettingsHotReload`.
 * The remaining fields are display-only — they're bound to the running
 * process at startup and need a restart + flowlib.config.ts edit to change.
 */

import type { FlowlibConfig } from '../schemas';
import type { SettingsDescriptorGroup, SettingsFieldDescriptor } from './types';

const LOG_LEVEL_OPTIONS = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'silent', label: 'Silent' },
];

/**
 * Logging scopes consumers can independently override. Mirrors the docs in
 * `LoggingConfigSchema`.
 */
export const KNOWN_LOG_SCOPES = [
  'execution',
  'validation',
  'batch',
  'database',
  'node',
  'graph',
  'credentials',
  'ai',
  'template',
  'renderer',
  'flows',
  'versions',
  'http',
] as const;

export function buildCoreSettingsDescriptors(config: FlowlibConfig): SettingsDescriptorGroup[] {
  const exec = config.execution ?? {};
  const triggers = config.triggers ?? {};
  const logging = config.logging ?? {};
  const dbType = config.database.type;
  const dbDriver = config.database.driver;

  const loggingFields: SettingsFieldDescriptor[] = [
    {
      key: 'core.logging.level',
      label: 'Default log level',
      description:
        'Default level applied to every scope unless overridden below. Hot-reloads — change takes effect on the next log call.',
      type: 'select',
      options: LOG_LEVEL_OPTIONS,
      defaultValue: logging.level ?? 'info',
    },
    ...KNOWN_LOG_SCOPES.map((scope) => ({
      key: `core.logging.scopes.${scope}`,
      label: `Log level: ${scope}`,
      description: `Per-scope override for the ${scope} subsystem. Empty = use default.`,
      type: 'select' as const,
      options: [{ value: '', label: '(use default)' }, ...LOG_LEVEL_OPTIONS],
      defaultValue: logging.scopes?.[scope] ?? '',
    })),
  ];

  const executionFields: SettingsFieldDescriptor[] = [
    {
      key: 'core.execution.flowTimeoutMs',
      label: 'Flow timeout (ms)',
      description:
        'Configured in flowlib.config.ts. Heartbeat-staleness threshold the reaper uses to mark stuck runs as FAILED.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.flowTimeoutMs ?? 600_000,
    },
    {
      key: 'core.execution.modelNodeTimeoutMs',
      label: 'core.model timeout (ms)',
      description:
        'Configured in flowlib.config.ts. Per-node wall-clock for `core.model` unless overridden.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.modelNodeTimeoutMs ?? 300_000,
    },
    {
      key: 'core.execution.agentNodeTimeoutMs',
      label: 'core.agent timeout (ms)',
      description:
        'Configured in flowlib.config.ts. Per-node wall-clock for `core.agent` (the full loop).',
      type: 'number',
      readOnly: true,
      defaultValue: exec.agentNodeTimeoutMs ?? 900_000,
    },
    {
      key: 'core.execution.heartbeatIntervalMs',
      label: 'Heartbeat interval (ms)',
      description: 'Configured in flowlib.config.ts. Run-coordinator heartbeat tick period.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.heartbeatIntervalMs ?? 30_000,
    },
    {
      key: 'core.execution.staleRunCheckIntervalMs',
      label: 'Stale-run check interval (ms)',
      description: 'Configured in flowlib.config.ts. Reaper poll period.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.staleRunCheckIntervalMs ?? 60_000,
    },
    {
      key: 'core.execution.sseHeartbeatIntervalMs',
      label: 'SSE heartbeat interval (ms)',
      description:
        'Configured in flowlib.config.ts. Keep-alive frame period on the flow-run event stream.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.sseHeartbeatIntervalMs ?? 15_000,
    },
    {
      key: 'core.execution.maxConcurrentExecutions',
      label: 'Max concurrent executions',
      description: 'Configured in flowlib.config.ts. Parallelism cap on flow runs.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.maxConcurrentExecutions ?? 10,
    },
    {
      key: 'core.execution.defaultTimeout',
      label: 'Default timeout (ms)',
      description: 'Configured in flowlib.config.ts. Generic per-operation default.',
      type: 'number',
      readOnly: true,
      defaultValue: exec.defaultTimeout ?? 60_000,
    },
    {
      key: 'core.execution.enableTracing',
      label: 'Tracing enabled',
      description: 'Configured in flowlib.config.ts. Whether execution traces are recorded.',
      type: 'boolean',
      readOnly: true,
      defaultValue: exec.enableTracing ?? true,
    },
    {
      key: 'core.execution.persistence',
      label: 'Persistence strategy',
      description:
        "Configured in flowlib.config.ts. `per-node` writes one row per node; `per-run` buffers in memory and flushes once. Bound at startup because it's wired into the orchestrator's write path.",
      type: 'string',
      readOnly: true,
      defaultValue: exec.persistence ?? 'per-node',
    },
  ];

  const triggersFields: SettingsFieldDescriptor[] = [
    {
      key: 'core.triggers.cronEnabled',
      label: 'Cron scheduler enabled',
      description:
        'When off, cron triggers stop firing immediately. Hot-reloads — toggling here calls start/stopCronScheduler on the live instance.',
      type: 'boolean',
      defaultValue: triggers.cronEnabled ?? true,
    },
    {
      key: 'core.triggers.webhookBaseUrl',
      label: 'Webhook base URL',
      description:
        "Configured in flowlib.config.ts. Public base URL the editor displays when showing webhook URLs (e.g. \"https://api.example.com/flowlib\").",
      type: 'string',
      readOnly: true,
      defaultValue: triggers.webhookBaseUrl ?? '',
    },
  ];

  const interfaceFields: SettingsFieldDescriptor[] = [
    {
      key: 'core.theme',
      label: 'Theme',
      description:
        'Configured in flowlib.config.ts. The frontend reads this from the `<Flowlib config>` prop at mount; restart hosts to pick up a new value.',
      type: 'select',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ],
      readOnly: true,
      defaultValue: config.theme ?? 'dark',
    },
    {
      key: 'core.frontendPath',
      label: 'Frontend mount path',
      description: 'Configured in flowlib.config.ts.',
      type: 'string',
      readOnly: true,
      defaultValue: config.frontendPath ?? '',
    },
    {
      key: 'core.apiPath',
      label: 'API mount path',
      description: 'Configured in flowlib.config.ts.',
      type: 'string',
      readOnly: true,
      defaultValue: config.apiPath ?? '',
    },
  ];

  const infraFields: SettingsFieldDescriptor[] = [
    {
      key: 'core.database.type',
      label: 'Database type',
      description: 'Configured in flowlib.config.ts.',
      type: 'string',
      readOnly: true,
      defaultValue: dbType,
    },
    {
      key: 'core.database.driver',
      label: 'Database driver',
      description: 'Configured in flowlib.config.ts. Defaults are picked per dialect when unset.',
      type: 'string',
      readOnly: true,
      defaultValue: dbDriver ?? '(default)',
    },
    {
      key: 'core.database.name',
      label: 'Database name',
      description: 'Configured in flowlib.config.ts. Display label only.',
      type: 'string',
      readOnly: true,
      defaultValue: config.database.name ?? '',
    },
    {
      key: 'core.encryptionKeyConfigured',
      label: 'Encryption key',
      description:
        'Configured in flowlib.config.ts (typically via FLOWLIB_ENCRYPTION_KEY env). The actual value is never displayed.',
      type: 'string',
      readOnly: true,
      defaultValue: config.encryptionKey ? 'configured ✓' : 'NOT CONFIGURED',
    },
    {
      key: 'core.skipDatabaseInit',
      label: 'Skip DB init',
      description: 'Configured in flowlib.config.ts. Used by build-time scaffolding — usually false.',
      type: 'boolean',
      readOnly: true,
      defaultValue: config.skipDatabaseInit ?? false,
    },
    {
      key: 'core.skipStartupChecks',
      label: 'Skip startup checks',
      description:
        'Configured in flowlib.config.ts. Bypasses connectivity + table-existence probes at boot.',
      type: 'boolean',
      readOnly: true,
      defaultValue: config.skipStartupChecks ?? false,
    },
  ];

  return [
    {
      namespace: 'core.logging',
      label: 'Core: Logging',
      description:
        'Default and per-scope log levels. Hot-reloads — changes take effect on the next log emission.',
      fields: loggingFields,
    },
    {
      namespace: 'core.triggers',
      label: 'Core: Triggers',
      description:
        'Trigger system settings. `cronEnabled` hot-reloads (start/stopCronScheduler is called); webhookBaseUrl is config-bound.',
      fields: triggersFields,
    },
    {
      namespace: 'core.execution',
      label: 'Core: Execution',
      description:
        'Execution timeouts and persistence strategy. All bound at startup — change in flowlib.config.ts and restart.',
      fields: executionFields,
    },
    {
      namespace: 'core.interface',
      label: 'Core: Interface',
      description: 'UI mount paths and theme. Read at frontend mount — change in flowlib.config.ts.',
      fields: interfaceFields,
    },
    {
      namespace: 'core.infra',
      label: 'Core: Infrastructure',
      description:
        'Database, encryption, and startup gates. Display-only — these are bound to the running process.',
      fields: infraFields,
    },
  ];
}
