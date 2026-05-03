/**
 * CreateWebhookModal — Dialog for creating a new webhook trigger.
 *
 * Step 1: Name + endpoint settings
 * Step 2: Success screen with URL + secret to copy
 */

import { useState, type FC, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@flowlib/ui';
import { useCreateWebhookTrigger } from '../hooks/useWebhookQueries';
import { CopyableField } from './CopyableField';
import type { CreateWebhookTriggerInput } from '../../shared/types';

// ─── Component ──────────────────────────────────────────────────────

interface CreateWebhookModalProps {
  open: boolean;
  onClose: () => void;
  containerRef?: RefObject<HTMLElement | null>;
  /** Pre-fill flowId + nodeId when creating from flow editor */
  flowId?: string;
  nodeId?: string;
}

export const CreateWebhookModal: FC<CreateWebhookModalProps> = ({
  open,
  onClose,
  containerRef,
  flowId,
  nodeId,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [methods, setMethods] = useState('POST');
  const [hmacEnabled, setHmacEnabled] = useState(false);
  const [hmacHeaderName, setHmacHeaderName] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [allowedIps, setAllowedIps] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const createMutation = useCreateWebhookTrigger();

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }

    const input: CreateWebhookTriggerInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      provider: 'generic',
      allowedMethods: methods,
      hmacEnabled,
      hmacHeaderName: hmacEnabled ? hmacHeaderName.trim() || undefined : undefined,
      hmacSecret: hmacEnabled ? hmacSecret.trim() || undefined : undefined,
      allowedIps: allowedIps.trim() || undefined,
      flowId,
      nodeId,
    };

    try {
      const result = await createMutation.mutateAsync(input);
      const url = result.fullUrl ?? `/plugins/webhooks/receive/${result.webhookPath}`;
      const hasAbsoluteBase = /^https?:\/\//i.test(url);
      const path = hasAbsoluteBase ? url : url.startsWith('/') ? url : `/${url}`;
      setCreatedUrl(hasAbsoluteBase ? url : `<YOUR_FLOWLIB_URL>${path}`);
    } catch {
      // Error handled by mutation state
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setMethods('POST');
    setHmacEnabled(false);
    setHmacHeaderName('');
    setHmacSecret('');
    setAllowedIps('');
    setCreatedUrl(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          handleClose();
        }
      }}
    >
      <DialogContent
        container={containerRef?.current}
        className="max-w-md gap-0 p-0 overflow-hidden"
        showCloseButton
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-base">
              {createdUrl ? 'Webhook Created' : 'Create Webhook'}
            </DialogTitle>
            <DialogDescription>
              {createdUrl
                ? 'Copy the URL below and configure it in your external service.'
                : 'Set up a generic endpoint to receive webhook events from any external system.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          {createdUrl ? (
            /* ── Success ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 text-sm border rounded-lg border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                <Check className="w-4 h-4 shrink-0" />
                Webhook is ready to receive events.
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                  Webhook URL
                </label>
                <CopyableField value={createdUrl} />
              </div>

              <button
                onClick={handleClose}
                className="inline-flex items-center justify-center w-full px-4 text-sm font-medium transition-colors rounded-md h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          ) : (
            /* ── Form ── */
            <>
              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="wh-create-name">
                  Name *
                </label>
                <input
                  id="wh-create-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Partner API Events"
                  autoFocus
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="wh-create-desc">
                  Description
                </label>
                <input
                  id="wh-create-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Authentication</label>
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">HMAC Verification</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Verify requests using an HMAC signature header.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHmacEnabled(!hmacEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        hmacEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                          hmacEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  {hmacEnabled && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium" htmlFor="wh-create-hmac-header">
                          Signature Header Name
                        </label>
                        <input
                          id="wh-create-hmac-header"
                          type="text"
                          autoComplete="off"
                          value={hmacHeaderName}
                          onChange={(e) => setHmacHeaderName(e.target.value)}
                          placeholder="e.g. x-signature"
                          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium" htmlFor="wh-create-hmac-secret">
                          Signing Secret
                        </label>
                        <input
                          id="wh-create-hmac-secret"
                          type="password"
                          autoComplete="new-password"
                          value={hmacSecret}
                          onChange={(e) => setHmacSecret(e.target.value)}
                          placeholder="Enter secret key"
                          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* IP Whitelist */}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="wh-create-ips">
                  IP Whitelist
                </label>
                <input
                  id="wh-create-ips"
                  type="text"
                  value={allowedIps}
                  onChange={(e) => setAllowedIps(e.target.value)}
                  placeholder="e.g. 192.168.1.1, 10.0.0.0/24"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to allow all IPs. Separate multiple addresses with commas.
                </p>
              </div>

              {/* HTTP Methods */}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="wh-create-methods">
                  HTTP Methods
                </label>
                <select
                  id="wh-create-methods"
                  value={methods}
                  onChange={(e) => setMethods(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                >
                  <option value="POST">POST only</option>
                  <option value="POST,PUT">POST + PUT</option>
                  <option value="ANY">Any method</option>
                </select>
              </div>

              {/* Error */}
              {createMutation.isError && (
                <p className="text-sm text-red-500">
                  {createMutation.error?.message || 'Failed to create webhook'}
                </p>
              )}

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center justify-center flex-1 px-3 text-sm font-medium transition-colors border rounded-md shadow-xs h-9 bg-background hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!name.trim() || createMutation.isPending}
                  className="inline-flex items-center justify-center flex-1 px-3 text-sm font-medium transition-colors rounded-md h-9 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating…' : 'Create Webhook'}
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
