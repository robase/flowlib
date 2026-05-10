/**
 * OAuth2 Provider Selector — Dialog wrapper.
 *
 * Thin Dialog around `OAuth2ProviderSelectorPanel`. Existing call-sites
 * (Agent / Tool config panels) keep using this. The standalone panel lives
 * in `./OAuth2ProviderSelectorPanel.tsx` and is reused by the Create
 * Credential modal so OAuth setup sits alongside manual auth without
 * nesting dialogs.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { OAuth2ProviderSelectorPanel } from './OAuth2ProviderSelectorPanel';
import type { Credential } from '../../api/types';

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
  // Force a fresh panel on each open so internal state (selected provider,
  // search query, client id/secret) resets predictably.
  const [openCount, setOpenCount] = useState(0);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpenCount((c) => c + 1);
    }
    onOpenChange(next);
  };

  const handleCredentialCreated = (credential: Credential) => {
    onCredentialCreated?.(credential);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        container={portalContainer}
        // `flex flex-col` overrides the default `grid` layout so width
        // constraints flow predictably down to the panel — important
        // because the provider list contains long-description cards.
        className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>Connect OAuth2 Provider</DialogTitle>
          <DialogDescription>
            {filterProviders?.length === 1
              ? `Connect a ${filterProviders[0]} credential`
              : 'Select a service to connect with OAuth2'}
          </DialogDescription>
        </DialogHeader>

        <OAuth2ProviderSelectorPanel
          key={openCount}
          onCredentialCreated={handleCredentialCreated}
          filterProviders={filterProviders}
          scopes={scopes}
        />
      </DialogContent>
    </Dialog>
  );
}
