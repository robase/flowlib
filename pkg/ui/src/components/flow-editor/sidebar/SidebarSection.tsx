import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { SidebarSection as SidebarSectionDef, SidebarSectionContext } from './types';

interface SidebarSectionProps {
  section: SidebarSectionDef;
  context: SidebarSectionContext;
  expanded: boolean;
  onToggle: () => void;
}

export function SidebarSection({ section, context, expanded, onToggle }: SidebarSectionProps) {
  const Icon = section.icon;
  const headerActions = section.headerActions?.(context);

  return (
    <div
      className={cn(
        'flex flex-col border-b border-border last:border-b-0',
        // Expanded sections share the remaining sidebar height equally
        // (VSCode-style); collapsed sections take only header height.
        expanded ? 'flex-1 min-h-0' : 'shrink-0',
      )}
    >
      <div className="flex items-center w-full px-3 py-2 group shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center flex-1 gap-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              'w-3 h-3 shrink-0 transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          {Icon && <Icon className="w-3.5 h-3.5" />}
          <span className="text-left">{section.title}</span>
        </button>
        {headerActions && (
          <div
            className="flex items-center gap-1 ml-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {headerActions}
          </div>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {section.render(context)}
        </div>
      )}
    </div>
  );
}
