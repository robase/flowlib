import type { CredentialFilters } from './types';

export const queryKeys = {
  flows: ['flows'] as const,
  flow: (id: string) => ['flows', id] as const,
  flowVersions: (flowId: string) => ['flows', flowId, 'versions'] as const,
  executions: (flowId: string) => ['executions', flowId] as const,
  flowRun: (id: string) => ['executions', id] as const,
  allExecutions: (
    flowId?: string,
    status?: string,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ) => ['executions', 'all', flowId, status, page, limit, sortBy, sortOrder] as const,
  nodeExecutions: (flowRunId: string) => ['node-executions', flowRunId] as const,
  models: ['models'] as const,
  reactFlow: (flowId: string, version?: string, flowRunId?: string) =>
    ['flows', flowId, 'react-flow', version, flowRunId] as const,
  credentials: (filters?: CredentialFilters) =>
    ['credentials', filters ? JSON.stringify(filters) : 'all'] as const,
  credential: (id: string) => ['credentials', id] as const,
  credentialUsage: (id: string) => ['credentials', id, 'usage'] as const,
  agentTools: ['agent', 'tools'] as const,
  fieldOptions: (actionId: string, fieldName: string, deps: string) =>
    ['field-options', actionId, fieldName, deps] as const,
  actionLoader: (actionId: string, loaderName: string, deps: string, query: string) =>
    ['action-loader', actionId, loaderName, deps, query] as const,
  availableNodes: ['available-nodes'] as const,
  triggers: (flowId: string) => ['flows', flowId, 'triggers'] as const,
  trigger: (triggerId: string) => ['triggers', triggerId] as const,
  dashboardStats: ['dashboard', 'stats'] as const,
  settings: (namespace?: string) => ['settings', namespace ?? 'all'] as const,
  setting: (key: string) => ['settings', 'item', key] as const,
  settingsDescriptors: ['settings', 'descriptors'] as const,
};

// Enhanced error handling
export function getErrorMessage(error: unknown): string {
  // Import ValidationError dynamically to avoid circular deps
  if (error instanceof Error && error.name === 'ValidationError') {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}
