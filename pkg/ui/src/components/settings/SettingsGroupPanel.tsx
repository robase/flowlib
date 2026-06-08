import React from 'react';
import { SettingRow } from './SettingRow';
import type { SettingsSource } from './utils';
import type { SettingsDescriptorGroup, SettingsRecord } from '../../api/types';

interface SettingsGroupPanelProps {
  group: SettingsDescriptorGroup;
  recordsByKey: Map<string, SettingsRecord>;
  source: SettingsSource;
  query: string;
}

export const SettingsGroupPanel: React.FC<SettingsGroupPanelProps> = ({
  group,
  recordsByKey,
  source,
  query,
}) => {
  const q = query.trim().toLowerCase();
  const fields = q
    ? group.fields.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.key.toLowerCase().includes(q) ||
          f.description?.toLowerCase().includes(q),
      )
    : group.fields;

  if (fields.length === 0) {
    return null;
  }

  const editable = fields.filter((f) => !f.readOnly);
  const readOnly = fields.filter((f) => f.readOnly);

  return (
    <section className="space-y-5" aria-labelledby={`group-${group.namespace}`}>
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h2
            id={`group-${group.namespace}`}
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            {group.label}
          </h2>
          {source === 'plugin' && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              plugin
            </span>
          )}
        </div>
        {group.description && (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {group.description}
          </p>
        )}
      </header>

      {editable.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-card px-4 sm:px-6">
          {editable.map((field) => (
            <SettingRow key={field.key} field={field} record={recordsByKey.get(field.key)} />
          ))}
        </div>
      )}

      {readOnly.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Read-only configuration
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            These values are bound at startup. Change them in{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              flowlib.config.ts
            </code>{' '}
            and restart.
          </p>
          <div className="divide-y divide-border rounded-lg border border-border bg-muted/30 px-4 sm:px-6">
            {readOnly.map((field) => (
              <SettingRow key={field.key} field={field} record={recordsByKey.get(field.key)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
