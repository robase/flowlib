/**
 * Provider-managed webhook config step.
 *
 * Renders fields driven by the adapter's `scopeFields` + `events` metadata.
 * On submit, creates the local trigger and immediately registers it with
 * the upstream provider in one user-visible flow.
 */

import { useMemo, useState, type FC } from 'react';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import {
  CredentialCombobox,
  EditCredentialModal,
  useCredentials,
  useUpdateCredential,
  type Credential,
} from '@flowlib/ui';
import {
  useCreateWebhookTrigger,
  useProviderEvents,
  useProviderScopeOptions,
  useRegisterWebhookTrigger,
  WebhookApiError,
} from '../../hooks/useWebhookQueries';
import type {
  RemoteWebhookSummary,
  WebhookProviderScopeField,
  WebhookProviderSummary,
  WebhookTrigger,
} from '../../../shared/types';

interface ProviderConfigStepProps {
  provider: WebhookProviderSummary;
  flowId?: string;
  nodeId?: string;
  onBack: () => void;
  onSuccess: (result: {
    trigger: WebhookTrigger & { fullUrl?: string };
    remote: RemoteWebhookSummary;
  }) => void;
}

export const ProviderConfigStep: FC<ProviderConfigStepProps> = ({
  provider,
  flowId,
  nodeId,
  onBack,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [credentialId, setCredentialId] = useState<string>('');
  const [scope, setScope] = useState<Record<string, unknown>>({});
  const [events, setEvents] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<WebhookApiError | Error | null>(null);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);

  const {
    data: credentials,
    isLoading: credentialsLoading,
    isError: credentialsError,
    refetch: refetchCredentials,
  } = useCredentials();
  const updateCredentialMutation = useUpdateCredential();

  const matchingCredentials = useMemo(() => {
    if (!credentials) {
      return [];
    }
    return credentials.filter((c) => {
      if (provider.oauth2Provider) {
        const credProvider =
          (c.config?.oauth2Provider as string | undefined) ??
          (c.metadata?.oauth2Provider as string | undefined);
        return credProvider === provider.oauth2Provider;
      }
      if (provider.acceptsApiKey) {
        return c.authType === 'apiKey' || c.authType === 'bearer';
      }
      return false;
    });
  }, [credentials, provider]);

  const createMutation = useCreateWebhookTrigger();
  const registerMutation = useRegisterWebhookTrigger();
  const isSubmitting = createMutation.isPending || registerMutation.isPending;

  const handleScopeChange = (field: string, value: unknown) => {
    setScope((prev) => ({ ...prev, [field]: value }));
  };

  const toggleEvent = (value: string) => {
    setEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
    );
  };

  const canSubmit =
    !!name.trim() && !!credentialId && events.length > 0 && areRequiredScopesFilled();

  function areRequiredScopesFilled(): boolean {
    return provider.scopeFields.every((f) => (f.required ? !!scope[f.name] : true));
  }

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitError(null);
    try {
      const created = await createMutation.mutateAsync({
        name: name.trim(),
        description: undefined,
        provider: provider.id as never, // adapter id widened to WebhookProvider on the server
        flowId,
        nodeId,
      });
      const result = await registerMutation.mutateAsync({
        id: created.id,
        providerId: provider.id,
        credentialId,
        scope,
        events,
        description: undefined,
      });
      onSuccess({ trigger: { ...created, ...result.trigger }, remote: result.remote });
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const missingScopes =
    submitError instanceof WebhookApiError && submitError.code === 'MISSING_SCOPES'
      ? ((submitError.details as { missing?: string[] } | undefined)?.missing ?? [])
      : null;

  return (
    <div className="space-y-4">
      {/* Provider header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center w-7 h-7 transition-colors rounded-md hover:bg-accent"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{provider.displayName}</div>
          <p className="text-xs text-muted-foreground">
            We'll create the webhook in {provider.displayName} for you using a connected credential.
          </p>
        </div>
      </div>

      {/* Name */}
      <Field label="Name *">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Linear → Triage flow"
          autoFocus
          className={inputClasses}
        />
      </Field>

      {/* Description hidden for now — sent as the provider's webhook label if the form ever re-exposes it. */}

      {/* Credential */}
      <Field
        label="Credential *"
        helper={
          provider.oauth2Provider
            ? `Pick a connected ${provider.displayName} credential${
                provider.requiredScopes?.length
                  ? ` (must have scopes: ${provider.requiredScopes.join(', ')})`
                  : ''
              }.`
            : undefined
        }
      >
        <CredentialCombobox
          credentials={matchingCredentials}
          value={credentialId}
          onChange={setCredentialId}
          placeholder={
            matchingCredentials.length === 0
              ? `No ${provider.displayName} credentials connected`
              : `Select a ${provider.displayName} credential`
          }
          isLoading={credentialsLoading}
          isError={credentialsError}
          onRetry={() => refetchCredentials()}
          onAddNew={() => {
            // For POC: opens a new tab to the credentials page so the user
            // can connect via OAuth there. Wiring an inline create modal
            // requires a redesign of this dialog (it would be a 4th nested
            // modal). Worth doing later.
            window.open('/credentials', '_blank');
          }}
          onEditCredential={(credential) => setEditingCredential(credential)}
          addButtonLabel={`Connect ${provider.displayName}`}
        />
      </Field>

      {/* Scope fields */}
      {credentialId &&
        provider.scopeFields.map((field) => (
          <ScopeFieldInput
            key={field.name}
            providerId={provider.id}
            credentialId={credentialId}
            field={field}
            value={scope[field.name]}
            scope={scope}
            onChange={(v) => handleScopeChange(field.name, v)}
          />
        ))}

      {/* Events */}
      {credentialId && (
        <EventsPicker
          providerId={provider.id}
          credentialId={credentialId}
          scope={scope}
          eventsKind={provider.eventsKind}
          staticEvents={provider.events}
          selected={events}
          onToggle={toggleEvent}
        />
      )}

      {submitError && missingScopes ? (
        <div className="flex items-start gap-2 p-3 text-xs border rounded-lg border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="font-medium">Credential needs additional scopes</div>
            <p className="text-amber-700 dark:text-amber-400">
              This {provider.displayName} credential is missing{' '}
              <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40 font-mono text-[11px]">
                {missingScopes.join(', ')}
              </code>{' '}
              — required to manage webhooks. Disconnect and reconnect the credential to grant the
              new scope, or pick a different one.
            </p>
          </div>
        </div>
      ) : submitError ? (
        <p className="text-sm text-red-500">{submitError.message}</p>
      ) : null}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center flex-1 px-3 text-sm font-medium transition-colors border rounded-md shadow-xs h-9 bg-background hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="inline-flex items-center justify-center flex-1 px-3 text-sm font-medium transition-colors rounded-md h-9 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              {createMutation.isPending ? 'Creating…' : 'Registering…'}
            </>
          ) : (
            `Create & register with ${provider.displayName}`
          )}
        </button>
      </div>

      {editingCredential && (
        <EditCredentialModal
          open={!!editingCredential}
          credential={editingCredential}
          isLoading={updateCredentialMutation.isPending}
          onClose={() => setEditingCredential(null)}
          onSubmit={async (data) => {
            await updateCredentialMutation.mutateAsync({ id: editingCredential.id, data });
            setEditingCredential(null);
          }}
        />
      )}
    </div>
  );
};

