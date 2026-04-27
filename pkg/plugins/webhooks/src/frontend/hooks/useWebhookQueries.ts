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
} from '../../shared/types';

// ─── API helper ─────────────────────────────────────────────────────

async function apiFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Query Keys ─────────────────────────────────────────────────────

const keys = {
  all: ['webhooks'] as const,
  list: () => [...keys.all, 'list'] as const,
  detail: (id: string) => [...keys.all, 'detail', id] as const,
  info: (id: string) => [...keys.all, 'info', id] as const,
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
