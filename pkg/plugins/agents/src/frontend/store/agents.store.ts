/**
 * Ephemeral UI state for the agents plugin.
 *
 * Backend data lives in React Query (see `hooks/`), not here. This
 * store covers everything React Query shouldn't:
 *
 *   - the AgentsPage filter chips (provider, search query)
 *   - the AgentFormPage's draft (so step navigation doesn't drop fields)
 *   - the AgentDetailPage's active settings tab
 *
 * Designed to stay narrow. If you find yourself adding server data
 * here, push it back into a React Query hook instead.
 */

import { create } from 'zustand';
import type { AgentProviderId } from '../../shared/types';

export interface AgentFormDraft {
  name: string;
  description: string;
  providerId: AgentProviderId | '';
  defaultModel: string;
  personaText: string;
  workspaceId: string | null;
  /** JSON-encoded text — parsed at submit time so users can hand-edit. */
  mcpServersText: string;
}

export const emptyAgentFormDraft: AgentFormDraft = {
  name: '',
  description: '',
  providerId: '',
  defaultModel: '',
  personaText: '',
  workspaceId: null,
  mcpServersText: '',
};

export type AgentDetailTab = 'sessions' | 'settings' | 'permissions';

export interface AgentsUiState {
  // ── AgentsPage filters ────────────────────────────────────────
  searchQuery: string;
  providerFilter: AgentProviderId | 'all';
  setSearchQuery: (q: string) => void;
  setProviderFilter: (p: AgentProviderId | 'all') => void;

  // ── AgentFormPage draft ───────────────────────────────────────
  formStep: number;
  formDraft: AgentFormDraft;
  setFormStep: (step: number) => void;
  updateFormDraft: (patch: Partial<AgentFormDraft>) => void;
  resetFormDraft: () => void;

  // ── AgentDetailPage tabs ──────────────────────────────────────
  detailTab: AgentDetailTab;
  setDetailTab: (tab: AgentDetailTab) => void;
}

export const useAgentsUiStore = create<AgentsUiState>((set) => ({
  searchQuery: '',
  providerFilter: 'all',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setProviderFilter: (providerFilter) => set({ providerFilter }),

  formStep: 0,
  formDraft: { ...emptyAgentFormDraft },
  setFormStep: (formStep) => set({ formStep }),
  updateFormDraft: (patch) =>
    set((state) => ({ formDraft: { ...state.formDraft, ...patch } })),
  resetFormDraft: () => set({ formStep: 0, formDraft: { ...emptyAgentFormDraft } }),

  detailTab: 'sessions',
  setDetailTab: (detailTab) => set({ detailTab }),
}));
