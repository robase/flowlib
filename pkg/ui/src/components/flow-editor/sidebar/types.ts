import type { ComponentType, ReactNode } from 'react';

export interface SidebarSectionContext {
  flowId: string;
  basePath?: string;
}

export interface SidebarSection {
  id: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;
  render: (ctx: SidebarSectionContext) => ReactNode;
  headerActions?: (ctx: SidebarSectionContext) => ReactNode;
}
