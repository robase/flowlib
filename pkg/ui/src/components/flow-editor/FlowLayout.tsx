import type React from 'react';
import { FlowBottomToolbar } from './FlowBottomToolbar';
import { ToolbarCollapsedProvider } from './toolbar-context';
import { TooltipProvider } from '../ui/tooltip';
import { useDelayedUnmount } from '../../hooks/use-delayed-unmount';

interface FlowLayoutProps {
  sidebar: React.ReactNode;
  viewport: React.ReactNode;
  layoutSelector?: React.ReactNode;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  /** Panel that appears on the right side (e.g. tool config, node config) */
  rightPanel?: React.ReactNode;
  /** Chat toggle button rendered in the floating top-right toolbar */
  chatToggle?: React.ReactNode;
  /** View-code toggle button rendered in the floating top-right toolbar */
  viewCodeToggle?: React.ReactNode;
  /** Chat panel rendered as a right sidebar */
  chatPanel?: React.ReactNode;
  /** Code panel rendered as a right sidebar */
  codePanel?: React.ReactNode;
  /** Floating chat overlay rendered above the viewport (for empty flows) */
  chatOverlay?: React.ReactNode;
  /** Extra controls rendered in the bottom toolbar (e.g. Run button, Active/Inactive) */
  toolbarExtra?: React.ReactNode;
  /** Whether the sidebar is open */
  sidebarOpen?: boolean;
  /** Called to toggle sidebar visibility */
  onToggleSidebar?: () => void;
  /**
   * Suppress the floating bottom toolbar rendered by the layout. Callers that
   * need to anchor the toolbar inside their own viewport container (e.g. the
   * runs view, which splits its viewport with a resize divider) can render
   * their own `FlowBottomToolbar` and set this to true.
   */
  hideToolbar?: boolean;
}

export function FlowLayout({
  sidebar,
  viewport,
  layoutSelector,
  viewportRef,
  rightPanel,
  chatToggle,
  viewCodeToggle,
  chatPanel,
  codePanel,
  chatOverlay,
  toolbarExtra,
  sidebarOpen = true,
  onToggleSidebar,
  hideToolbar = false,
}: FlowLayoutProps) {
  const hasFloatingToolbar = Boolean(chatToggle || viewCodeToggle);
  const { shouldRender: shouldRenderSidebar, isVisible: sidebarVisible } = useDelayedUnmount(
    sidebarOpen,
    200,
  );

  return (
    <div className="flex flex-1 min-h-0">
      {shouldRenderSidebar && (
        <div
          className="flex shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
          style={{ width: sidebarVisible ? '24rem' : 0, opacity: sidebarVisible ? 1 : 0 }}
        >
          {sidebar}
        </div>
      )}
      <div
        className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
        ref={viewportRef as React.RefObject<HTMLDivElement>}
      >
        {/* Floating top-right toolbar (chat + view code) */}
        {hasFloatingToolbar && (
          <TooltipProvider>
            <ToolbarCollapsedProvider value={true}>
              <div className="absolute top-4 right-4 z-10 flex flex-col items-center gap-1.5 rounded-xl border border-foreground/15 bg-card/90 backdrop-blur-sm shadow-md p-1.5 [&>button]:size-8 [&>button]:p-0 [&>button]:gap-0">
                {chatToggle}
                {viewCodeToggle}
              </div>
            </ToolbarCollapsedProvider>
          </TooltipProvider>
        )}

        {viewport}
        {chatOverlay}

        {!hideToolbar && (
          <FlowBottomToolbar
            layoutSelector={layoutSelector}
            toolbarExtra={toolbarExtra}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={onToggleSidebar}
          />
        )}
      </div>
      {rightPanel}
      {chatPanel}
      {codePanel}
    </div>
  );
}

export default FlowLayout;
