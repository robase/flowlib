import React from 'react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { SettingsFieldDescriptor } from '../../api/types';

interface FieldControlProps {
  field: SettingsFieldDescriptor;
  /** The current draft value (already initialised from the persisted record). */
  value: unknown;
  onChange: (next: unknown) => void;
  /** Whether a saved override exists — used to hint at "already set" secrets. */
  recordExists: boolean;
  disabled?: boolean;
}

// Radix <SelectItem /> forbids empty-string values, so translate "" to a
// sentinel for rendering only. Stored values stay as "".
const EMPTY_SENTINEL = '__empty__';
const toSentinel = (v: string) => (v === '' ? EMPTY_SENTINEL : v);
const fromSentinel = (v: string) => (v === EMPTY_SENTINEL ? '' : v);

/**
 * Polymorphic control rendered by `field.type`. Read-only fields are handled
 * separately by `ReadOnlyValue` in SettingRow — this only renders editable
 * controls. Mirrors the typed-value contract of the backend (`unknown`).
 */
export const FieldControl: React.FC<FieldControlProps> = ({
  field,
  value,
  onChange,
  recordExists,
  disabled,
}) => {
  const isSensitive = field.sensitive === true || field.type === 'secret';
  const placeholder =
    field.placeholder ?? (isSensitive && recordExists ? '•••••••• (set — re-enter to change)' : '');

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center sm:justify-end">
        <Switch
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={field.label}
        />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <Select
        value={toSentinel(String(value ?? ''))}
        disabled={disabled}
        onValueChange={(v) => onChange(fromSentinel(v))}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder || 'Select…'} />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((opt) => (
            <SelectItem key={opt.value} value={toSentinel(opt.value)}>
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
        inputMode="numeric"
        value={value === null || value === undefined ? '' : String(value)}
        disabled={disabled}
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
        className="font-mono text-xs"
        value={display}
        disabled={disabled}
        placeholder={placeholder || (field.type === 'json' ? '[]' : undefined)}
        onChange={(e) => {
          const raw = e.target.value;
          if (field.type === 'json') {
            try {
              onChange(raw === '' ? null : JSON.parse(raw));
            } catch {
              // Stash raw string while invalid; backend re-validates anyway.
              onChange(raw);
            }
            return;
          }
          onChange(raw);
        }}
      />
    );
  }

  // string / secret
  return (
    <Input
      id={field.key}
      type={isSensitive ? 'password' : 'text'}
      className={isSensitive ? 'font-mono' : undefined}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};
