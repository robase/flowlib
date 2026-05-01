/**
 * Minimal tab strip — pure CSS underline indicator on the active tab.
 */

import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface TabItem<TKey extends string> {
  key: TKey;
  label: string;
}

export interface TabsProps<TKey extends string> {
  tabs: ReadonlyArray<TabItem<TKey>>;
  active: TKey;
  onChange: (key: TKey) => void;
  className?: string;
}

export function Tabs<TKey extends string>({ tabs, active, onChange, className }: TabsProps<TKey>) {
  return (
    <div role="tablist" className={cn('flex items-center gap-2 border-b border-border', className)}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  active: boolean;
  children: ReactNode;
}

export function TabPanel({ active, children }: TabPanelProps) {
  if (!active) {
    return null;
  }
  return <div role="tabpanel">{children}</div>;
}
