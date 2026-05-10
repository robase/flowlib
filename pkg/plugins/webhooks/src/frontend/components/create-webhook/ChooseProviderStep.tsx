/**
 * Step 0 of the create-webhook flow.
 *
 * Tiles for "Manual" (generic) and one tile per registered provider adapter
 * (Linear, …). Clicking a tile branches into either the existing manual form
 * or the provider-config flow.
 */

import { type FC } from 'react';
import { Loader2, Webhook } from 'lucide-react';
import { useWebhookProviders } from '../../hooks/useWebhookQueries';
import type { WebhookProviderSummary } from '../../../shared/types';

interface ChooseProviderStepProps {
  onSelect: (
    mode: { kind: 'manual' } | { kind: 'provider'; provider: WebhookProviderSummary },
  ) => void;
}

export const ChooseProviderStep: FC<ChooseProviderStepProps> = ({ onSelect }) => {
  const { data: providers, isLoading } = useWebhookProviders();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick how this webhook is configured. Provider integrations create the webhook subscription
        on your behalf using a connected credential.
      </p>

      <div className="grid grid-cols-1 gap-2">
        {/* Manual */}
        <button
          type="button"
          onClick={() => onSelect({ kind: 'manual' })}
          className="flex items-start gap-3 p-3 text-left transition-colors border rounded-lg hover:bg-accent border-border"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
            <Webhook className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Manual</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Create a generic endpoint. Copy the URL into your external service yourself.
            </p>
          </div>
        </button>

        {/* Providers */}
        {isLoading && (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            Loading providers…
          </div>
        )}

        {providers?.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect({ kind: 'provider', provider })}
            className="flex items-start gap-3 p-3 text-left transition-colors border rounded-lg hover:bg-accent border-border"
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
              <ProviderInitial id={provider.id} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{provider.displayName}</span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  Auto-configure
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Register the webhook with {provider.displayName} using a connected credential.
                {provider.requiredScopes?.length
                  ? ` Requires ${provider.requiredScopes.join(', ')} scope.`
                  : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const ProviderInitial: FC<{ id: string }> = ({ id }) => (
  <span className="text-sm font-semibold uppercase">{id.charAt(0)}</span>
);
