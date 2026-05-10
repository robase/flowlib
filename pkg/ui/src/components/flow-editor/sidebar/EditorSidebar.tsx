import React, { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../ui/button';
import { SidebarSection } from './SidebarSection';
import { useUIStore } from '~/stores/uiStore';
import type { SidebarSection as SidebarSectionDef, SidebarSectionContext } from './types';

export interface EditorSidebarProps {
  flowId: string;
  basePath?: string;
  sections: SidebarSectionDef[];
  onCollapse?: () => void;
}

export function EditorSidebar({ flowId, basePath, sections, onCollapse }: EditorSidebarProps) {
  // Section expand/collapse state is persisted in `useUIStore`'s
  // `editorSidebarExpandedSections` (zustand persist middleware → localStorage
  // under `flowlib-ui`). Same persistence story as the rest of the UI store.
  const expandedSections = useUIStore((s) => s.editorSidebarExpandedSections);
  const toggleSection = useUIStore((s) => s.toggleEditorSidebarSection);

  const context = useMemo<SidebarSectionContext>(() => ({ flowId, basePath }), [flowId, basePath]);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden border-r w-96 border-border bg-fl-background text-card-foreground">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-card-foreground">Editor</h2>
        {onCollapse && (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 w-7 h-7 text-muted-foreground hover:text-foreground"
            onClick={onCollapse}
            title="Collapse sidebar"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {sections.map((section) => (
          <SidebarSection
            key={section.id}
            section={section}
            context={context}
            expanded={expandedSections.includes(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}
      </div>
    </div>
  );
}
