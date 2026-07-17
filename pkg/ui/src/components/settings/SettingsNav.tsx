import React from 'react';
import { cn } from '../../lib/utils';
import { isCoreNamespace } from './utils';
import type { SettingsDescriptorGroup } from '../../api/types';

interface SettingsNavProps {
  groups: SettingsDescriptorGroup[];
  activeNamespace: string;
  onSelect: (namespace: string) => void;
}

export const SettingsNav: React.FC<SettingsNavProps> = ({ groups, activeNamespace, onSelect }) => {
  const core = groups.filter((g) => isCoreNamespace(g.namespace));
  const plugins = groups.filter((g) => !isCoreNamespace(g.namespace));

  return (
    <nav className="space-y-6" aria-label="Settings sections">
      {core.length > 0 && (
        <NavSection
          label="Core"
          groups={core}
          activeNamespace={activeNamespace}
          onSelect={onSelect}
        />
      )}
      {plugins.length > 0 && (
        <NavSection
          label="Plugins"
          groups={plugins}
          activeNamespace={activeNamespace}
          onSelect={onSelect}
        />
      )}
    </nav>
  );
};

const NavSection: React.FC<{
  label: string;
  groups: SettingsDescriptorGroup[];
  activeNamespace: string;
  onSelect: (namespace: string) => void;
}> = ({ label, groups, activeNamespace, onSelect }) => {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {groups.map((group) => {
        const active = group.namespace === activeNamespace;
        return (
          <button
            key={group.namespace}
            type="button"
            onClick={() => onSelect(group.namespace)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className="truncate">{group.label}</span>
            <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground/70">
              {group.fields.length}
            </span>
          </button>
        );
      })}
    </div>
  );
};
