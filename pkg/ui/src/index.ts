// Main component exports
export { Flowlib } from './Flowlib';
export { FlowlibShell } from './FlowlibShell';
export { FlowlibLoader } from './components/shared/FlowlibLoader';
export { FlowlibLogo } from './components/shared/FlowlibLogo';

// Export types for better TypeScript support
export type { FlowlibProps, FlowlibConfig } from './Flowlib';
export type { FlowlibShellProps } from './FlowlibShell';
export type { FlowlibLoaderProps } from './components/shared/FlowlibLoader';
export type { FlowlibLogoProps } from './components/shared/FlowlibLogo';

// Plugin system types
export type {
  FlowlibFrontendPlugin,
  FlowlibPluginDefinition,
  PluginSidebarContribution,
  PluginRouteContribution,
  PluginPanelTabContribution,
  PluginHeaderActionContribution,
  PanelTabProps,
  HeaderActionProps,
  PermissionContext,
} from './types/plugin.types';
export { resolvePlugins } from './types/plugin.types';
export { usePluginRegistry } from './contexts/PluginRegistryContext';
export type { PluginRegistry } from './contexts/PluginRegistryContext';

// Export API context for advanced usage
export { ApiProvider, useApiClient, useApiBaseURL } from './contexts/ApiContext';
export type { ApiProviderProps } from './contexts/ApiContext';

// OAuth2 callback handler - exported for advanced/custom routing setups
export { OAuth2CallbackHandler } from './components/credentials/OAuth2ConnectButton';

// Frontend path helpers — used by plugins that need to build links into
// the host's routes. `useFrontendPath()` returns the (already-normalized)
// basePath; `buildFrontendRoute(basePath, '/foo')` is the safe way to
// build a path for `<Link to>` etc. without producing protocol-relative
// `//foo` URLs when the host is mounted at the origin root.
export {
  useFrontendPath,
  buildFrontendRoute,
  buildOAuthCallbackUri,
} from './contexts/FrontendPathContext';

// Flow editor shell
export { FlowEditor } from './components/flow-editor/FlowEditor';

// Standard page layout for non-editor pages
export { PageLayout } from './components/PageLayout';
export type { PageLayoutProps } from './components/PageLayout';

// Zustand stores for state management
export * from './stores';

// React Query + Zustand hooks
export * from './api';

// UI primitives
export { Skeleton } from './components/ui/skeleton';
export { TreeView, type TreeDataItem, type TreeRenderItemParams } from './components/ui/tree-view';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
