import { useState, useMemo, useCallback, useEffect } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { useActionLoader } from '../../api/node-data.api';
import type { HelperAdornmentProps } from './types';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Adornment-mode async combobox. Reads `loader` + `dependsOn` from the
 * helper spec, fetches options from `GET /actions/:id/loaders/:name`, and
 * writes the selected option's `value` into the underlying field.
 *
 * Multi-select serializes to a JSON array string so the field stays a
 * normal text input that templates and round-trips cleanly.
 */
export function AsyncPickerHelper({
  field,
  helper,
  value,
  onChange,
  context,
}: HelperAdornmentProps) {
  if (helper.kind !== 'async-picker') {
    return null;
  }
  const { actionId, formValues, portalContainer } = context;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (!helper.searchable) {
      setDebouncedSearch('');
      return;
    }
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, helper.searchable]);

  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const dependsOn = helper.dependsOn ?? [];
  const dependencyValues = useMemo(() => {
    const deps: Record<string, unknown> = {};
    for (const d of dependsOn) {
      deps[d] = formValues?.[d];
    }
    return deps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependsOn.join(','), ...dependsOn.map((d) => formValues?.[d])]);

  const hasDeps = dependsOn.every(
    (d) =>
      dependencyValues[d] !== undefined &&
      dependencyValues[d] !== null &&
      dependencyValues[d] !== '',
  );

  const { data, isLoading, isError, error } = useActionLoader(
    actionId ?? '',
    helper.loader,
    dependencyValues,
    debouncedSearch,
    { enabled: open && Boolean(actionId) && hasDeps },
  );

  const options = data?.options ?? [];

  const selectedValues = useMemo<string[]>(() => {
    if (!helper.multi) {
      const s = value === undefined || value === null ? '' : String(value);
      return s ? [s] : [];
    }
    if (Array.isArray(value)) {
      return value.map((v) => String(v));
    }
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v));
        }
      } catch {
        // fall through
      }
    }
    return [];
  }, [value, helper.multi]);

  const handleSelect = useCallback(
    (val: string) => {
      if (!helper.multi) {
        onChange(val);
        setOpen(false);
        return;
      }
      const next = selectedValues.includes(val)
        ? selectedValues.filter((v) => v !== val)
        : [...selectedValues, val];
      onChange(JSON.stringify(next));
    },
    [helper.multi, onChange, selectedValues],
  );

  const tooltip = !actionId
    ? 'Pick a value (action context unavailable)'
    : !hasDeps
      ? `Pick a value (fill in ${dependsOn.join(', ')} first)`
      : 'Pick a value';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          title={tooltip}
          disabled={!actionId}
          aria-label={`Pick ${field.label}`}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" container={portalContainer ?? undefined}>
        <Command shouldFilter={false}>
          {(helper.searchable ?? true) && (
            <CommandInput
              placeholder="Search…"
              className="h-8 text-xs"
              value={search}
              onValueChange={setSearch}
            />
          )}
          <CommandList className="max-h-60">
            {isLoading && (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                Loading…
              </div>
            )}
            {!isLoading && options.length === 0 && (
              <CommandEmpty className="text-xs py-3">
                {!hasDeps
                  ? `Fill in ${dependsOn.join(', ')} first`
                  : isError
                    ? error instanceof Error
                      ? error.message
                      : 'Failed to load options'
                    : 'No options'}
              </CommandEmpty>
            )}
            {!isLoading && options.length > 0 && (
              <CommandGroup>
                {options.map((opt) => {
                  const v = String(opt.value);
                  const selected = selectedValues.includes(v);
                  return (
                    <CommandItem
                      key={v}
                      value={v}
                      onSelect={() => handleSelect(v)}
                      className="text-xs font-mono"
                    >
                      <span className="truncate">{opt.label}</span>
                      {selected && <Check className="ml-auto h-3 w-3 shrink-0" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
