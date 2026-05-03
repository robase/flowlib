/**
 * @flowlib/version-control/ui — Frontend Plugin Entry Point
 *
 * Browser-safe entry point that exports the Version Control frontend plugin.
 * Import via: `import { vcFrontendPlugin } from '@flowlib/version-control/ui'`
 */

import { GitBranch } from 'lucide-react';
import { VcSyncPanel } from './components/VcSyncPanel';
import { VcHeaderButton } from './components/VcHeaderButton';
import type { FlowlibFrontendPlugin } from '@flowlib/ui';

// ─────────────────────────────────────────────────────────────────────
// Version Control Frontend Plugin Definition
// ─────────────────────────────────────────────────────────────────────

export const vcFrontendPlugin: FlowlibFrontendPlugin = {
  id: 'version-control',
  name: 'Version Control',

  // ─── Panel Tabs ───
  panelTabs: [
    {
      context: 'flowEditor',
      label: 'Git Sync',
      icon: GitBranch,
      component: VcSyncPanel,
    },
  ],

  // ─── Header Actions ───
  headerActions: [
    {
      context: 'flowHeader',
      component: VcHeaderButton,
    },
  ],

  // ─── Component Implementations ───
  components: {
    'vc.SyncPanel': VcSyncPanel as unknown as React.ComponentType<Record<string, unknown>>,
    'vc.HeaderButton': VcHeaderButton as unknown as React.ComponentType<Record<string, unknown>>,
  },
};

// ─── Re-export types for frontend consumers ───
export type {
  VcSyncConfig,
  VcSyncHistoryRecord,
  VcFlowSyncStatus,
  VcSyncStatus,
  VcSyncMode,
  VcSyncDirection,
  VcSyncResult,
  ConfigureSyncInput,
  VcFlowDiffLine,
  VcFlowDiffLineKind,
  VcFlowDiffResponse,
} from '../shared/types';

// ─── Re-export hooks ───
export {
  useFlowSyncStatus,
  useFlowSyncHistory,
  useSyncedFlows,
  usePushFlow,
  usePullFlow,
  useForcePushFlow,
  useForcePullFlow,
  usePublishFlow,
  useConfigureSync,
  useDisconnectSync,
  vcQueryKeys,
} from './hooks/useFlowSync';
