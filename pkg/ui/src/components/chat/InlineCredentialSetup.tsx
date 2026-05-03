/**
 * InlineCredentialSetup — Inline form for creating an LLM credential
 * directly inside the chat panel (no modal, no navigation).
 *
 * If existing LLM credentials exist, shows a quick picker first.
 * Otherwise shows: Provider (OpenAI/Anthropic/OpenRouter), Name, API Key.
 * On submit: creates credential → validates via list-models → auto-selects.
 */

import React, { useState, useCallback } from 'react';
import {
  KeyRound,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useApiClient } from '~/contexts/ApiContext';
import { useCredentials, useCreateCredential } from '~/api/credentials.api';
import { useChatStore } from './chat.store';

// =====================================
// Provider presets
// =====================================

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { value: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
] as const;

type LlmProvider = (typeof LLM_PROVIDERS)[number]['value'];

function getDefaultName(provider: LlmProvider): string {
  const label = LLM_PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
  return `${label}-assistant`;
}

function getBaseUrl(provider: LlmProvider): string | undefined {
  if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
  }
  return undefined;
}

// =====================================
// Component
// =====================================

type FormState = 'idle' | 'creating' | 'validating' | 'success' | 'error';

export function InlineCredentialSetup() {
  const { data: existingCredentials = [] } = useCredentials({ type: 'llm', isActive: true });
  const [showCreateForm, setShowCreateForm] = useState(false);

  // If existing credentials exist and user hasn't clicked "create new", show the picker
  if (existingCredentials.length > 0 && !showCreateForm) {
    return (
      <ExistingCredentialPicker
        credentials={existingCredentials}
        onCreateNew={() => setShowCreateForm(true)}
      />
    );
  }

  return (
    <CreateCredentialForm
      onBack={existingCredentials.length > 0 ? () => setShowCreateForm(false) : undefined}
    />
  );
}

// =====================================
// ExistingCredentialPicker
// =====================================

function ExistingCredentialPicker({
  credentials,
  onCreateNew,
}: {
  credentials: Array<{ id: string; name: string }>;
  onCreateNew: () => void;
}) {
  const handleSelect = useCallback((id: string) => {
    useChatStore.getState().updateSettings({ credentialId: id });
  }, []);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 mx-2 w-full max-w-sm">
      <div className="flex flex-col items-center gap-2 pb-1">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="size-4 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Select an LLM provider</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Choose a credential to power the chat assistant.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {credentials.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => handleSelect(c.id)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border rounded-lg text-foreground/80 border-border/50 bg-background hover:bg-accent/50 hover:border-border"
          >
            <KeyRound className="size-3 text-muted-foreground/50 shrink-0" />
            <span className="flex-1 truncate">{c.name}</span>
            <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
          </button>
        ))}
      </div>

      <div className="relative flex items-center gap-2 py-0.5">
        <div className="flex-1 border-t border-border/40" />
        <span className="text-[10px] text-muted-foreground/60">or</span>
        <div className="flex-1 border-t border-border/40" />
      </div>

      <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={onCreateNew}>
        <Plus className="size-3.5" />
        Add New Provider
      </Button>
    </div>
  );
}

// =====================================
// CreateCredentialForm
// =====================================

function CreateCredentialForm({ onBack }: { onBack?: () => void }) {
  const apiClient = useApiClient();
  const createCredential = useCreateCredential();

  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [modelCount, setModelCount] = useState(0);

  const effectiveName = name.trim() || getDefaultName(provider);
  const canSubmit =
    apiKey.trim().length > 0 && formState !== 'creating' && formState !== 'validating';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) {
        return;
      }

      setErrorMsg('');
      setFormState('creating');

      try {
        // 1. Create the credential
        const credential = await createCredential.mutateAsync({
          name: effectiveName,
          type: 'llm',
          authType: 'apiKey',
          config: {
            apiKey: apiKey.trim(),
            ...(getBaseUrl(provider) ? { baseUrl: getBaseUrl(provider) } : {}),
          },
          metadata: { provider },
        });

        // 2. Validate by listing models
        setFormState('validating');
        try {
          const models = await apiClient.getChatModels(credential.id);
          setModelCount(models.length);
        } catch {
          // Key created but validation failed — still usable, warn user
          setModelCount(0);
        }

        // 3. Auto-select in chat settings
        useChatStore.getState().updateSettings({ credentialId: credential.id });

        setFormState('success');
      } catch (err: unknown) {
        setFormState('error');
        setErrorMsg((err as Error).message || 'Failed to create credential');
      }
    },
    [canSubmit, effectiveName, apiKey, provider, createCredential, apiClient],
  );

  // After success, show brief confirmation then the chat will re-render
  // (because hasConfiguredCredential becomes true via the store update)
  if (formState === 'success') {
    return (
      <div className="mx-2 flex w-full max-w-88 flex-col items-center gap-2.5 rounded-xl border bg-muted/20 p-4">
        <div className="flex size-9 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="size-5 text-success" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Provider connected</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {modelCount > 0
              ? `API key verified — ${modelCount} models available.`
              : 'Credential saved. You can start chatting now.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      className="mx-2 flex w-full max-w-88 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-3 pb-0.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="size-4.5 text-primary" />
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold text-foreground">Connect an LLM provider</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add an API key to start chatting with the assistant.
          </p>
        </div>
      </div>

      {/* Provider */}
      <div className="space-y-1.5 text-left">
        <label className="text-xs font-medium text-muted-foreground">Provider</label>
        <Select
          value={provider}
          onValueChange={(v) => {
            setProvider(v as LlmProvider);
            if (!name.trim()) {
              setName('');
            }
          }}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LLM_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Name */}
      <div className="space-y-1.5 text-left">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={getDefaultName(provider)}
          className="h-9 text-xs"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
      </div>

      {/* API Key */}
      <div className="space-y-1.5 text-left">
        <label className="text-xs font-medium text-muted-foreground">API Key</label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={LLM_PROVIDERS.find((p) => p.value === provider)?.placeholder ?? 'sk-...'}
            className="h-9 pr-8 text-xs font-mono"
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            tabIndex={-1}
          >
            {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Error */}
      {formState === 'error' && errorMsg && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Submit */}
      <Button type="submit" size="sm" className="w-full gap-1.5" disabled={!canSubmit}>
        {formState === 'creating' ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Saving…
          </>
        ) : formState === 'validating' ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Verifying key…
          </>
        ) : (
          'Connect Provider'
        )}
      </Button>

      {/* Back link */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors text-center"
        >
          ← Back to existing providers
        </button>
      )}
    </form>
  );
}
