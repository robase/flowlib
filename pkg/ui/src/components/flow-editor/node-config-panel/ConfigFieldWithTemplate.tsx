import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { Code2, Type } from 'lucide-react';
import type { NodeParamField } from '../../../types/node-definition.types';
import { cn } from '../../../lib/utils';
import { DroppableInput } from './DroppableInput';
import { DynamicSelectField } from './DynamicSelectField';
import { SearchableSelectField } from './SearchableSelectField';
import { CodeMirrorJsEditor } from '../../ui/codemirror-js-editor';
import { SwitchCasesField } from './SwitchCasesField';
import { useFlowEditorStore } from '../flow-editor.store';
import { FieldHelperAdornment } from '../../field-helpers';

interface ConfigFieldWithTemplateProps {
  field: NodeParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  templateMode: boolean;
  onTemplateModeChange: (enabled: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Action / node type id — needed for dynamic option loading. */
  nodeType?: string;
  /** All current form values — needed for dynamic option loading. */
  formValues?: Record<string, unknown>;
  /** Input data from upstream nodes — used for autocomplete in code fields. */
  inputData?: Record<string, unknown>;
  /** Validation error message for this field (from execution errors). */
  error?: string;
}

/**
 * Field types that are always in template mode (text-based inputs).
 * These fields don't show a toggle - they always accept Nunjucks templates.
 */
const ALWAYS_TEMPLATE_TYPES = ['text', 'textarea', 'json', 'code'];

/**
 * Check if a field type should always be in template mode.
 */
function isAlwaysTemplateType(fieldType: string): boolean {
  return ALWAYS_TEMPLATE_TYPES.includes(fieldType);
}

/**
 * A config field that supports toggling between static mode (normal form element)
 * and template mode (Nunjucks template textarea).
 *
 * Text-based fields (text, textarea, json, code) are always in template mode.
 * Other fields (select, number, boolean) show a toggle to switch between modes.
 */
export const ConfigFieldWithTemplate = ({
  field,
  value,
  onChange,
  templateMode,
  onTemplateModeChange,
  portalContainer,
  nodeType,
  formValues,
  inputData,
  error,
}: ConfigFieldWithTemplateProps) => {
  if (field.hidden) {
    return null;
  }

  const isTemplateValue = typeof value === 'string' && value.includes('{{') && value.includes('}}');
  const adornment = field.helper ? (
    <FieldHelperAdornment
      field={field}
      value={value}
      onChange={onChange}
      context={{
        actionId: nodeType,
        formValues,
        portalContainer,
        templateMode: isTemplateValue,
      }}
    />
  ) : null;

  const fieldError = error ? (
    <div className="flex items-center gap-1 text-[11px] text-destructive mt-0.5">
      <span>{error}</span>
    </div>
  ) : null;

  // Switch cases: custom field with its own rendering
  if (field.type === 'switch-cases') {
    const selectedNodeId = useFlowEditorStore.getState().selectedNodeId;
    return (
      <SwitchCasesField
        value={value}
        onChange={onChange as (value: unknown) => void}
        nodeId={selectedNodeId}
        inputData={inputData}
      />
    );
  }

  // Check if this field type is always in template mode
  const alwaysTemplate = isAlwaysTemplateType(field.type);
  const effectiveTemplateMode = alwaysTemplate || templateMode;

  const templateModeToggle = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-5 px-1.5 text-[10px] gap-0.5',
        effectiveTemplateMode ? 'text-primary' : 'text-muted-foreground',
      )}
      onClick={() => onTemplateModeChange(!templateMode)}
      title={effectiveTemplateMode ? 'Switch to static value' : 'Switch to template'}
    >
      {effectiveTemplateMode ? (
        <>
          <Code2 className="w-2.5 h-2.5" />
          <span>Template</span>
        </>
      ) : (
        <>
          <Type className="w-2.5 h-2.5" />
          <span>Static</span>
        </>
      )}
    </Button>
  );

  // Header with or without toggle based on field type
  const fieldHeader = (
    <div className="flex items-center justify-between">
      <Label htmlFor={field.name} className={cn('text-xs', error && 'text-destructive')}>
        {field.label}
      </Label>
      {/* Only show toggle for non-text fields */}
      {!alwaysTemplate && templateModeToggle}
    </div>
  );

  // Code fields: render a JavaScript editor with syntax highlighting and autocomplete
  if (field.type === 'code') {
    const codeValue =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
    return (
      <div className="flex flex-col gap-1.5">
        {fieldHeader}
        <CodeMirrorJsEditor
          value={codeValue}
          onChange={(newValue) => onChange(newValue)}
          placeholder={field.placeholder}
          inputData={inputData}
        />
        {fieldError}
      </div>
    );
  }

  // Template mode: render a DroppableInput for Nunjucks templates
  if (effectiveTemplateMode) {
    // Determine if this should be multiline based on original field type
    const isMultiline = field.type === 'textarea' || field.type === 'json';
    const rows = field.type === 'json' ? 6 : field.type === 'textarea' ? 3 : 1;

    return (
      <div className={cn('flex flex-col gap-1.5', isMultiline && 'flex-1 min-h-0')}>
        {fieldHeader}
        <div className={cn('flex items-start gap-1', isMultiline && 'min-h-0 flex-1')}>
          <DroppableInput
            id={field.name}
            className={cn('text-xs font-mono flex-1', isMultiline && 'min-h-0')}
            multiline={isMultiline}
            rows={rows}
            fillAvailableHeight={isMultiline}
            value={
              typeof value === 'string'
                ? value
                : value === null || value === undefined
                  ? ''
                  : JSON.stringify(value, null, 2)
            }
            placeholder={field.placeholder || '{{ nodeId.data.variables.output.value }}'}
            onChange={(newValue) => onChange(newValue)}
            disabled={field.disabled}
            inputData={inputData}
          />
          {adornment}
        </div>
        {fieldError}
      </div>
    );
  }

  // Static mode: render the appropriate form element based on field type
  // (Only reached for non-text fields when not in template mode)
  switch (field.type) {
    case 'select': {
      // Dynamic options: delegate to DynamicSelectField when loadOptions is present
      if (field.loadOptions && nodeType && formValues) {
        return (
          <div className="flex flex-col gap-1.5">
            {fieldHeader}
            <DynamicSelectField
              actionId={nodeType}
              field={field}
              value={value}
              onChange={onChange}
              formValues={formValues}
              portalContainer={portalContainer}
            />
            {fieldError}
          </div>
        );
      }

      const stringValue = value === undefined || value === null ? '' : String(value);
      const optionEntries = (field.options ?? []).map((option) => ({
        label: option.label,
        value: String(option.value),
        description: option.description,
      }));
      const hasCurrentValue = stringValue
        ? optionEntries.some((option) => option.value === stringValue)
        : false;
      const renderOptions =
        hasCurrentValue || !stringValue
          ? optionEntries
          : [{ label: stringValue, value: stringValue, description: undefined }, ...optionEntries];

      const hasDescriptions = renderOptions.some((o) => o.description);

      // Use searchable combobox for selects with many options (e.g. model lists)
      const SEARCHABLE_THRESHOLD = 10;
      if (renderOptions.length > SEARCHABLE_THRESHOLD) {
        return (
          <div className="flex flex-col gap-1.5">
            {fieldHeader}
            <SearchableSelectField
              id={field.name}
              value={stringValue}
              options={renderOptions}
              placeholder={field.placeholder}
              disabled={field.disabled}
              onChange={(val) => onChange(val)}
            />
            {fieldError}
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-1.5">
          {fieldHeader}
          <Select
            value={stringValue}
            onValueChange={(val) => onChange(val)}
            disabled={field.disabled}
          >
            <SelectTrigger id={field.name} className="font-mono text-xs">
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent className="z-[80] text-xs" container={portalContainer}>
              {renderOptions
                .filter((option) => option.value !== '')
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {hasDescriptions ? (
                      <div className="flex flex-col gap-0.5 py-0.5">
                        <span className="font-medium">{option.label}</span>
                        {option.description && (
                          <span className="text-[11px] text-muted-foreground font-normal leading-tight">
                            {option.description}
                          </span>
                        )}
                      </div>
                    ) : (
                      option.value
                    )}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {fieldError}
        </div>
      );
    }
    case 'number':
      return (
        <div className="flex flex-col gap-1.5">
          {fieldHeader}
          <div className="flex items-center gap-1">
            <Input
              id={field.name}
              type="number"
              className="h-8 font-mono text-xs flex-1"
              value={value === undefined || value === null ? '' : String(value)}
              placeholder={field.placeholder}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange(nextValue === '' ? null : Number(nextValue));
              }}
              disabled={field.disabled}
            />
            {adornment}
          </div>
          {fieldError}
        </div>
      );
    case 'boolean':
      return (
        <div className="flex flex-col gap-1.5">
          {fieldHeader}
          <div className="flex items-center gap-2 p-2 border rounded-md">
            <Switch
              id={field.name}
              checked={Boolean(value)}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(event.target.checked)
              }
              disabled={field.disabled}
            />
            <span className="text-xs">{value ? 'Enabled' : 'Disabled'}</span>
          </div>
          {fieldError}
        </div>
      );
    case 'credential':
    // Credential fields show a dropdown (handled separately in CredentialsSection)
    // Fall through to default text input for now
    default:
      // Fallback for any other field types
      return (
        <div className="flex flex-col gap-1.5">
          {fieldHeader}
          <div className="flex items-start gap-1">
            <DroppableInput
              id={field.name}
              value={(value as string) ?? ''}
              placeholder={field.placeholder}
              onChange={(newValue) => onChange(newValue)}
              disabled={field.disabled}
              className="font-mono text-xs flex-1"
              inputData={inputData}
            />
            {adornment}
          </div>
          {fieldError}
        </div>
      );
  }
};
