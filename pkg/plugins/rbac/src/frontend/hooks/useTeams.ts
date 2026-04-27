/**
 * useTeams — React Query hooks for team management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type {
  Team,
  TeamWithMembers,
  CreateTeamRequest,
  UpdateTeamRequest,
  AddTeamMemberRequest,
  TeamMember,
} from '../../shared/types';

/** List all teams */
export function useTeams() {
  const api = useApiClient();

  return useQuery<{ teams: Team[] }>({
    queryKey: ['rbac', 'teams'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch teams: ${response.status}`);
      }
      return response.json();
    },
  });
}

/** Get a single team with members */
export function useTeam(teamId: string | undefined) {
  const api = useApiClient();

  return useQuery<TeamWithMembers>({
    queryKey: ['rbac', 'team', teamId],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams/${teamId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch team: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!teamId,
  });
}

/** Get current user's teams */
export function useMyTeams() {
  const api = useApiClient();

  return useQuery<{ teams: Team[] }>({
    queryKey: ['rbac', 'my-teams'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/my-teams`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch my teams: ${response.status}`);
      }
      return response.json();
    },
  });
}

/** Create a team */
export function useCreateTeam() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTeamRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create team: ${response.status}`);
      }
      return response.json() as Promise<Team>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'teams'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

/** Update a team */
export function useUpdateTeam(teamId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTeamRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams/${teamId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update team: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'teams'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

/** Delete a team */
export function useDeleteTeam() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams/${teamId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to delete team: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'teams'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

/** Add a member to a team */
export function useAddTeamMember(teamId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddTeamMemberRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to add member: ${response.status}`);
      }
      return response.json() as Promise<TeamMember>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'teams'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

/** Remove a member from a team */
export function useRemoveTeamMember(teamId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(
        `${api.getBaseURL()}/plugins/rbac/teams/${teamId}/members/${userId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to remove member: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'teams'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}
