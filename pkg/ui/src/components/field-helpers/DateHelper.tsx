import { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { HelperAdornmentProps } from './types';

/**
 * Calendar / datetime picker adornment. Self-disables when the field is
 * holding a `{{ template }}` literal — the picker can't operate on a
 * template string.
 */
export function DateHelper({ helper, value, onChange, context }: HelperAdornmentProps) {
  if (helper.kind !== 'date') {
    return null;
  }
  const mode = helper.mode ?? 'datetime';

  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isTemplate = typeof value === 'string' && value.includes('{{') && value.includes('}}');

  // Focus the native picker when popover opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const inputType = mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'datetime-local';

  // Convert stored ISO/string value → input-compatible string.
  const inputValue = (() => {
    if (isTemplate) {
      return '';
    }
    if (typeof value !== 'string' || !value) {
      return '';
    }
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        return value;
      }
      if (mode === 'date') {
        return d.toISOString().slice(0, 10);
      }
      if (mode === 'time') {
        return d.toISOString().slice(11, 16);
      }
      // datetime-local expects YYYY-MM-DDTHH:mm
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return value;
    }
  })();

  const tooltip = isTemplate
    ? 'Disabled while value is a template'
    : `Pick ${mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'date & time'}`;

  return (
    <Popover open={open} onOpenChange={(o) => !isTemplate && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          title={tooltip}
          disabled={isTemplate}
          aria-label={tooltip}
        >
          <Calendar className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        align="end"
        container={context.portalContainer ?? undefined}
      >
        <input
          ref={inputRef}
          type={inputType}
          className="h-8 text-xs px-2 border rounded bg-background"
          value={inputValue}
          min={helper.min}
          max={helper.max}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              onChange('');
              return;
            }
            // Normalize datetime-local back to ISO so backend gets a real ISO string.
            if (mode === 'datetime') {
              const d = new Date(v);
              onChange(Number.isNaN(d.getTime()) ? v : d.toISOString());
            } else {
              onChange(v);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
