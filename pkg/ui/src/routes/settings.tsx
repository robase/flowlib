import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Settings as SettingsIcon, Search, Loader2 } from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { Input } from '../components/ui/input';
import { useDocumentTitle } from '../hooks/use-document-title';
import { useSettings, useSettingsDescriptors } from '../api/settings.api';
import { SettingsNav } from '../components/settings/SettingsNav';
import { SettingsGroupPanel } from '../components/settings/SettingsGroupPanel';
import { SettingsSkeleton } from '../components/settings/SettingsSkeleton';
import { sourceForNamespace } from '../components/settings/utils';
import type { SettingsRecord } from '../api/types';

export interface SettingsPageProps {
  basePath?: string;
}

export const Settings: React.FC<SettingsPageProps> = ({ basePath: _basePath = '/flowlib' }) => {
  useDocumentTitle('settings');
  const { data: groups, isLoading: groupsLoading } = useSettingsDescriptors();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const mutating = useIsMutating();
  const loading = groupsLoading || settingsLoading;

  const descriptors = useMemo(() => groups ?? [], [groups]);
  const recordsByKey = useMemo(() => {
    const map = new Map<string, SettingsRecord>();
    for (const r of settings ?? []) {
      map.set(r.key, r);
    }
    return map;
  }, [settings]);

  const [query, setQuery] = useState('');
  const [activeNamespace, setActiveNamespace] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  // Default the active section to the first group once descriptors load.
  useEffect(() => {
    if (!activeNamespace && descriptors.length > 0) {
      setActiveNamespace(descriptors[0].namespace);
    }
  }, [descriptors, activeNamespace]);

  const q = query.trim().toLowerCase();

  // Namespaces with at least one field matching the current query.
  const matchingNamespaces = useMemo(() => {
    if (!q) {
      return new Set(descriptors.map((g) => g.namespace));
    }
    return new Set(
      descriptors
        .filter((g) =>
          g.fields.some(
            (f) =>
              f.label.toLowerCase().includes(q) ||
              f.key.toLowerCase().includes(q) ||
              f.description?.toLowerCase().includes(q),
          ),
        )
        .map((g) => g.namespace),
    );
  }, [descriptors, q]);

  const navGroups = descriptors.filter((g) => matchingNamespaces.has(g.namespace));
  // When searching, show every matching group; otherwise show only the active one.
  const visibleGroups = q ? navGroups : descriptors.filter((g) => g.namespace === activeNamespace);

  const handleSelect = (namespace: string) => {
    setActiveNamespace(namespace);
    contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const savingIndicator =
    mutating > 0 ? (
      <span className="flex items-center gap-1.5 text-sm text-fl-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    ) : undefined;

  return (
    <PageLayout
      title="Settings"
      subtitle="Runtime configuration for the core app and registered plugins."
      icon={SettingsIcon}
      actions={savingIndicator}
    >
      {loading ? (
        <SettingsSkeleton />
      ) : descriptors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plugins have contributed settings.</p>
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search settings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Search settings"
            />
          </div>

          {/* Body: left sub-nav + content */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              {navGroups.length > 0 ? (
                <SettingsNav
                  groups={navGroups}
                  activeNamespace={activeNamespace}
                  onSelect={handleSelect}
                />
              ) : (
                <p className="px-3 text-sm text-muted-foreground">No matches.</p>
              )}
            </aside>

            <div ref={contentRef} className="min-w-0 scroll-mt-6">
              {visibleGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    No settings match{' '}
                    <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-12">
                  {visibleGroups.map((group) => (
                    <SettingsGroupPanel
                      key={group.namespace}
                      group={group}
                      recordsByKey={recordsByKey}
                      source={sourceForNamespace(group.namespace)}
                      query={query}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
};

export default Settings;
