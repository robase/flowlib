import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';
import type { FlowRunStatus } from '@flowlib/core/types';

interface ExecutionViewState {
  // Currently viewed execution
  activeFlowRunId: string | null;
  activeFlowId: string | null;

  // Selected node in execution view (for viewing outputs)
  selectedExecutionNodeId: string | null;

  // Execution list filters
  statusFilter: FlowRunStatus | 'all';
  flowIdFilter: string | null;

  // Pagination
  page: number;
  limit: number;

  // Sorting
  sortBy: 'startedAt' | 'endedAt' | 'status';
  sortOrder: 'asc' | 'desc';

  // Logs panel state
  logsExpanded: boolean;
  selectedLogNodeId: string | null;
}

interface ExecutionViewActions {
  // Active execution
  setActiveExecution: (flowId: string, flowRunId: string) => void;
  clearActiveExecution: () => void;

  // Node selection in execution view
  selectExecutionNode: (nodeId: string | null) => void;

  // Filters
  setStatusFilter: (status: FlowRunStatus | 'all') => void;
  setFlowIdFilter: (flowId: string | null) => void;
  clearFilters: () => void;

  // Pagination
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;

  // Sorting
  setSortBy: (sortBy: ExecutionViewState['sortBy']) => void;
  setSortOrder: (sortOrder: ExecutionViewState['sortOrder']) => void;

  // Logs
  toggleLogsExpanded: () => void;
  setLogsExpanded: (expanded: boolean) => void;
  selectLogNode: (nodeId: string | null) => void;

  // Reset
  reset: () => void;
}

export type ExecutionViewStore = ExecutionViewState & ExecutionViewActions;

const initialState: ExecutionViewState = {
  activeFlowRunId: null,
  activeFlowId: null,
  selectedExecutionNodeId: null,
  statusFilter: 'all',
  flowIdFilter: null,
  page: 1,
  limit: 20,
  sortBy: 'startedAt',
  sortOrder: 'desc',
  logsExpanded: false,
  selectedLogNodeId: null,
};

export const useExecutionViewStore: UseBoundStore<StoreApi<ExecutionViewStore>> =
  create<ExecutionViewStore>()(
    devtools(
      subscribeWithSelector(
        immer((set) => ({
          ...initialState,

          // Active execution
          setActiveExecution: (flowId, flowRunId) =>
            set((state) => {
              state.activeFlowId = flowId;
              state.activeFlowRunId = flowRunId;
              state.selectedExecutionNodeId = null;
              state.selectedLogNodeId = null;
            }),

          clearActiveExecution: () =>
            set((state) => {
              state.activeFlowId = null;
              state.activeFlowRunId = null;
              state.selectedExecutionNodeId = null;
              state.selectedLogNodeId = null;
            }),

          // Node selection
          selectExecutionNode: (nodeId) =>
            set((state) => {
              state.selectedExecutionNodeId = nodeId;
            }),

          // Filters
          setStatusFilter: (status) =>
            set((state) => {
              state.statusFilter = status;
              state.page = 1; // Reset to first page when filter changes
            }),

          setFlowIdFilter: (flowId) =>
            set((state) => {
              state.flowIdFilter = flowId;
              state.page = 1;
            }),

          clearFilters: () =>
            set((state) => {
              state.statusFilter = 'all';
              state.flowIdFilter = null;
              state.page = 1;
            }),

          // Pagination
          setPage: (page) =>
            set((state) => {
              state.page = page;
            }),

          setLimit: (limit) =>
            set((state) => {
              state.limit = limit;
              state.page = 1; // Reset to first page when limit changes
            }),

          // Sorting
          setSortBy: (sortBy) =>
            set((state) => {
              state.sortBy = sortBy;
            }),

          setSortOrder: (sortOrder) =>
            set((state) => {
              state.sortOrder = sortOrder;
            }),

          // Logs
          toggleLogsExpanded: () =>
            set((state) => {
              state.logsExpanded = !state.logsExpanded;
            }),

          setLogsExpanded: (expanded) =>
            set((state) => {
              state.logsExpanded = expanded;
            }),

          selectLogNode: (nodeId) =>
            set((state) => {
              state.selectedLogNodeId = nodeId;
            }),

          // Reset
          reset: () => set(() => ({ ...initialState })),
        })),
      ),
      { name: 'execution-view' },
    ),
  );

// Selector hooks
export const useActiveFlowRunId = () => useExecutionViewStore((s) => s.activeFlowRunId);
export const useActiveFlowId = () => useExecutionViewStore((s) => s.activeFlowId);
export const useSelectedExecutionNodeId = () =>
  useExecutionViewStore((s) => s.selectedExecutionNodeId);
export const useStatusFilter = () => useExecutionViewStore((s) => s.statusFilter);
export const useExecutionPagination = () =>
  useExecutionViewStore(
    useShallow((s) => ({
      page: s.page,
      limit: s.limit,
      setPage: s.setPage,
      setLimit: s.setLimit,
    })),
  );
export const useExecutionSorting = () =>
  useExecutionViewStore(
    useShallow((s) => ({
      sortBy: s.sortBy,
      sortOrder: s.sortOrder,
      setSortBy: s.setSortBy,
      setSortOrder: s.setSortOrder,
    })),
  );
export const useLogsState = () =>
  useExecutionViewStore(
    useShallow((s) => ({
      logsExpanded: s.logsExpanded,
      selectedLogNodeId: s.selectedLogNodeId,
      toggleLogsExpanded: s.toggleLogsExpanded,
      setLogsExpanded: s.setLogsExpanded,
      selectLogNode: s.selectLogNode,
    })),
  );

// Combined selectors
export const useExecutionFilters = () =>
  useExecutionViewStore(
    useShallow((s) => ({
      statusFilter: s.statusFilter,
      flowIdFilter: s.flowIdFilter,
      setStatusFilter: s.setStatusFilter,
      setFlowIdFilter: s.setFlowIdFilter,
      clearFilters: s.clearFilters,
    })),
  );
