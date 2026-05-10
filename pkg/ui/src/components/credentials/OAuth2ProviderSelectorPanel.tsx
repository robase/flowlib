/**
 * OAuth2 Provider Selector — inline panel.
 *
 * Pure inline content (no Dialog wrapper) — provider list with search, then a
 * Client ID/Secret + Connect form when a provider is picked. Used inside the
 * standalone `OAuth2ProviderSelector` Dialog AND inline inside other modals
 * like `CreateCredentialModal` so OAuth setup can sit alongside manual auth
 * config without nesting dialogs.
 */

import { useState, useMemo, useEffect } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Skeleton } from '../ui/skeleton';
import { useOAuth2Providers } from '../../api/credentials.api';
import { buildOAuthCallbackUri, useFrontendPath } from '../../contexts/FrontendPathContext';
import { ProviderIcon } from '../shared/ProviderIcon';
import { OAuth2ConnectButton } from './OAuth2ConnectButton';
import type { Credential, OAuth2ProviderDefinition } from '../../api/types';

// Match the action-card styling used in the node selector sidebar.
const ROW_BG = 'bg-fl-card hover:bg-muted/30 hover:border-muted-foreground/50';
const ICON_BG = 'bg-muted/40 border-border';

export interface OAuth2ProviderSelectorPanelProps {
  /** Called when a credential is successfully created. */
  onCredentialCreated?: (credential: Credential) => void;
  /** Restrict the visible providers (e.g. `["linear"]`). Empty = all providers. */
  filterProviders?: string[];
  /** Override scopes for the OAuth flow (uses provider defaults if not set). */
  scopes?: string[];
  /** Initial credential name; falls back to the provider's display name. */
  defaultCredentialName?: string;
  /** Optional className applied to the root element. */
  className?: string;
}

export function OAuth2ProviderSelectorPanel({
  onCredentialCreated,
  filterProviders,
  scopes,
  defaultCredentialName,
  className,
}: OAuth2ProviderSelectorPanelProps) {
  const { data: providers, isLoading } = useOAuth2Providers();
  const frontendPath = useFrontendPath();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<OAuth2ProviderDefinition | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialName, setCredentialName] = useState(defaultCredentialName ?? '');

  const availableProviders = useMemo(() => {
    if (!providers) {
      return [];
    }
    if (!filterProviders || filterProviders.length === 0) {
      return providers;
    }
    return providers.filter((p) => filterProviders.includes(p.id));
  }, [providers, filterProviders]);

  const filteredProviders = useMemo(
    () =>
      availableProviders.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [availableProviders, searchQuery],
  );

  // Auto-select when only one provider is available (e.g. when filterProviders narrows to one).
  useEffect(() => {
    if (availableProviders.length === 1 && !selectedProvider) {
      setSelectedProvider(availableProviders[0]);
      setCredentialName(defaultCredentialName ?? availableProviders[0].name);
    }
  }, [availableProviders, selectedProvider, defaultCredentialName]);

  const sortedProviders = useMemo(
    () => [...filteredProviders].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredProviders],
  );

  const handleProviderSelect = (provider: OAuth2ProviderDefinition) => {
    setSelectedProvider(provider);
    setCredentialName(defaultCredentialName ?? provider.name);
  };

  const handleBack = () => {
    setSelectedProvider(null);
    setClientId('');
    setClientSecret('');
    setCredentialName(defaultCredentialName ?? '');
  };

  const handleSuccess = (credential: Credential) => {
    onCredentialCreated?.(credential);
    setSelectedProvider(null);
    setClientId('');
    setClientSecret('');
    setCredentialName(defaultCredentialName ?? '');
  };

  const redirectUri =
    typeof window !== 'undefined'
      ? buildOAuthCallbackUri(window.location.origin, frontendPath)
      : '';

  if (isLoading) {
    return (
      <div className={cn('flex flex-col min-h-0', className)}>
        <div className="pt-2 pb-3">
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-4 pb-4">
          {Array.from({ length: 2 }).map((_, groupIdx) => (
            <div key={groupIdx}>
              <Skeleton className="h-3 w-20 mb-2" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-center w-full gap-3 p-3 border rounded-lg"
                  >
                    <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Skeleton className="h-5 w-20 rounded-full shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selectedProvider) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-fl-card border">
          <div
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-lg border shrink-0',
              ICON_BG,
            )}
          >
            <ProviderIcon
              providerId={selectedProvider.id}
              icon={selectedProvider.icon}
              className="w-5 h-5"
            />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{selectedProvider.name}</p>
            <p className="text-xs text-muted-foreground truncate">{selectedProvider.description}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oauth-credential-name" className="text-xs">
              Credential Name
            </Label>
            <Input
              id="oauth-credential-name"
              value={credentialName}
              onChange={(e) => setCredentialName(e.target.value)}
              placeholder={selectedProvider.name}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth-client-id" className="text-xs">
              Client ID *
            </Label>
            <Input
              id="oauth-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter OAuth2 Client ID"
              className="h-8 text-xs"
              autoComplete="one-time-code"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth-client-secret" className="text-xs">
              Client Secret *
            </Label>
            <Input
              id="oauth-client-secret"
              type="text"
              style={{ WebkitTextSecurity: 'disc' }}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter OAuth2 Client Secret"
              className="h-8 text-xs"
              autoComplete="one-time-code"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>

          <div className="p-2 text-xs rounded-lg bg-muted/50">
            <p className="font-medium mb-1">Redirect URI</p>
            <code className="block p-1.5 rounded bg-background text-xs font-mono break-all">
              {redirectUri}
            </code>
            <p className="mt-1 text-xs text-muted-foreground">
              Add this URL to your OAuth app's allowed redirect URIs
            </p>
          </div>

          {selectedProvider.docsUrl && (
            <a
              href={selectedProvider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              View setup documentation
            </a>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          {availableProviders.length !== 1 && (
            <Button variant="outline" onClick={handleBack} className="flex-1 h-8 text-xs">
              Back
            </Button>
          )}
          <OAuth2ConnectButton
            provider={selectedProvider}
            clientId={clientId}
            clientSecret={clientSecret}
            redirectUri={redirectUri}
            scopes={scopes}
            credentialName={credentialName}
            onSuccess={handleSuccess}
            disabled={!clientId || !clientSecret}
            className="flex-1 h-8 text-xs"
            variant="default"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div className="pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          <input
            type="text"
            placeholder="Search providers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 max-h-[50vh] min-w-0">
        <div className="flex flex-col gap-2 pb-4 min-w-0">
          {sortedProviders.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleProviderSelect(provider)}
              className={cn(
                'flex items-center w-full min-w-0 max-w-full gap-2.5 p-2.5 text-left transition-colors border rounded-lg overflow-hidden',
                ROW_BG,
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                  ICON_BG,
                )}
              >
                <ProviderIcon providerId={provider.id} icon={provider.icon} className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="text-sm font-medium truncate">{provider.name}</p>
                <p className="text-xs text-muted-foreground truncate">{provider.description}</p>
              </div>
            </button>
          ))}

          {sortedProviders.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <p className="text-sm">No providers found</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
