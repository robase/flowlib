/**
 * OtpInput — N-cell one-time code input.
 *
 * Hand-rolled (no `input-otp` dep) because we only need the basics: per-digit
 * focus advance, paste support, backspace navigation. Calls `onChange(value)`
 * with the joined string and `onComplete(value)` once all cells are filled.
 */

import { forwardRef, useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export const OtpInput = forwardRef<HTMLDivElement, OtpInputProps>(function OtpInput(
  { length = 6, value, onChange, onComplete, disabled, autoFocus, className },
  ref,
) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) {
      inputs.current[0]?.focus();
    }
  }, [autoFocus]);

  const setAt = (idx: number, ch: string): string => {
    const arr = value.padEnd(length, ' ').split('');
    arr[idx] = ch;
    const next = arr.join('').replace(/\s+$/g, '');
    return next;
  };

  const handleChange = (idx: number, raw: string) => {
    const ch = raw.replace(/\D/g, '').slice(-1);
    if (!ch) {
      return;
    }
    const next = setAt(idx, ch);
    onChange(next);
    if (idx < length - 1) {
      inputs.current[idx + 1]?.focus();
    }
    if (next.length === length) {
      onComplete?.(next);
    }
  };

  const handleKeyDown = (idx: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[idx]) {
        onChange(setAt(idx, ' ').trimEnd());
        return;
      }
      if (idx > 0) {
        onChange(setAt(idx - 1, ' ').trimEnd());
        inputs.current[idx - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      inputs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!text) {
      return;
    }
    e.preventDefault();
    onChange(text);
    const last = Math.min(text.length, length) - 1;
    inputs.current[last]?.focus();
    if (text.length === length) {
      onComplete?.(text);
    }
  };

  return (
    <div ref={ref} className={cn('flex items-center gap-2 justify-center', className)}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className="h-12 w-10 rounded-md border border-input bg-transparent text-center text-lg font-mono shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      ))}
    </div>
  );
});
