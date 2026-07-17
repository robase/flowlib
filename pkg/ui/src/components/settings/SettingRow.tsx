import React, { useEffect, useState } from 'react';
import { Lock, Loader2, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { FieldControl } from './FieldControl';
import { useSetSetting, useDeleteSetting } from '../../api/settings.api';
import type { SettingsFieldDescriptor, SettingsRecord } from '../../api/types';

interface SettingRowProps {
  field: SettingsFieldDescriptor;
  record?: SettingsRecord;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

const ReadOnlyValue: React.FC<{ field: SettingsFieldDescriptor; value: unknown }> = ({
  field,
  value,
}) => {
  const isSensitive = field.sensitive === true || field.type === 'secret';
  const display = stringifyValue(value);

  // Encrypted, config-bound secrets never reveal their value — the backend
  // sends a status string (e.g. "configured ✓" / "NOT CONFIGURED").
  if (isSensitive) {
    const configured = display.length > 0 && !/not configured/i.test(display);
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-mono text-sm',
          configured ? 'text-success' : 'text-destructive',
        )}
      >
        {configured ? (
          <>
            <Check className="h-3.5 w-3.5" /> {display || 'configured'}
          </>
        ) : (
          display || 'NOT CONFIGURED'
        )}
      </span>
    );
  }

  if (field.type === 'boolean') {
    return <span className="font-mono text-sm text-foreground">{value ? 'true' : 'false'}</span>;
  }

  const isUnset = display === '';
  return (
    <span
      className={cn(
        'font-mono text-sm break-all',
        isUnset ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {isUnset ? '(unset)' : display}
    </span>
  );
};

export const SettingRow: React.FC<SettingRowProps> = ({ field, record }) => {
  const setMutation = useSetSetting();
  const deleteMutation = useDeleteSetting();

  const isSensitive = field.sensitive === true || field.type === 'secret';
  const isReadOnly = field.readOnly === true;
  const hasOverride = Boolean(record);

  const [draft, setDraft] = useState<unknown>(record?.value ?? field.defaultValue ?? '');
  const [dirty, setDirty] = useState(false);

  // When the upstream record changes (e.g. after a successful save), pull the
  // new value into the draft so the control reflects what's persisted.
  useEffect(() => {
    if (!dirty) {
      setDraft(record?.value ?? field.defaultValue ?? '');
    }
  }, [record?.value, field.defaultValue, dirty]);

  // Secrets are write-only: the persisted value is never shown, so dirtiness is
  // purely whether the operator has typed a new value.
  const effectiveDirty =
    field.type === 'secret' ? typeof draft === 'string' && draft.length > 0 : dirty;

  const saving = setMutation.isPending;
  const error = setMutation.isError
    ? ((setMutation.error as Error)?.message ?? 'Failed to save')
    : null;

  const onSave = () => {
    setMutation.mutate(
      { key: field.key, input: { value: draft, encrypted: isSensitive } },
      { onSuccess: () => setDirty(false) },
    );
  };

  const onReset = () => {
    deleteMutation.mutate(field.key, {
      onSuccess: () => {
        setDraft(field.defaultValue ?? '');
        setDirty(false);
      },
    });
  };

  return (
    <div className="py-3.5">
      {/* HEADER ROW — title (left) aligned with control + buttons (right) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{field.label}</h3>
          {isSensitive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> encrypted
            </span>
          )}
        </div>

        {isReadOnly ? (
          <div className="ml-auto flex min-h-8 items-center">
            <ReadOnlyValue field={field} value={record?.value ?? field.defaultValue ?? null} />
          </div>
        ) : (
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 sm:min-w-80 sm:flex-none">
            {hasOverride && !effectiveDirty && (
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={onReset}
                className="shrink-0 text-muted-foreground"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
              <FieldControl
                field={field}
                value={draft}
                recordExists={hasOverride}
                disabled={saving}
                onChange={(v) => {
                  setDraft(v);
                  setDirty(true);
                }}
              />
            </div>
            <Button
              size="sm"
              disabled={!effectiveDirty || saving}
              onClick={onSave}
              className="shrink-0"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </div>

      {/* DESCRIPTION — beneath the header row. The `config-bound` chip rides
          the right of this line, under the value it qualifies. */}
      {(field.description || isReadOnly) && (
        <div className="mt-1.5 flex items-start gap-4">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {field.description}
            {field.helpUrl && (
              <>
                {' '}
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  learn more
                </a>
              </>
            )}
          </p>
          {isReadOnly && (
            <Badge
              variant="outline"
              className="ml-auto mt-0.5 text-[11px] font-normal text-muted-foreground"
            >
              config-bound
            </Badge>
          )}
        </div>
      )}

      {!isReadOnly && error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
};