// ─── Field renderers ──────────────────────────────────────────────────

const inputClasses =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20';
const selectClasses =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-50';

const Field: FC<{ label: string; helper?: string; children: React.ReactNode }> = ({
  label,
  helper,
  children,
}) => (
  <div className="space-y-2">
    <label className="text-sm font-medium">{label}</label>
    {children}
    {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
  </div>
);

const ScopeFieldInput: FC<{
  providerId: string;
  credentialId: string;
  field: WebhookProviderScopeField;
  value: unknown;
  scope: Record<string, unknown>;
  onChange: (v: unknown) => void;
}> = ({ providerId, credentialId, field, value, scope, onChange }) => {
  if (field.type === 'async-picker') {
    return (
      <AsyncPickerField
        providerId={providerId}
        credentialId={credentialId}
        field={field}
        value={value}
        scope={scope}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <Field label={field.label + (field.required ? ' *' : '')}>
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={selectClasses}
        >
          <option value="">— Select —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={field.label + (field.required ? ' *' : '')}>
      <input
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={inputClasses}
      />
    </Field>
  );
};

const AsyncPickerField: FC<{
  providerId: string;
  credentialId: string;
  field: WebhookProviderScopeField;
  value: unknown;
  scope: Record<string, unknown>;
  onChange: (v: unknown) => void;
}> = ({ providerId, credentialId, field, value, scope, onChange }) => {
  const { data, isLoading, isError, error } = useProviderScopeOptions(
    providerId,
    field.loader,
    credentialId,
    scope,
  );

  const missingScopes =
    error instanceof WebhookApiError && error.code === 'MISSING_SCOPES'
      ? ((error.details as { missing?: string[] } | undefined)?.missing ?? [])
      : null;

  return (
    <Field label={field.label + (field.required ? ' *' : '')}>
      <select
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={isLoading || isError}
        className={selectClasses}
      >
        <option value="">
          {isLoading
            ? 'Loading…'
            : isError
              ? 'Unavailable — see message below'
              : data && data.length === 0
                ? 'No options available'
                : '— Select —'}
        </option>
        {data?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isError && missingScopes ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Selected credential is missing{' '}
          <code className="font-mono">{missingScopes.join(', ')}</code> scope. Reconnect it (Connect
          via OAuth) to grant the new scope.
        </p>
      ) : isError ? (
        <p className="text-xs text-red-500">{error?.message ?? 'Failed to load options'}</p>
      ) : null}
    </Field>
  );
};

const EventsPicker: FC<{
  providerId: string;
  credentialId: string;
  scope: Record<string, unknown>;
  eventsKind: 'static' | 'dynamic';
  staticEvents: WebhookProviderSummary['events'];
  selected: string[];
  onToggle: (value: string) => void;
}> = ({ providerId, credentialId, scope, eventsKind, staticEvents, selected, onToggle }) => {
  const dynamicEvents = useProviderEvents(
    providerId,
    eventsKind === 'dynamic' ? credentialId : undefined,
    scope,
  );
  const events = eventsKind === 'static' ? (staticEvents ?? []) : (dynamicEvents.data ?? []);
  const isLoading = eventsKind === 'dynamic' && dynamicEvents.isLoading;

  return (
    <Field label={`Events * (${selected.length} selected)`}>
      <div className="border rounded-md border-input bg-background max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No events available</div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((ev) => (
              <label
                key={ev.value}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(ev.value)}
                  onChange={() => onToggle(ev.value)}
                  className="w-4 h-4 rounded border-input"
                />
                <span className="text-sm">{ev.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
};
