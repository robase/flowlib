/**
 * OAuth2 Provider Selector Component
 *
 * Shows available OAuth2 providers grouped by category with connect buttons.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  ExternalLink,
  FileText,
  HardDrive,
  Mail,
  Calendar,
  Github,
  MessageSquare,
  Cloud,
  Table,
  CheckSquare,
  Bug,
  Search,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOAuth2Providers } from '../../api/credentials.api';
import { buildOAuthCallbackUri, useFrontendPath } from '../../contexts/FrontendPathContext';
import { OAuth2ConnectButton } from './OAuth2ConnectButton';
import type { OAuth2ProviderDefinition, Credential } from '../../api/types';
import { FlowlibLoader } from '../shared/FlowlibLoader';

// Icon mapping for providers
const providerIcons: Record<string, React.ElementType> = {
  FileText,
  HardDrive,
  Mail,
  Calendar,
  Github,
  MessageSquare,
  Cloud,
  Table,
  CheckSquare,
  Bug,
  Sheet: Table,
};

// Category labels and colors
const categoryConfig: Record<string, { label: string; color: string }> = {
  google: { label: 'Google', color: 'bg-info/15 text-info border-info/30' },
  microsoft: { label: 'Microsoft', color: 'bg-info/15 text-info border-info/30' },
  github: { label: 'GitHub', color: 'bg-muted text-muted-foreground border-border' },
  slack: { label: 'Slack', color: 'bg-primary/15 text-primary border-primary/30' },
  other: { label: 'Other', color: 'bg-warning/15 text-warning border-warning/30' },
};

interface OAuth2ProviderSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when a credential is successfully created */
  onCredentialCreated?: (credential: Credential) => void;
  /** Portal container for modals */
  portalContainer?: HTMLElement | null;
  /** Filter to only show specific providers by ID (e.g., ["google"]) */
  filterProviders?: string[];
  /** Override scopes for the OAuth flow (uses provider defaults if not set) */
  scopes?: string[];
}

export function OAuth2ProviderSelector({
  open,
  onOpenChange,
  onCredentialCreated,
  portalContainer,
  filterProviders,
  scopes,
}: OAuth2ProviderSelectorProps) {
  const { data: providers, isLoading } = useOAuth2Providers();
  const frontendPath = useFrontendPath();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<OAuth2ProviderDefinition | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialName, setCredentialName] = useState('');

  // Filter providers by the filterProviders prop first, then by search
  const availableProviders = useMemo(() => {
    if (!providers) {
      return [];
    }
    if (!filterProviders || filterProviders.length === 0) {
      return providers;
    }
    return providers.filter((p) => filterProviders.includes(p.id));
  }, [providers, filterProviders]);

  // Further filter by search query
  const filteredProviders = availableProviders.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // If there's only one provider after filtering, auto-select it
  useEffect(() => {
    if (open && availableProviders.length === 1 && !selectedProvider) {
      setSelectedProvider(availableProviders[0]);
      setCredentialName(availableProviders[0].name);
    }
  }, [open, availableProviders, selectedProvider]);

  // Group providers by category
  const providersByCategory = filteredProviders?.reduce(
    (acc, provider) => {
      const category = provider.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(provider);
      return acc;
    },
    {} as Record<string, OAuth2ProviderDefinition[]>,
  );

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedProvider(null);
      setClientId('');
      setClientSecret('');
      setCredentialName('');
      setSearchQuery('');
    }
  }, [open]);

  const handleProviderSelect = (provider: OAuth2ProviderDefinition) => {
    setSelectedProvider(provider);
    setCredentialName(provider.name);
  };

  const handleBack = () => {
    setSelectedProvider(null);
    setClientId('');
    setClientSecret('');
    setCredentialName('');
  };

  const handleSuccess = (credential: Credential) => {
    onCredentialCreated?.(credential);
    onOpenChange(false);
    // Reset state
    setSelectedProvider(null);
    setClientId('');
    setClientSecret('');
    setCredentialName('');
  };

  // Get redirect URI for OAuth callback
  const redirectUri =
    typeof window !== 'undefined'
      ? buildOAuthCallbackUri(window.location.origin, frontendPath)
      : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>
            {selectedProvider ? `Connect ${selectedProvider.name}` : 'Connect OAuth2 Provider'}
          </DialogTitle>
          <DialogDescription>
            {selectedProvider
              ? 'Enter your OAuth2 app credentials to connect'
              : 'Select a service to connect with OAuth2'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <FlowlibLoader iconClassName="h-14" label="Loading providers..." />
          </div>
        ) : selectedProvider ? (
          // Configuration form for selected provider
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {providerIcons[selectedProvider.icon || 'FileText'] &&
                React.createElement(providerIcons[selectedProvider.icon || 'FileText'], {
                  className: 'w-6 h-6',
                })}
              <div>
                <p className="font-medium">{selectedProvider.name}</p>
                <p className="text-xs text-muted-foreground">{selectedProvider.description}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="credentialName" className="text-xs">
                  Credential Name
                </Label>
                <Input
                  id="credentialName"
                  value={credentialName}
                  onChange={(e) => setCredentialName(e.target.value)}
                  placeholder="My Google Docs"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clientId" className="text-xs">
                  Client ID *
                </Label>
                <Input
                  id="clientId"
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
                <Label htmlFor="clientSecret" className="text-xs">
                  Client Secret *
                </Label>
                <Input
                  id="clientSecret"
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
              <Button variant="outline" onClick={handleBack} className="flex-1 h-8 text-xs">
                Back
              </Button>
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
        ) : (
          // Provider selection list
          <div className="flex flex-col min-h-0 -mx-6">
            {/* Search */}
            <div className="px-6 pb-3">
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

            {/* Provider list */}
            <ScrollArea className="flex-1 px-6">
              <div className="space-y-4 pb-4">
                {providersByCategory &&
                  Object.entries(providersByCategory).map(([category, categoryProviders]) => {
                    const config = categoryConfig[category] || categoryConfig.other;
                    return (
                      <div key={category}>
                        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                          {config.label}
                        </h3>
                        <div className="space-y-2">
                          {categoryProviders.map((provider) => {
                            const Icon = providerIcons[provider.icon || 'FileText'] || FileText;
                            return (
                              <button
                                key={provider.id}
                                onClick={() => handleProviderSelect(provider)}
                                className="flex items-center w-full gap-3 p-3 text-left transition-colors border rounded-lg hover:bg-muted/50"
                              >
                                <div
                                  className={cn(
                                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                                    config.color,
                                  )}
                                >
                                  <Icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">{provider.name}</p>
                                  <p className="text-xs truncate text-muted-foreground">
                                    {provider.description}
                                  </p>
                                </div>
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {provider.supportsRefresh ? 'Auto-refresh' : 'Manual'}
                                </Badge>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                {(!filteredProviders || filteredProviders.length === 0) && (
                  <div className="py-8 text-center text-muted-foreground">
                    <p className="text-sm">No providers found</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
