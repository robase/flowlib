import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { CheckCircle2, XCircle, Loader2, Plus, Trash2, KeyRound, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  Credential,
  CreateCredentialInput,
  CredentialAuthType,
  CredentialType,
} from '../../api/types';
import { useTestCredentialRequest } from '../../api/credentials.api';
import { OAuth2ProviderSelectorPanel } from './OAuth2ProviderSelectorPanel';

interface CreateCredentialModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateCredentialInput) => void;
  isLoading?: boolean;
  portalContainer?: HTMLElement | null;
  /** Pre-select a credential type when the modal opens (e.g. 'llm') */
  initialType?: CredentialType;
  /**
   * Called when an OAuth2 credential is created via the inline OAuth panel.
   * If omitted, the modal just closes — callers using `useCreateCredential`'s
   * mutation flow won't see the OAuth-created row in their local state but
   * the credentials list will refetch via React Query invalidation.
   */
  onOAuthCredentialCreated?: (credential: Credential) => void;
}

/** Top-level setup mode chosen at the top of the modal. */
type SetupMode = 'oauth' | 'manual';

const ALL_AUTH_TYPES: { value: CredentialAuthType; label: string }[] = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'custom', label: 'Custom Headers' },
  { value: 'connectionString', label: 'Connection String' },
];

function getAuthTypesForType(type: CredentialType) {
  if (type === 'database') {
    return ALL_AUTH_TYPES.filter((t) => ['basic', 'connectionString', 'oauth2'].includes(t.value));
  }
  if (type === 'llm') {
    return ALL_AUTH_TYPES.filter((t) => ['apiKey', 'bearer'].includes(t.value));
  }
  return ALL_AUTH_TYPES.filter((t) => !['connectionString'].includes(t.value));
}

/** Setup mode is only meaningful for non-LLM credentials — LLM is always API-key. */
function defaultSetupMode(type: CredentialType): SetupMode {
  return type === 'llm' ? 'manual' : 'oauth';
}

