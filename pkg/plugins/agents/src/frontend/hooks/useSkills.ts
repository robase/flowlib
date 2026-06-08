/**
 * React Query hooks for the org-scoped skills catalogue.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentSkill } from '../../shared/types';
import type { CreateSkillInput, UpdateSkillInput } from '../api/skills.api';
import { useAgentsApiClients } from '../api/context';

export const skillsKeys = {
  all: ['agents', 'skills'] as const,
  list: () => [...skillsKeys.all, 'list'] as const,
  detail: (id: string) => [...skillsKeys.all, 'detail', id] as const,
};

export function useSkills() {
  const { skills } = useAgentsApiClients();
  return useQuery<AgentSkill[]>({
    queryKey: skillsKeys.list(),
    queryFn: async () => {
      const r = await skills.list();
      return r.data;
    },
  });
}

export function useCreateSkill() {
  const { skills } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentSkill, Error, CreateSkillInput>({
    mutationFn: (input) => skills.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.list() }),
  });
}

export function useUpdateSkill() {
  const { skills } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentSkill, Error, { id: string; input: UpdateSkillInput }>({
    mutationFn: ({ id, input }) => skills.update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillsKeys.list() });
      qc.setQueryData(skillsKeys.detail(data.id), data);
    },
  });
}

export function useDeleteSkill() {
  const { skills } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => skills.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.list() }),
  });
}
