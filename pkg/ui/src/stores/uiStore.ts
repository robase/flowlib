import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/shallow';

export type ModalType =
  | 'createFlow'
  | 'createCredential'
  | 'editCredential'
  | 'confirm'
  | 'executeFlow'
  | 'deleteConfirm'
  | null;

export type SidebarTab = 'nodes' | 'settings' | 'history';

interface UIState {
  // Sidebar
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;

  // Modals
  activeModal: ModalType;
  modalData: Record<string, unknown>;

  // Panels
  validationPanelOpen: boolean;
  logsPanelOpen: boolean;
  codePanelOpen: boolean;

  // Node sidebar (for adding nodes)
  nodeSidebarOpen: boolean;
  nodeSidebarExpandedGroups: string[];

  // Editor sidebar — VSCode-style multi-section list (Nodes, Runs, …).
  // Section ids in this set are expanded; absent ids are collapsed.
  // Sections not yet in the set fall back to defaultExpandedSections (initial
  // value) — see initialState for which sections start expanded.
  editorSidebarExpandedSections: string[];

  // Bottom toolbar
  toolbarCollapsed: boolean;
}

interface UIActions {
  // Sidebar
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;

  // Modals
  openModal: (modal: NonNullable<ModalType>, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setModalData: (data: Record<string, unknown>) => void;

  // Panels
  toggleValidationPanel: () => void;
  setValidationPanelOpen: (open: boolean) => void;
  toggleLogsPanel: () => void;
  setLogsPanelOpen: (open: boolean) => void;
  toggleCodePanel: () => void;
  setCodePanelOpen: (open: boolean) => void;

  // Node sidebar
  toggleNodeSidebar: () => void;
  setNodeSidebarOpen: (open: boolean) => void;
  toggleNodeSidebarGroup: (groupId: string) => void;
  setNodeSidebarExpandedGroups: (groups: string[]) => void;

  // Editor sidebar sections
  toggleEditorSidebarSection: (sectionId: string) => void;

  // Bottom toolbar
  toggleToolbarCollapsed: () => void;

  // Reset
  reset: () => void;
}

export type UIStore = UIState & UIActions;

const initialState: UIState = {
  sidebarCollapsed: false,
  activeSidebarTab: 'nodes',
  activeModal: null,
  modalData: {},
  validationPanelOpen: false,
  logsPanelOpen: false,
  codePanelOpen: false,
  nodeSidebarOpen: true,
  nodeSidebarExpandedGroups: ['core'],
  editorSidebarExpandedSections: ['nodes', 'runs'],
  toolbarCollapsed: false,
};

export const useUIStore: UseBoundStore<StoreApi<UIStore>> = create<UIStore>()(
  devtools(
    persist(
      immer((set) => ({
        ...initialState,

        // Sidebar
        toggleSidebar: () =>
          set((state) => {
            state.sidebarCollapsed = !state.sidebarCollapsed;
          }),

        setSidebarCollapsed: (collapsed) =>
          set((state) => {
            state.sidebarCollapsed = collapsed;
          }),

        setSidebarTab: (tab) =>
          set((state) => {
            state.activeSidebarTab = tab;
          }),

        // Modals
        openModal: (modal, data = {}) =>
          set((state) => {
            state.activeModal = modal;
            state.modalData = data;
          }),

        closeModal: () =>
          set((state) => {
            state.activeModal = null;
            state.modalData = {};
          }),

        setModalData: (data) =>
          set((state) => {
            state.modalData = { ...state.modalData, ...data };
          }),

        // Panels
        toggleValidationPanel: () =>
          set((state) => {
            state.validationPanelOpen = !state.validationPanelOpen;
          }),

        setValidationPanelOpen: (open) =>
          set((state) => {
            state.validationPanelOpen = open;
          }),

        toggleLogsPanel: () =>
          set((state) => {
            state.logsPanelOpen = !state.logsPanelOpen;
          }),

        setLogsPanelOpen: (open) =>
          set((state) => {
            state.logsPanelOpen = open;
          }),

        toggleCodePanel: () =>
          set((state) => {
            state.codePanelOpen = !state.codePanelOpen;
          }),

        setCodePanelOpen: (open) =>
          set((state) => {
            state.codePanelOpen = open;
          }),

        // Node sidebar
        toggleNodeSidebar: () =>
          set((state) => {
            state.nodeSidebarOpen = !state.nodeSidebarOpen;
          }),

        setNodeSidebarOpen: (open) =>
          set((state) => {
            state.nodeSidebarOpen = open;
          }),

        toggleNodeSidebarGroup: (groupId) =>
          set((state) => {
            if (state.nodeSidebarExpandedGroups.includes(groupId)) {
              state.nodeSidebarExpandedGroups = state.nodeSidebarExpandedGroups.filter(
                (existingGroupId) => existingGroupId !== groupId,
              );
              return;
            }

            state.nodeSidebarExpandedGroups = [...state.nodeSidebarExpandedGroups, groupId];
          }),

        setNodeSidebarExpandedGroups: (groups) =>
          set((state) => {
            state.nodeSidebarExpandedGroups = groups;
          }),

        // Editor sidebar sections
        toggleEditorSidebarSection: (sectionId) =>
          set((state) => {
            if (state.editorSidebarExpandedSections.includes(sectionId)) {
              state.editorSidebarExpandedSections = state.editorSidebarExpandedSections.filter(
                (id) => id !== sectionId,
              );
              return;
            }
            state.editorSidebarExpandedSections = [
              ...state.editorSidebarExpandedSections,
              sectionId,
            ];
          }),

        // Bottom toolbar
        toggleToolbarCollapsed: () =>
          set((state) => {
            state.toolbarCollapsed = !state.toolbarCollapsed;
          }),

        // Reset
        reset: () => set(() => ({ ...initialState })),
      })),
      {
        name: 'flowlib-ui',
        // Only persist certain fields
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          activeSidebarTab: state.activeSidebarTab,
          nodeSidebarOpen: state.nodeSidebarOpen,
          nodeSidebarExpandedGroups: state.nodeSidebarExpandedGroups,
          editorSidebarExpandedSections: state.editorSidebarExpandedSections,
          toolbarCollapsed: state.toolbarCollapsed,
        }),
      },
    ),
    { name: 'ui' },
  ),
);

// Selector hooks
export const useSidebarCollapsed = () => useUIStore((s) => s.sidebarCollapsed);
export const useActiveSidebarTab = () => useUIStore((s) => s.activeSidebarTab);
export const useActiveModal = () => useUIStore((s) => s.activeModal);
export const useModalData = () => useUIStore((s) => s.modalData);
export const useValidationPanelOpen = () => useUIStore((s) => s.validationPanelOpen);
export const useLogsPanelOpen = () => useUIStore((s) => s.logsPanelOpen);
export const useNodeSidebarOpen = () => useUIStore((s) => s.nodeSidebarOpen);
export const useNodeSidebarExpandedGroups = () => useUIStore((s) => s.nodeSidebarExpandedGroups);

// Combined selectors
export const useModals = () =>
  useUIStore(
    useShallow((s) => ({
      activeModal: s.activeModal,
      modalData: s.modalData,
      openModal: s.openModal,
      closeModal: s.closeModal,
    })),
  );
