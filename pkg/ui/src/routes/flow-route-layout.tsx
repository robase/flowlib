import React, { useMemo, useCallback, createContext, useContext } from 'react';
import { Outlet, useParams, useLocation } from 'react-router';
import { FlowHeader } from '../components/flow-editor/FlowHeader';
import { useFlowEditor } from '../components/flow-editor/use-flow-editor';
import { useUpdateFlow } from '../api/flows.api';
import { ReactFlowProvider } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/query-keys';
import type { ReactFlowData } from '@flowlib/core/types';

interface FlowRouteLayoutProps {
  basePath?: string;
}

// Options for save operation
interface SaveOptions {
  skipSuccessToast?: boolean;
}

// Context for flow actions
export interface FlowActionsContextType {
  // Always available
  onExecute: () => Promise<void>;
  isExecuting: boolean;
  isActive?: boolean;
  isTogglingActive: boolean;
  onToggleActive?: () => void;
  // Edit-only
  isDirty?: boolean;
  onSave?: (options?: SaveOptions) => Promise<boolean>;
  isSaving?: boolean;
}

export const FlowActionsContext = createContext<FlowActionsContextType | null>(null);

export function useFlowActions() {
  return useContext(FlowActionsContext);
}

export function FlowRouteLayout({ basePath = '' }: FlowRouteLayoutProps) {
  const { flowId, version } = useParams();
  const location = useLocation();

  // Only provide context in edit view (when path ends with flow ID or version)
  const isEditView = location.pathname.includes('/flow/') && !location.pathname.includes('/runs');

  // Use the new Zustand-based hook
  const { flowName, isDirty, isActive, save, execute, isSaving, isExecuting } = useFlowEditor({
    flowId: flowId ?? '',
    version,
    basePath,
  });

  // Toggle flow active state
  const updateFlowMutation = useUpdateFlow();
  const queryClient = useQueryClient();

  const handleToggleActive = useCallback(() => {
    if (!flowId || isActive === undefined) {
      return;
    }
    updateFlowMutation.mutate({ id: flowId, data: { isActive: !isActive } });
  }, [flowId, isActive, updateFlowMutation]);

  const handleFlowNameChange = useCallback(
    (name: string) => {
      if (!flowId) {
        return;
      }
      // Optimistically update the React Query cache so the header reflects the
      // change immediately without waiting for the server round-trip.
      queryClient.setQueryData<ReactFlowData>(queryKeys.reactFlow(flowId, version), (old) =>
        old ? { ...old, name } : old,
      );
      updateFlowMutation.mutate({ id: flowId, data: { name } });
    },
    [flowId, version, queryClient, updateFlowMutation],
  );

  // Context value — always provided for Run + Active/Inactive; save fields only in edit view
  const flowActionsValue = useMemo<FlowActionsContextType>(
    () => ({
      onExecute: execute,
      isExecuting,
      isActive,
      isTogglingActive: updateFlowMutation.isPending,
      onToggleActive: handleToggleActive,
      ...(isEditView
        ? {
            isDirty,
            onSave: save,
            isSaving,
          }
        : {}),
    }),
    [
      isEditView,
      isDirty,
      save,
      execute,
      isSaving,
      isExecuting,
      isActive,
      updateFlowMutation.isPending,
      handleToggleActive,
    ],
  );

  return (
    <ReactFlowProvider>
      <FlowActionsContext.Provider value={flowActionsValue}>
        <div className="fl-page flex flex-col flex-1 min-h-0 bg-fl-background">
          <FlowHeader
            flowName={flowName}
            onFlowNameChange={handleFlowNameChange}
            isDirty={flowActionsValue?.isDirty}
            onSave={flowActionsValue?.onSave}
            isSaving={flowActionsValue?.isSaving}
            basePath={basePath}
          />
          <div className="fl-page flex-1 min-h-0 bg-fl-background">
            <Outlet />
          </div>
        </div>
      </FlowActionsContext.Provider>
    </ReactFlowProvider>
  );
}

export default FlowRouteLayout;
