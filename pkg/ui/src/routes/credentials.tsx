import React, { useState, useRef, useMemo } from 'react';
import { PageLayout } from '../components/PageLayout';
import { Link } from 'react-router';
import { Plus, Shield, Clock, AlertCircle, Search, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import type { Credential, CreateCredentialInput } from '../api/types';
import { useDocumentTitle } from '../hooks/use-document-title';
import { CreateCredentialModal } from '../components/credentials/CreateCredentialModal';
import { CredentialDetailDialog } from '../components/credentials/CredentialDetailDialog';
import { ProviderIcon } from '../components/shared/ProviderIcon';
import { getCredentialBranding, getCredentialProviderLabel } from '../utils/credentialBranding';
import {
  AUTH_TYPE_CONFIG,
  formatDate,
  formatFullDate,
  isTokenExpired,
} from '../components/credentials/credential-utils';
import {
  useCredentials,
  useCreateCredential,
  useUpdateCredential,
  useDeleteCredential,
  useTestCredential,
} from '../api/credentials.api';

export interface CredentialsProps {
  basePath?: string;
}

export const Credentials: React.FC<CredentialsProps> = ({ basePath: _basePath = '/flowlib' }) => {
  useDocumentTitle('credentials');
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [deletingCredential, setDeletingCredential] = useState<Credential | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAuthType, setFilterAuthType] = useState<string>('all');

  // Queries
  const { data: credentials = [], isLoading, error } = useCredentials({ includeShared: true });
  const createCredentialMutation = useCreateCredential();
  const updateCredentialMutation = useUpdateCredential();
  const deleteCredentialMutation = useDeleteCredential();
  const testCredentialMutation = useTestCredential();

  // Derived
  const authTypes = useMemo(() => {
    const types = new Set(credentials.map((c) => c.authType));
    return Array.from(types).sort();
  }, [credentials]);

  const filteredCredentials = useMemo(() => {
    let result = credentials;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.authType.toLowerCase().includes(q) ||
          c.config?.oauth2Provider?.toLowerCase().includes(q),
      );
    }
    if (filterAuthType !== 'all') {
      result = result.filter((c) => c.authType === filterAuthType);
    }
    return result;
  }, [credentials, searchQuery, filterAuthType]);

  const openDetail = (credential: Credential) => {
    setSelectedCredential(credential);
    setTestResult(null);
  };

  const closeDetail = () => {
    setSelectedCredential(null);
    setTestResult(null);
  };

  const handleTest = (id: string) => {
    setTestingId(id);
    setTestResult(null);
    testCredentialMutation.mutate(id, {
      onSuccess: (result) => {
        setTestingId(null);
        setTestResult(result);
      },
      onError: (mutationError) => {
        setTestingId(null);
        const message = mutationError instanceof Error ? mutationError.message : 'Unknown error';
        setTestResult({ success: false, error: message });
      },
    });
  };

  return (
    <PageLayout
      ref={containerRef}
      title="Credentials"
      subtitle="Manage API keys, OAuth connections, and database credentials for your integrations."
      actions={
        <>
          <Link
            to={_basePath || '/'}
            className="inline-flex items-center px-3 py-1.5 text-sm text-muted-foreground bg-card border border-border rounded-md hover:bg-muted transition-colors"
          >
            ← Back
          </Link>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Credential
          </Button>
        </>
      }
    >
      {/* Search & Filters */}
      {credentials.length > 0 && (
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            <input
              type="text"
              placeholder="Search credentials…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterAuthType('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                filterAuthType === 'all'
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
              }`}
            >
              All ({credentials.length})
            </button>
            {authTypes.map((type) => {
              const config = AUTH_TYPE_CONFIG[type];
              const count = credentials.filter((c) => c.authType === type).length;
              return (
                <button
                  key={type}
                  onClick={() => setFilterAuthType(filterAuthType === type ? 'all' : type)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    filterAuthType === type
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
                  }`}
                >
                  {config?.label ?? type} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <TooltipProvider>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 mb-3 text-muted-foreground animate-spin" />
            <p className="text-sm text-muted-foreground">Loading credentials...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="w-12 h-12 mb-3 text-destructive" />
            <p className="text-sm text-destructive">
              Error loading credentials: {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : credentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-xl border-border">
            <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
              <Shield className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold text-foreground">No credentials yet</h3>
            <p className="max-w-sm mb-6 text-sm text-center text-muted-foreground">
              Add API keys, connect OAuth providers, or configure database credentials to power your
              workflows.
            </p>
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Credential
            </Button>
          </div>
        ) : filteredCredentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Search className="w-10 h-10 mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No credentials match your search.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card divide-y divide-border">
            {filteredCredentials.map((credential) => {
              const iconInfo = getCredentialBranding(credential);
              const providerLabel = getCredentialProviderLabel(credential);
              const authConfig = AUTH_TYPE_CONFIG[credential.authType];
              const expired = isTokenExpired(credential);

              return (
                <button
                  key={credential.id}
                  type="button"
                  onClick={() => openDetail(credential)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  {/* Icon */}
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted/60 shrink-0">
                    <ProviderIcon
                      providerId={iconInfo.providerId}
                      icon={iconInfo.icon}
                      className="w-5 h-5"
                    />
                  </div>

                  {/* Name + provider */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {credential.name}
                      </span>
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          expired
                            ? 'bg-warning'
                            : credential.isActive
                              ? 'bg-success'
                              : 'bg-muted-foreground/40'
                        }`}
                      />
                      {expired && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 font-medium leading-4 bg-warning-muted text-warning"
                        >
                          Expired
                        </Badge>
                      )}
                    </div>
                    {providerLabel && (
                      <p className="text-xs text-muted-foreground truncate">{providerLabel}</p>
                    )}
                  </div>

                  {/* Auth badge */}
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 font-medium leading-5 shrink-0 ${authConfig?.color ?? 'bg-muted text-muted-foreground'}`}
                  >
                    {authConfig?.label ?? credential.authType}
                  </Badge>

                  {/* Last used */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground shrink-0 w-20 justify-end">
                        <Clock className="w-3 h-3" />
                        {formatDate(credential.lastUsedAt)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Last used: {formatFullDate(credential.lastUsedAt)}
                    </TooltipContent>
                  </Tooltip>

                  <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </TooltipProvider>

      {/* Detail Dialog */}
      <CredentialDetailDialog
        credential={selectedCredential}
        onClose={closeDetail}
        onDelete={(c) => setDeletingCredential(c)}
        onTest={handleTest}
        testingId={testingId}
        testResult={testResult}
        onUpdate={(id, data) => updateCredentialMutation.mutate({ id, data })}
        isUpdating={updateCredentialMutation.isPending}
        portalContainer={containerRef.current}
      />

      {/* Create modal */}
      <CreateCredentialModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={(data: CreateCredentialInput) =>
          createCredentialMutation.mutate(data, {
            onSuccess: () => setCreateModalOpen(false),
          })
        }
        isLoading={createCredentialMutation.isPending}
        portalContainer={containerRef.current}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingCredential}
        onOpenChange={(open) => !open && setDeletingCredential(null)}
      >
        <AlertDialogContent container={containerRef.current}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingCredential?.name}"? This action cannot be
              undone and may break workflows that use this credential.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingCredential(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deletingCredential) {
                  deleteCredentialMutation.mutate(deletingCredential.id, {
                    onSuccess: () => {
                      setDeletingCredential(null);
                      if (selectedCredential?.id === deletingCredential.id) {
                        closeDetail();
                      }
                    },
                    onError: () => setDeletingCredential(null),
                  });
                }
              }}
              disabled={deleteCredentialMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteCredentialMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
};
