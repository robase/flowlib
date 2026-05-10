import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../ui/command';
import { useLoadFieldOptions } from '../../../api/node-data.api';
import { useFrontendPath } from '../../../contexts/FrontendPathContext';
import type { NodeParamField } from '../../../types/node-definition.types';

interface DynamicSelectFieldProps {
  /** The action / node type id (e.g. "core.model"). */
  actionId: string;
  /** The field definition — must have `loadOptions`. */
  field: NodeParamField;
  /** Current field value. */
  value: unknown;
  /** Called when the user picks a new value. */
  onChange: (value: unknown) => void;
  /** Current form values — used to extract dependency values. */
  formValues: Record<string, unknown>;
  /** Portal container for the dropdown. */
  portalContainer?: HTMLElement | null;
}

/**
 * A select field whose options are loaded from the server via the
 * `loadOptions` system.  Re-fetches whenever any of the declared
 * dependency fields change.
 */
export function DynamicSelectField({
  actionId,
  field,
  value,
  onChange,
  formValues,
  portalContainer: _portalContainer,
}: DynamicSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dependsOn = field.loadOptions?.dependsOn ?? [];
  const basePath = useFrontendPath();

  // Build dependency values from formValues
  const dependencyValues = useMemo(() => {
    const deps: Record<string, unknown> = {};
    for (const dep of dependsOn) {
      deps[dep] = formValues[dep];
    }
    return deps;
  }, [dependsOn, ...dependsOn.map((d) => formValues[d])]);

  // Only fetch when all dependency values are non-empty
  const hasDeps = dependsOn.every(
    (d) =>
      dependencyValues[d] !== undefined &&
      dependencyValues[d] !== null &&
      dependencyValues[d] !== '',
  );

  const { data, isLoading, isError, error } = useLoadFieldOptions(
    actionId,
    field.name,
    dependencyValues,
    { enabled: hasDeps },
  );

  // Auto-select the default value when options arrive (only on first load
  // or when the current value is not in the new option set).
  const prevDepsKey = useRef<string>('');
  useEffect(() => {
    if (!data) {
      return;
    }
    const depsKey = JSON.stringify(dependencyValues);
    if (depsKey === prevDepsKey.current) {
      return;
    }
    prevDepsKey.current = depsKey;

    const currentStr = value === undefined || value === null ? '' : String(value);
    const inList = data.options.some((o) => String(o.value) === currentStr);

    if (!inList && data.defaultValue !== undefined) {
      onChange(data.defaultValue);
    } else if (!inList && data.options.length > 0 && currentStr) {
      // Current value is stale — clear it so the user picks a new one
      onChange('');
    }
  }, [data, dependencyValues, value, onChange]);

  // Merge static options from field definition with dynamic options
  const options = data?.options ?? field.options ?? [];
  const placeholder = data?.placeholder ?? field.placeholder ?? 'Select…';
  const disabled = field.disabled || data?.disabled || false;

  const stringValue = value === undefined || value === null ? '' : String(value);

  // If the current value is not in the options list, prepend it so the
  // user can still see what was previously selected.
  const optionEntries = options.map((o) => ({ label: o.label, value: String(o.value) }));
  const hasCurrentValue = stringValue ? optionEntries.some((o) => o.value === stringValue) : false;
  const renderOptions =
    hasCurrentValue || !stringValue
      ? optionEntries
      : [{ label: stringValue, value: stringValue }, ...optionEntries];

  // Client-side search filter
  const filteredOptions = useMemo(() => {
    if (!search) {
      return renderOptions;
    }
    const lower = search.toLowerCase();
    return renderOptions.filter(
      (o) => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower),
    );
  }, [renderOptions, search]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const displayLabel = useMemo(() => {
    if (!stringValue) {
      return null;
    }
    const match = renderOptions.find((o) => o.value === stringValue);
    return match?.label ?? stringValue;
  }, [stringValue, renderOptions]);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            id={field.name}
            disabled={disabled || isLoading}
            className={cn(
              'w-full justify-between font-mono text-xs h-9',
              isLoading && 'opacity-60',
              !stringValue && 'text-muted-foreground',
            )}
          >
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </span>
            ) : (
              <span className="truncate">{displayLabel ?? placeholder}</span>
            )}
            <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search…"
              className="h-8 text-xs"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-52">
              {!isLoading && filteredOptions.length === 0 && (
                <CommandEmpty className="text-xs">
                  {!hasDeps
                    ? 'Fill in required fields first'
                    : search
                      ? 'No matching options'
                      : 'No options available'}
                </CommandEmpty>
              )}
              {filteredOptions.length > 0 && (
                <CommandGroup>
                  {filteredOptions
                    .filter((o) => o.value !== '')
                    .map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        onSelect={() => handleSelect(option.value)}
                        className="text-xs font-mono"
                      >
                        <span className="truncate">{option.label}</span>
                        {stringValue === option.value && (
                          <Check className="ml-auto h-3 w-3 shrink-0" />
                        )}
                      </CommandItem>
                    ))}
                </CommandGroup>
              )}
            </CommandList>
            {field.addNew && (
              <div className="p-2 border-t">
                <a
                  href={`${basePath}${field.addNew.href}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {field.addNew.label}
                </a>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {isError && (
        <p className="mt-1 text-xs text-destructive">
          {error instanceof Error ? error.message : 'Failed to load options'}
        </p>
      )}
    </div>
  );
}
