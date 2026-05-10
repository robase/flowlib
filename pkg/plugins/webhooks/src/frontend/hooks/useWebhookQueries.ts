/**
 * React hooks for the webhooks plugin API.
 *
 * Uses @flowlib/ui's ApiContext for the base URL.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiBaseURL } from '@flowlib/ui';
import type {
  WebhookTrigger,
  CreateWebhookTriggerInput,
  UpdateWebhookTriggerInput,
  WebhookTriggerInfo,
  WebhookProviderSummary,
  WebhookProviderOption,
  RegisterTriggerInput,
  RemoteWebhookSummary,
  UpdateRegistrationInput,
} from '../../shared/types';

// ─── API helper ─────────────────────────────────────────────────────

/**
 * Error thrown when the server responds with a non-2xx and a JSON body.
 * Preserves `code` and `details` so callers can branch on stable error
 * codes (e.g. `MISSING_SCOPES`) rather than parsing the message string.
 */
export class WebhookApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WebhookApiError';
  }
}

async function apiFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      details?: unknown;
    };
    throw new WebhookApiError(
      body.error || `HTTP ${res.status}`,
      res.status,
      body.code,
      body.details,
    );
  }
  return res.json() as Promise<T>;
}

// ─── Query Keys ─────────────────────────────────────────────────────

const keys = {
  all: ['webhooks'] as const,
  list: () => [...keys.all, 'list'] as const,
  detail: (id: string) => [...keys.all, 'detail', id] as const,
  info: (id: string) => [...keys.all, 'info', id] as const,
  providers: () => [...keys.all, 'providers'] as const,
  providerEvents: (id: string, credentialId: string, scope: Record<string, unknown>) =>
    [...keys.all, 'provider-events', id, credentialId, scope] as const,
  providerScopeOptions: (
    id: string,
    field: string,
    credentialId: string,
    scope: Record<string, unknown>,
  ) => [...keys.all, 'provider-scope-options', id, field, credentialId, scope] as const,
};

// ─── Queries ────────────────────────────────────────────────────────

export function useWebhookTriggers() {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.list(),
    queryFn: () =>
      apiFetch<{ data: WebhookTrigger[] }>(baseUrl, '/plugins/webhooks/triggers').then(
        (r) => r.data,
      ),
  });
}

export function useWebhookTrigger(id: string | undefined) {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: () => apiFetch<WebhookTrigger>(baseUrl, `/plugins/webhooks/triggers/${id}`),
    enabled: !!id,
  });
}

export function useWebhookTriggerInfo(id: string | undefined) {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.info(id ?? ''),
    queryFn: () => apiFetch<WebhookTriggerInfo>(baseUrl, `/plugins/webhooks/triggers/${id}/info`),
    enabled: !!id,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────

export function useCreateWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookTriggerInput) =>
      apiFetch<WebhookTrigger & { fullUrl?: string }>(baseUrl, '/plugins/webhooks/triggers', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list() }),
  });
}

export function useUpdateWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateWebhookTriggerInput & { id: string }) =>
      apiFetch<WebhookTrigger>(baseUrl, `/plugins/webhooks/triggers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.detail(vars.id) });
    },
  });
}

export function useDeleteWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(baseUrl, `/plugins/webhooks/triggers/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.list() }),
  });
}

export function useTestWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: unknown }) =>
      apiFetch<{ status: string }>(baseUrl, `/plugins/webhooks/triggers/${id}/test`, {
        method: 'POST',
        body: JSON.stringify(payload ?? { test: true }),
      }),
  });
}

// ─── Provider Registration ─────────────────────────────────────────

export function useWebhookProviders() {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.providers(),
    queryFn: () =>
      apiFetch<{ data: WebhookProviderSummary[] }>(baseUrl, '/plugins/webhooks/providers').then(
        (r) => r.data,
      ),
    staleTime: 5 * 60_000,
  });
}

export function useProviderEvents(
  providerId: string | undefined,
  credentialId: string | undefined,
  scope: Record<string, unknown>,
) {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.providerEvents(providerId ?? '', credentialId ?? '', scope),
    queryFn: () => {
      const params = new URLSearchParams({
        credentialId: credentialId ?? '',
        scope: JSON.stringify(scope ?? {}),
      });
      return apiFetch<{ data: WebhookProviderOption[] }>(
        baseUrl,
        `/plugins/webhooks/providers/${providerId}/events?${params.toString()}`,
      ).then((r) => r.data);
    },
    enabled: !!providerId && !!credentialId,
  });
}

export function useProviderScopeOptions(
  providerId: string | undefined,
  field: string | undefined,
  credentialId: string | undefined,
  scope: Record<string, unknown>,
) {
  const baseUrl = useApiBaseURL();
  return useQuery({
    queryKey: keys.providerScopeOptions(providerId ?? '', field ?? '', credentialId ?? '', scope),
    queryFn: () => {
      const params = new URLSearchParams({
        credentialId: credentialId ?? '',
        scope: JSON.stringify(scope ?? {}),
      });
      return apiFetch<{ data: WebhookProviderOption[] }>(
        baseUrl,
        `/plugins/webhooks/providers/${providerId}/scope-options/${field}?${params.toString()}`,
      ).then((r) => r.data);
    },
    enabled: !!providerId && !!credentialId && !!field,
  });
}

export function useRegisterWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: RegisterTriggerInput & { id: string }) =>
      apiFetch<{ trigger: WebhookTrigger; remote: RemoteWebhookSummary }>(
        baseUrl,
        `/plugins/webhooks/triggers/${id}/register`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.detail(vars.id) });
    },
  });
}

export function useUnregisterWebhookTrigger() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ trigger: WebhookTrigger }>(baseUrl, `/plugins/webhooks/triggers/${id}/register`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.detail(id) });
    },
  });
}

export function useUpdateWebhookRegistration() {
  const baseUrl = useApiBaseURL();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRegistrationInput & { id: string }) =>
      apiFetch<{ trigger: WebhookTrigger; remote: RemoteWebhookSummary }>(
        baseUrl,
        `/plugins/webhooks/triggers/${id}/register`,
        { method: 'PATCH', body: JSON.stringify(input) },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.list() });
      qc.invalidateQueries({ queryKey: keys.detail(vars.id) });
    },
  });
}