export const CreateCredentialModal: React.FC<CreateCredentialModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading,
  portalContainer,
  initialType,
  onOAuthCredentialCreated,
}) => {
  const testCredentialMutation = useTestCredentialRequest();
  const [setupMode, setSetupMode] = useState<SetupMode>(() =>
    defaultSetupMode(initialType ?? 'http-api'),
  );

  const getInitialFormData = (): CreateCredentialInput => {
    const type: CredentialType = initialType ?? 'http-api';
    return {
      name: '',
      type,
      authType: (type === 'llm' ? 'apiKey' : 'bearer') as CredentialAuthType,
      config: {},
      description: '',
    };
  };

  const [formData, setFormData] = useState<CreateCredentialInput>(getInitialFormData);
  const [testUrl, setTestUrl] = useState('');
  const [testMethod, setTestMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET');
  const [testBody, setTestBody] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // Reset form to initial state when modal opens
      setFormData(getInitialFormData());
      setSetupMode(defaultSetupMode(initialType ?? 'http-api'));
      const timeout = window.setTimeout(() => {
        firstFieldRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    setTestUrl('');
    setTestMethod('GET');
    setTestBody('');
    setTestStatus('idle');
    setTestMessage('');
    return undefined;
  }, [open, initialType]);

  const handleOAuthCredentialCreated = (credential: Credential) => {
    onOAuthCredentialCreated?.(credential);
    onClose();
  };

  const runCredentialTest = async () => {
    if (!testUrl) {
      return;
    }

    setTestStatus('testing');
    setTestMessage('');

    try {
      const headers: Record<string, string> = {};

      if (formData.authType === 'bearer' && formData.config.token) {
        headers['Authorization'] = `Bearer ${formData.config.token}`;
      } else if (formData.authType === 'apiKey' && formData.config.apiKey) {
        const location = formData.config.location || 'header';
        if (location === 'header') {
          const paramName = (formData.config.paramName as string) || 'X-API-Key';
          headers[paramName] = formData.config.apiKey as string;
        }
      } else if (
        formData.authType === 'basic' &&
        formData.config.username &&
        formData.config.password
      ) {
        const encoded = btoa(`${formData.config.username}:${formData.config.password}`);
        headers['Authorization'] = `Basic ${encoded}`;
      } else if (formData.authType === 'custom' && formData.config.headers) {
        const customHeaders = formData.config.headers as Record<string, string>;
        for (const [key, value] of Object.entries(customHeaders)) {
          if (key.trim()) {
            headers[key] = value;
          }
        }
      }

      if (testBody && ['POST', 'PUT', 'PATCH'].includes(testMethod)) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await testCredentialMutation.mutateAsync({
        url: testUrl,
        method: testMethod,
        headers,
        body: testBody && ['POST', 'PUT', 'PATCH'].includes(testMethod) ? testBody : undefined,
      });

      if (response.ok) {
        setTestStatus('success');
        setTestMessage(`Connection successful (${response.status} ${response.statusText})`);
      } else {
        setTestStatus('error');
        setTestMessage(`Request failed with status ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalFormData = testUrl
      ? { ...formData, config: { ...formData.config, apiUrl: testUrl } }
      : formData;
    onSubmit(finalFormData);
  };

  const updateConfig = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        container={portalContainer}
        // `grid-cols-[minmax(0,1fr)]` locks the implicit column so it can't
        // expand to a child's max-content. Without this, the wide Microsoft
        // description on a provider card would push the column past the
        // dialog's `max-w-lg`, making cards appear to overflow the modal
        // while the header/chooser (shorter content) sit at the inner padding.
        className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-lg grid-cols-[minmax(0,1fr)]"
      >
        <DialogHeader>
          <DialogTitle className="text-base">Create Credential</DialogTitle>
          <DialogDescription className="text-xs">
            {setupMode === 'oauth' && formData.type !== 'llm'
              ? 'Connect a service via OAuth — no client secrets stored, tokens auto-refresh.'
              : 'Store API or database credentials securely. These secrets are encrypted at rest.'}
          </DialogDescription>
        </DialogHeader>

        {/* Setup mode toggle — hidden for LLM credentials (always API key) */}
        {formData.type !== 'llm' && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/40">
            <SetupModeButton
              active={setupMode === 'oauth'}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              label="Connect via OAuth"
              hint="Recommended"
              onClick={() => setSetupMode('oauth')}
            />
            <SetupModeButton
              active={setupMode === 'manual'}
              icon={<KeyRound className="w-3.5 h-3.5" />}
              label="Manual setup"
              hint="LLMs, Databases, etc."
              onClick={() => setSetupMode('manual')}
            />
          </div>
        )}

        {setupMode === 'oauth' && formData.type !== 'llm' ? (
          <OAuth2ProviderSelectorPanel
            key={open ? 'open' : 'closed'}
            onCredentialCreated={handleOAuthCredentialCreated}
          />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 text-xs"
            autoComplete="one-time-code"
            data-lpignore="true"
          >
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">
                Name*
              </Label>
              <Input
                id="name"
                ref={firstFieldRef}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Acme API"
                required
                autoComplete="one-time-code"
                data-1p-ignore
                data-lpignore="true"
                className="h-8 text-xs"
              />
            </div>

            {/* Description — hidden for now; data still flows from formData.description if seeded externally */}

            {/* Credential Type */}
            <div className="space-y-1.5">
              <Label htmlFor="type" className="text-xs">
                Credential Type*
              </Label>
              <Select
                value={formData.type}
                onValueChange={(value) => {
                  const newType = value as CredentialType;
                  if (newType === 'llm') {
                    setFormData({ ...formData, type: newType, authType: 'apiKey' });
                  } else {
                    const available = getAuthTypesForType(newType);
                    const nextAuthType = available.some((t) => t.value === formData.authType)
                      ? formData.authType
                      : available[0]?.value || 'basic';
                    setFormData({ ...formData, type: newType, authType: nextAuthType });
                  }
                }}
              >
                <SelectTrigger id="type" size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http-api">HTTP API</SelectItem>
                  <SelectItem value="llm">LLM Provider</SelectItem>
                  <SelectItem value="database">Database</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Auth Type (hidden for LLM — always apiKey) */}
            {formData.type !== 'llm' && (
              <div className="space-y-1.5">
                <Label htmlFor="authType" className="text-xs">
                  Authentication Type*
                </Label>
                <Select
                  value={formData.authType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, authType: value as CredentialAuthType })
                  }
                >
                  <SelectTrigger id="authType" size="sm" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getAuthTypesForType(formData.type).map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* LLM Provider selector (only shown for LLM type) */}
            {formData.type === 'llm' && (
              <div className="space-y-1.5">
                <Label htmlFor="llmProvider" className="text-xs">
                  LLM Provider*
                </Label>
                <Select
                  value={(formData.metadata?.provider as string) || ''}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      metadata: { ...formData.metadata, provider: value },
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue placeholder="Select a provider…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Config fields based on auth type */}
            <div className="p-3 space-y-3 border rounded-lg">
              {/* LLM: plain API key only */}
              {formData.type === 'llm' && (
                <div className="space-y-1.5">
                  <Label htmlFor="apiKey" className="text-xs">
                    API Key*
                  </Label>
                  <Input
                    id="apiKey"
                    type="text"
                    style={{ WebkitTextSecurity: 'disc' }}
                    value={(formData.config.apiKey as string) || ''}
                    onChange={(e) => updateConfig('apiKey', e.target.value)}
                    placeholder="Enter your API key"
                    required
                    autoComplete="one-time-code"
                    data-1p-ignore
                    data-lpignore="true"
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {formData.type !== 'llm' && formData.authType === 'bearer' && (
                <div className="space-y-1.5">
                  <Label htmlFor="token" className="text-xs">
                    Token*
                  </Label>
                  <Input
                    id="token"
                    type="text"
                    style={{ WebkitTextSecurity: 'disc' }}
                    value={(formData.config.token as string) || ''}
                    onChange={(e) => updateConfig('token', e.target.value)}
                    placeholder="Enter bearer token"
                    required
                    autoComplete="one-time-code"
                    data-1p-ignore
                    data-lpignore="true"
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {formData.type !== 'llm' && formData.authType === 'apiKey' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="apiKey" className="text-xs">
                      API Key*
                    </Label>
                    <Input
                      id="apiKey"
                      type="text"
                      style={{ WebkitTextSecurity: 'disc' }}
                      value={(formData.config.apiKey as string) || ''}
                      onChange={(e) => updateConfig('apiKey', e.target.value)}
                      placeholder="Enter API key"
                      required
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="location" className="text-xs">
                      Location
                    </Label>
                    <select
                      id="location"
                      value={(formData.config.location as string) || 'header'}
                      onChange={(e) => updateConfig('location', e.target.value)}
                      className="flex w-full h-8 px-3 py-1 text-xs rounded-md border border-input bg-background dark:bg-input/30 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    >
                      <option value="header">Header</option>
                      <option value="query">Query Parameter</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="paramName" className="text-xs">
                      Parameter Name
                    </Label>
                    <Input
                      id="paramName"
                      value={(formData.config.paramName as string) || ''}
                      onChange={(e) => updateConfig('paramName', e.target.value)}
                      placeholder="X-API-Key"
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                </>
              )}

              {formData.authType === 'connectionString' && (
                <div className="space-y-1.5">
                  <Label htmlFor="connectionString" className="text-xs">
                    Connection String*
                  </Label>
                  <Input
                    id="connectionString"
                    type="text"
                    style={{ WebkitTextSecurity: 'disc' }}
                    value={(formData.config.connectionString as string) || ''}
                    onChange={(e) => updateConfig('connectionString', e.target.value)}
                    placeholder="postgres://user:pass@host:5432/dbname?sslmode=require"
                    required
                    autoComplete="one-time-code"
                    data-1p-ignore
                    data-lpignore="true"
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {formData.authType === 'basic' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-xs">
                      Username*
                    </Label>
                    <Input
                      id="username"
                      value={(formData.config.username as string) || ''}
                      onChange={(e) => updateConfig('username', e.target.value)}
                      placeholder="Enter username"
                      required
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs">
                      Password*
                    </Label>
                    <Input
                      id="password"
                      type="text"
                      style={{ WebkitTextSecurity: 'disc' }}
                      value={(formData.config.password as string) || ''}
                      onChange={(e) => updateConfig('password', e.target.value)}
                      placeholder="Enter password"
                      required
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                </>
              )}

              {formData.authType === 'oauth2' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="clientId" className="text-xs">
                      Client ID*
                    </Label>
                    <Input
                      id="clientId"
                      value={(formData.config.clientId as string) || ''}
                      onChange={(e) => updateConfig('clientId', e.target.value)}
                      placeholder="Enter client ID"
                      required
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clientSecret" className="text-xs">
                      Client Secret*
                    </Label>
                    <Input
                      id="clientSecret"
                      type="text"
                      style={{ WebkitTextSecurity: 'disc' }}
                      value={(formData.config.clientSecret as string) || ''}
                      onChange={(e) => updateConfig('clientSecret', e.target.value)}
                      placeholder="Enter client secret"
                      required
                      autoComplete="one-time-code"
                      data-1p-ignore
                      data-lpignore="true"
                      className="h-8 text-xs"
                    />
                  </div>
                </>
              )}

              {formData.authType === 'custom' &&
                (() => {
                  const headers = (formData.config.headers as Record<string, string>) || {};
                  const entries = Object.entries(headers);
                  const updateHeaders = (newHeaders: Record<string, string>) => {
                    setFormData((prev) => ({
                      ...prev,
                      config: { ...prev.config, headers: newHeaders },
                    }));
                  };
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Headers*</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            updateHeaders({ ...headers, '': '' });
                          }}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Header
                        </Button>
                      </div>
                      {entries.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No headers added yet. Click "Add Header" to start.
                        </p>
                      )}
                      {entries.map(([key, value], index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <Input
                            value={key}
                            onChange={(e) => {
                              const newEntries = [...entries];
                              newEntries[index] = [e.target.value, value];
                              updateHeaders(Object.fromEntries(newEntries));
                            }}
                            placeholder="Header name"
                            autoComplete="one-time-code"
                            data-1p-ignore
                            data-lpignore="true"
                            className="h-8 text-xs flex-1"
                          />
                          <Input
                            value={value}
                            onChange={(e) => {
                              const newEntries = [...entries];
                              newEntries[index] = [key, e.target.value];
                              updateHeaders(Object.fromEntries(newEntries));
                            }}
                            type="text"
                            style={{ WebkitTextSecurity: 'disc' }}
                            placeholder="Header value"
                            autoComplete="one-time-code"
                            data-1p-ignore
                            data-lpignore="true"
                            className="h-8 text-xs flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              const newEntries = entries.filter((_, i) => i !== index);
                              updateHeaders(Object.fromEntries(newEntries));
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
            </div>

            {/* Test Section (Always visible for HTTP APIs and LLM providers) */}
            {(formData.type === 'http-api' || formData.type === 'llm') && (
              <div className="border rounded-lg">
                <div className="p-2.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Test Credential</span>
                    <span className="text-xs text-muted-foreground">Optional</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Test your credential by making a request to an API endpoint.
                  </p>

                  <div className="flex gap-2">
                    <Select
                      value={testMethod}
                      onValueChange={(value) => {
                        setTestMethod(value as typeof testMethod);
                        setTestStatus('idle');
                      }}
                    >
                      <SelectTrigger size="sm" className="w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      id="testUrl"
                      value={testUrl}
                      onChange={(e) => {
                        setTestUrl(e.target.value);
                        setTestStatus('idle');
                      }}
                      placeholder="https://api.example.com/health"
                      className="flex-1 h-8 text-xs"
                      autoComplete="one-time-code"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={runCredentialTest}
                      disabled={!testUrl || testStatus === 'testing'}
                      className="h-8 text-xs"
                    >
                      {testStatus === 'testing' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </Button>
                  </div>

                  {['POST', 'PUT', 'PATCH'].includes(testMethod) && (
                    <div className="space-y-1">
                      <Label htmlFor="testBody" className="text-xs">
                        Request Body (JSON)
                      </Label>
                      <Textarea
                        id="testBody"
                        value={testBody}
                        onChange={(e) => {
                          setTestBody(e.target.value);
                          setTestStatus('idle');
                        }}
                        placeholder='{"key": "value"}'
                        rows={3}
                        className="font-mono text-xs"
                        autoComplete="one-time-code"
                      />
                    </div>
                  )}

                  {testStatus === 'success' && (
                    <div className="flex items-center gap-1.5 text-xs text-success">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{testMessage}</span>
                    </div>
                  )}

                  {testStatus === 'error' && (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{testMessage}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} className="h-8 text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="h-8 text-xs">
                {isLoading ? 'Creating...' : 'Create Credential'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

interface SetupModeButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}

const SetupModeButton: React.FC<SetupModeButtonProps> = ({
  active,
  icon,
  label,
  hint,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'flex flex-col items-start gap-0.5 px-3 py-2 rounded-md text-left transition-colors',
      active
        ? 'bg-background shadow-sm border border-border'
        : 'border border-transparent hover:bg-background/50',
    )}
  >
    <div className="flex items-center gap-1.5 text-xs font-medium">
      {icon}
      {label}
    </div>
    <span className="text-[10px] text-muted-foreground">{hint}</span>
  </button>
);
