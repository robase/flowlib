/**
 * InspectorRail — the horizontal icon rail fixed to the top-right of the
 * workspace. Each icon toggles a section of the slide-out inspector;
 * clicking the active tab again closes the panel.
 */
import * as React from 'react';
import { cn } from '../lib/cn';
import { INSPECTOR_TABS, type TabId } from './inspector/InspectorPane';

export interface InspectorRailProps {
  open: boolean;
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

export function InspectorRail({
  open,
  activeTab,
  onSelect,
}: InspectorRailProps): React.ReactElement {
  return (
    <nav
      aria-label="Workspace inspector sections"
      className="flex flex-row items-center gap-3"
      data-testid="agents-inspector-rail"
    >
      {INSPECTOR_TABS.map((t) => {
        const isActive = open && t.id === activeTab;
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={isActive}
            onClick={() => onSelect(t.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid={`agents-inspector-tab-${t.id}`}
          >
            <t.icon className="h-[18px] w-[18px]" />
          </button>
        );
      })}
    </nav>
  );
}
