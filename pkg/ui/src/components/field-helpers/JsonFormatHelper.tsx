import { useState } from 'react';
import { Braces, Check, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import type { HelperAdornmentProps } from './types';

/**
 * JSON pretty-print + validate adornment. Reformats the field value to
 * 2-space indented JSON; flashes a check on success or a warning on parse
 * error. Self-disables for templated values.
 */
export function JsonFormatHelper({ value, onChange }: HelperAdornmentProps) {
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');

  const isTemplate = typeof value === 'string' && value.includes('{{') && value.includes('}}');

  const handleClick = () => {
    if (typeof value !== 'string' || !value.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
      setStatus('ok');
    } catch {
      setStatus('err');
    }
    setTimeout(() => setStatus('idle'), 1200);
  };

  const Icon = status === 'ok' ? Check : status === 'err' ? AlertTriangle : Braces;
  const tooltip = isTemplate
    ? 'Disabled while value is a template'
    : status === 'err'
      ? 'Invalid JSON'
      : 'Format & validate JSON';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 shrink-0"
      onClick={handleClick}
      title={tooltip}
      disabled={isTemplate}
      aria-label={tooltip}
    >
      <Icon
        className={`h-3.5 w-3.5 ${status === 'ok' ? 'text-green-600' : status === 'err' ? 'text-destructive' : ''}`}
      />
    </Button>
  );
}
