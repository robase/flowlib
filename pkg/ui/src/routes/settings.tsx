import React, { useMemo, useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Loader2, Trash2, Lock } from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { useDocumentTitle } from '../hooks/use-document-title';
import {
  useSettings,
  useSettingsDescriptors,
  useSetSetting,
  useDeleteSetting,
} from '../api/settings.api';
import type {
  SettingsDescriptorGroup,
  SettingsFieldDescriptor,
  SettingsRecord,
} from '../api/types';

export interface SettingsPageProps {
  basePath?: string;
}

export const Settings: React.FC<SettingsPageProps> = ({ basePath: _basePath = '/flowlib' }) => {
  useDocumentTitle('settings');
  const { data: groups, isLoading: groupsLoading } = useSettingsDescriptors();
  const { data: settings, isLoading: settingsLoading } = useSettings();

  const recordsByKey = useMemo(() => {
    const map = new Map<string, SettingsRecord>();
    for (const r of settings ?? []) {
      map.set(r.key, r);
    }
    return map;
  }, [settings]);

  if (groupsLoading || settingsLoading) {
    return (
      <PageLayout title="Settings" icon={SettingsIcon}>
        <div className="flex items-center gap-2 text-fl-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading settings…
        </div>
      </PageLayout>
    );
  }

  const safeGroups: SettingsDescriptorGroup[] = groups ?? [];

  return (
    <PageLayout
      title="Settings"
      subtitle="Runtime configuration for the core app and registered plugins."
      icon={SettingsIcon}
    >
      {safeGroups.length === 0 ? (
        <div className="rounded-md border border-fl-border bg-fl-card p-6 text-sm text-fl-muted-foreground">
          No plugins have contributed settings.
        </div>
      ) : (
        <div className="space-y-8">
          {safeGroups.map((group) => (
            <SettingsGroupCard key={group.namespace} group={group} recordsByKey={recordsByKey} />
          ))}
        </div>
      )}
    </PageLayout>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Group card
// ─────────────────────────────────────────────────────────────────────

const SettingsGroupCard: React.FC<{
  group: SettingsDescriptorGroup;
  recordsByKey: Map<string, SettingsRecord>;
}> = ({ group, recordsByKey }) => {
  return (
    <section className="rounded-lg border border-fl-border bg-fl-card">
      <header className="border-b border-fl-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{group.label}</h2>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {group.namespace}
          </Badge>
        </div>
        {group.description && (
          <p className="mt-1 text-sm text-fl-muted-foreground">{group.description}</p>
        )}
      </header>
      <div className="divide-y divide-fl-border">
        {group.fields.map((field) => (
          <SettingFieldRow key={field.key} field={field} record={recordsByKey.get(field.key)} />
        ))}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Single field row
// ─────────────────────────────────────────────────────────────────────

const SettingFieldRow: React.FC<{
  field: SettingsFieldDescriptor;
  record?: SettingsRecord;
}> = ({ field, record }) => {
  const setMutation = useSetSetting();
  const deleteMutation = useDeleteSetting();

  const isSensitive = field.sensitive === true || field.type === 'secret';
  const initialValue: unknown = record?.value ?? field.defaultValue ?? '';

  const [draft, setDraft] = useState<unknown>(initialValue);
  const [dirty, setDirty] = useState(false);

  // When the upstream record changes (e.g. after a successful save), pull
  // the new value into the draft so the input reflects what's persisted.
  useEffect(() => {
    if (!dirty) {
      setDraft(record?.value ?? field.defaultValue ?? '');
    }
  }, [record?.value, field.defaultValue, dirty]);

  const onSave = () => {
    setMutation.mutate(
      {
        key: field.key,
        input: { value: draft, encrypted: isSensitive },
      },
      { onSuccess: () => setDirty(false) },
    );
  };

  const onClear = () => {
    deleteMutation.mutate(field.key, {
      onSuccess: () => {
        setDraft(field.defaultValue ?? '');
        setDirty(false);
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 sm:max-w-md">
        <div className="flex items-center gap-2">
          <Label htmlFor={field.key} className="text-sm font-medium">
            {field.label}
          </Label>
          {isSensitive && (
            <span className="inline-flex items-center gap-1 text-[10px] text-fl-muted-foreground">
              <Lock className="h-3 w-3" /> encrypted
            </span>
          )}
          {field.readOnly && (
            <Badge variant="outline" className="text-[10px]">
              read-only
            </Badge>
          )}
        </div>
        {field.description && (
          <p className="mt-1 text-xs text-fl-muted-foreground">
            {field.description}
            {field.helpUrl && (
              <>
                {' '}
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-fl-primary underline"
                >
                  learn more
                </a>
              </>
            )}
          </p>
        )}
        <p className="mt-1 font-mono text-[10px] text-fl-muted-foreground">{field.key}</p>
      </div>

      <div className="flex flex-1 flex-col gap-2 sm:max-w-sm">
        <FieldInput
          field={field}
          value={draft}
          onChange={(v) => {
            setDraft(v);
            setDirty(true);
          }}
          recordExists={Boolean(record)}
        />
        {!field.readOnly && (
          <div className="flex justify-end gap-2">
            {record && (
              <Button
                size="sm"
                variant="ghost"
                disabled={deleteMutation.isPending}
                onClick={onClear}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Reset
              </Button>
            )}
            <Button size="sm" disabled={!dirty || setMutation.isPending} onClick={onSave}>
              {setMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Save className="mr-1 h-3 w-3" />
              )}
              Save
            </Button>
          </div>
        )}
        {setMutation.isError && (
          <p className="text-xs text-red-500">
            {(setMutation.error as Error)?.message ?? 'Failed to save'}
          </p>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Polymorphic input renderer
// ─────────────────────────────────────────────────────────────────────

const FieldInput: React.FC<{
  field: SettingsFieldDescriptor;
  value: unknown;
  onChange: (v: unknown) => void;
  recordExists: boolean;
}> = ({ field, value, onChange, recordExists }) => {
  const isSensitive = field.sensitive === true || field.type === 'secret';
  const placeholder =
    field.placeholder ?? (isSensitive && recordExists ? '•••••••• (set — re-enter to change)' : '');

  if (field.readOnly) {
    return (
      <div className="rounded-md border border-fl-border bg-fl-muted/30 px-3 py-2 font-mono text-xs text-fl-muted-foreground">
        {value === null || value === undefined || value === ''
          ? '(unset)'
          : typeof value === 'string'
            ? value
            : JSON.stringify(value)}
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-end">
        <Switch checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '')} onValueChange={(v) => onChange(v)}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'number') {
    return (
      <Input
        id={field.key}
        type="number"
        value={value === null || value === undefined ? '' : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
      />
    );
  }

  if (field.type === 'textarea' || field.type === 'json') {
    const display =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : JSON.stringify(value, null, 2);
    return (
      <Textarea
        id={field.key}
        rows={4}
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (field.type === 'json') {
            try {
              onChange(raw === '' ? null : JSON.parse(raw));
            } catch {
              // Stash raw string while invalid; backend re-validates anyway
              onChange(raw);
            }
            return;
          }
          onChange(raw);
        }}
        className="font-mono text-xs"
      />
    );
  }

  // string / secret
  return (
    <Input
      id={field.key}
      type={isSensitive ? 'password' : 'text'}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

export default Settings;
