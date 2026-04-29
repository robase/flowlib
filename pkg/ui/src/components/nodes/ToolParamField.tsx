'use client';

import { memo, useMemo } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Bot, Info, Key } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { NodeParamField } from '../../types/node-definition.types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { CredentialCombobox } from '../flow-editor/node-config-panel/CredentialCombobox';
import { useCredentials } from '../../api/credentials.api';
import { filterCredentialsForField } from '../../utils/credentialFiltering';
import { FieldHelperAdornment } from '../field-helpers';

export interface AddCredentialRequest {
  fieldName: string;
  /** If specified, the credential requires OAuth2 with this specific provider */
  oauth2Providers?: string[];
}

interface ToolParamFieldProps {
  field: NodeParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** If true, the AI will choose this value at runtime (param included in tool's input schema) */
  aiChosen: boolean;
  onAiChosenChange: (enabled: boolean) => void;
  /** Callback to open the create credential modal (passes the field name and OAuth2 provider info) */
  onAddCredential?: (request: AddCredentialRequest) => void;
  /** Action / node type id — needed for `helper` adornments backed by server loaders. */
  actionId?: string;
  /** Sibling field values — needed to resolve `dependsOn` for async-picker helpers. */
  formValues?: Record<string, unknown>;
}

/**
 * A config field for tool parameters with "AI Chosen" vs "Static" toggle.
 *
 * - AI Chosen (default): The parameter IS included in the tool's input schema, and the AI
 *   decides what value to provide when calling the tool.
 * - Static: User provides a fixed value, which is passed directly during tool execution.
 *   The parameter is NOT included in the tool's input schema shown to the model.
 *
 * Note: Credential fields are ALWAYS static (never AI chosen) for security reasons.
 */
export const ToolParamField = memo(function ToolParamField({
  field,
  value,
  onChange,
  aiChosen,
  onAiChosenChange,
  onAddCredential,
  actionId,
  formValues,
}: ToolParamFieldProps) {
  // Credential hooks (only used for credential fields)
  const {
    data: credentials = [],
    isLoading: credentialsLoading,
    isError: credentialsError,
    refetch: refetchCredentials,
  } = useCredentials();

  // Filter credentials based on the field's oauth2Providers / credentialTypes hints
  const filteredCredentials = useMemo(
    () =>
      field.type === 'credential' ? filterCredentialsForField(credentials, field) : credentials,
    [credentials, field],
  );

  if (field.hidden) {
    return null;
  }

  // Credential fields are always static (never AI chosen) for security
  const isCredentialField = field.type === 'credential';
  const requiresOAuth2 =
    isCredentialField && field.oauth2Providers && field.oauth2Providers.length > 0;

  // For credential fields, render without the AI toggle
  if (isCredentialField) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Label htmlFor={field.name} className="text-xs">
              {field.label}
            </Label>
            {field.description && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-muted-foreground cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-64 text-xs [&_p]:mb-1 [&_p:last-child]:mb-0 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-3 [&_ol]:list-decimal [&_ol]:pl-3"
                  >
                    <ReactMarkdown>{field.description}</ReactMarkdown>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Key className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              {requiresOAuth2 ? 'OAuth2 Required' : 'Required'}
            </span>
          </div>
        </div>
        <CredentialCombobox
          credentials={filteredCredentials}
          value={(value as string) ?? ''}
          onChange={onChange}
          placeholder={requiresOAuth2 ? 'Select or authenticate...' : 'Select credential...'}
          isLoading={credentialsLoading}
          isError={credentialsError}
          onRetry={() => refetchCredentials()}
          onAddNew={() =>
            onAddCredential?.({ fieldName: field.name, oauth2Providers: field.oauth2Providers })
          }
          addButtonLabel={requiresOAuth2 ? 'Authenticate' : 'Add new credential'}
        />
      </div>
    );
  }

  const fieldHeader = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1">
        <Label htmlFor={field.name} className="text-xs">
          {field.label}
        </Label>
        {field.description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-64 text-xs [&_p]:mb-1 [&_p:last-child]:mb-0 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-3 [&_ol]:list-decimal [&_ol]:pl-3"
              >
                <ReactMarkdown>{field.description}</ReactMarkdown>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Agent provided</span>
        <Switch
          checked={aiChosen}
          onChange={(e) => onAiChosenChange(e.target.checked)}
          title={aiChosen ? 'Agent will provide this value' : 'You provide a value'}
          className="scale-75"
        />
      </div>
    </div>
  );

  // When AI chooses, show a placeholder message instead of the input
  if (aiChosen) {
    return (
      <div className="flex flex-col gap-1.5">
        {fieldHeader}
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-muted text-muted-foreground opacity-60">
          <Bot className="w-3 h-3" />
          <span>Agent will provide this value</span>
        </div>
      </div>
    );
  }

  // Static mode: render the appropriate form element
  const renderStaticField = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            id={field.name}
            value={(value as string) ?? field.defaultValue ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            className="text-xs h-7"
          />
        );

      case 'textarea':
        return (
          <Textarea
            id={field.name}
            value={(value as string) ?? field.defaultValue ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            rows={3}
            className="text-xs resize-none"
          />
        );

      case 'number':
        return (
          <Input
            id={field.name}
            type="number"
            value={(value as number) ?? field.defaultValue ?? ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            className="text-xs h-7"
          />
        );

      case 'select':
        return (
          <Select
            value={String(value ?? field.defaultValue ?? '')}
            onValueChange={onChange}
            disabled={field.disabled}
          >
            <SelectTrigger id={field.name} className="text-xs h-7">
              <SelectValue placeholder={field.placeholder || 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              id={field.name}
              checked={Boolean(value ?? field.defaultValue)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={field.disabled}
            />
            <span className="text-xs text-muted-foreground">{value ? 'Yes' : 'No'}</span>
          </div>
        );

      case 'json':
      case 'code':
        return (
          <Textarea
            id={field.name}
            value={(value as string) ?? field.defaultValue ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || (field.type === 'json' ? '{}' : '')}
            disabled={field.disabled}
            rows={field.type === 'code' ? 6 : 4}
            className="font-mono text-xs resize-none"
          />
        );

      default:
        return (
          <Input
            id={field.name}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            disabled={field.disabled}
            className="text-xs h-7"
          />
        );
    }
  };

  const isTemplateValue = typeof value === 'string' && value.includes('{{') && value.includes('}}');
  const adornment = field.helper ? (
    <FieldHelperAdornment
      field={field}
      value={value}
      onChange={onChange}
      context={{
        actionId,
        formValues,
        templateMode: isTemplateValue,
      }}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      {fieldHeader}
      {adornment ? (
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0">{renderStaticField()}</div>
          {adornment}
        </div>
      ) : (
        renderStaticField()
      )}
    </div>
  );
});

ToolParamField.displayName = 'ToolParamField';
