// Settings React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys } from './query-keys';
import { staleTime } from './stale-times';
import type { SetSettingInput } from './types';

export function useSettings(namespace?: string) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: queryKeys.settings(namespace),
    queryFn: async () => (await apiClient.listSettings(namespace)).settings,
    staleTime: staleTime.medium,
  });
}

export function useSetting(key: string, options?: { enabled?: boolean }) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: queryKeys.setting(key),
    queryFn: () => apiClient.getSetting(key),
    enabled: options?.enabled ?? Boolean(key),
    staleTime: staleTime.medium,
  });
}

export function useSettingsDescriptors() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: queryKeys.settingsDescriptors,
    // Descriptors are static for the lifetime of the running backend —
    // they're contributed by registered plugins at init time. Cache for a
    // long time; a hard refresh covers the only case that flips them.
    queryFn: async () => (await apiClient.getSettingsDescriptors()).groups,
    staleTime: staleTime.long,
  });
}

export function useSetSetting() {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: SetSettingInput }) =>
      apiClient.setSetting(key, input),
    onSuccess: (_data, variables) => {
      // Settings are cheap to refetch and operators expect immediate
      // feedback after a save — invalidate every settings query.
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: queryKeys.setting(variables.key) });
    },
  });
}

export function useDeleteSetting() {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiClient.deleteSetting(key),
    onSuccess: (_data, key) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: queryKeys.setting(key) });
    },
  });
}
