/**
 * OAuth2 Connect Button Component
 *
 * A button that initiates OAuth2 authorization flow for a specific provider.
 * Opens a popup window for the user to authorize, then handles the callback.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Loader2, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useHandleOAuth2Callback, useStartOAuth2Flow } from '../../api/credentials.api';
import type { OAuth2ProviderDefinition, Credential } from '../../api/types';

export interface OAuth2ConnectButtonProps {
  /** The OAuth2 provider to connect to */
  provider: OAuth2ProviderDefinition;
  /** OAuth2 client ID (from your app's OAuth configuration) */
  clientId: string;
  /** OAuth2 client secret (from your app's OAuth configuration) */
  clientSecret: string;
  /** Redirect URI registered with the OAuth provider */
  redirectUri: string;
  /** Optional: Custom scopes to request (defaults to provider's default scopes) */
  scopes?: string[];
  /** Optional: Custom name for the created credential */
  credentialName?: string;
  /** Called when credential is successfully created */
  onSuccess?: (credential: Credential) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Button variant */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Children to render inside button (defaults to "Connect with {provider.name}") */
  children?: React.ReactNode;
}

type ConnectionStatus = 'idle' | 'connecting' | 'success' | 'error';

export function OAuth2ConnectButton({
  provider,
  clientId,
  clientSecret,
  redirectUri,
  scopes,
  credentialName,
  onSuccess,
  onError,
  variant = 'outline',
  size = 'default',
  className,
  disabled,
  children,
}: OAuth2ConnectButtonProps) {
  const startOAuth2FlowMutation = useStartOAuth2Flow();
  const handleOAuth2CallbackMutation = useHandleOAuth2Callback();
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);

  // Store callback params in refs so we can access them in the message handler
  const callbackParamsRef = useRef({ clientId, clientSecret, redirectUri });
  useEffect(() => {
    callbackParamsRef.current = { clientId, clientSecret, redirectUri };
  }, [clientId, clientSecret, redirectUri]);

  // Store callbacks in refs to avoid stale closures in the message handler
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  // Listen for OAuth callback message from popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) {
        return;
      }

      const { type, code, state, error } = event.data;

      if (type !== 'oauth2_callback') {
        return;
      }

      // Close the popup
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      setPopupWindow(null);

      if (error) {
        setStatus('error');
        setErrorMessage(error);
        onErrorRef.current?.(new Error(error));
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setErrorMessage('Invalid OAuth callback - missing code or state');
        onErrorRef.current?.(new Error('Invalid OAuth callback'));
        return;
      }

      // Exchange code for tokens using the mutation (which invalidates credentials cache)
      try {
        const params = callbackParamsRef.current;
        const credential = await handleOAuth2CallbackMutation.mutateAsync({
          code,
          state,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          redirectUri: params.redirectUri,
        });

        setStatus('success');
        onSuccessRef.current?.(credential);

        // Reset to idle after showing success
        setTimeout(() => setStatus('idle'), 2000);
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to exchange OAuth code';
        setErrorMessage(message);
        onErrorRef.current?.(err instanceof Error ? err : new Error(message));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [popupWindow, handleOAuth2CallbackMutation]);

  // Check if popup was closed without completing
  useEffect(() => {
    if (!popupWindow) {
      return;
    }

    const checkClosed = setInterval(() => {
      if (popupWindow.closed) {
        clearInterval(checkClosed);
        setPopupWindow(null);
        if (status === 'connecting') {
          setStatus('idle');
        }
      }
    }, 500);

    return () => clearInterval(checkClosed);
  }, [popupWindow, status]);

  const handleConnect = useCallback(async () => {
    setStatus('connecting');
    setErrorMessage(null);

    try {
      // Start OAuth flow to get authorization URL
      const result = await startOAuth2FlowMutation.mutateAsync({
        providerId: provider.id,
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        credentialName,
        returnUrl: window.location.href,
      });

      // Open popup window for OAuth
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        result.authorizationUrl,
        `oauth2_${provider.id}`,
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
      );

      if (!popup) {
        throw new Error('Failed to open popup window. Please allow popups for this site.');
      }

      setPopupWindow(popup);
    } catch (err) {
      setStatus('error');
      const message = err instanceof Error ? err.message : 'Failed to start OAuth flow';
      setErrorMessage(message);
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [
    startOAuth2FlowMutation,
    provider.id,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    credentialName,
    onError,
  ]);

  const isDisabled = disabled || status === 'connecting';

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleConnect}
        disabled={isDisabled}
        className={cn(
          'gap-2',
          status === 'success' && 'bg-success/10 border-success/50 text-success',
          status === 'error' && 'bg-destructive/10 border-destructive/50 text-destructive',
          className,
        )}
      >
        {status === 'connecting' && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === 'success' && <CheckCircle2 className="w-4 h-4" />}
        {status === 'error' && <AlertCircle className="w-4 h-4" />}
        {status === 'idle' && <ExternalLink className="w-4 h-4" />}

        {children ??
          (status === 'success'
            ? 'Connected!'
            : status === 'error'
              ? 'Connection Failed'
              : `Connect with ${provider.name}`)}
      </Button>

      {status === 'error' && errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  );
}

/**
 * OAuth2 Callback Handler Component
 *
 * Used by the internal Flowlib route at `<frontendPath>/oauth/callback`.
 * Host apps normally do not need to mount this manually unless they are
 * implementing a custom routing setup outside the built-in Flowlib router.
 * It extracts the code/state from URL and sends it to the parent window.
 */
export function OAuth2CallbackHandler() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    // Send message to parent window
    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'oauth2_callback',
          code,
          state,
          error: error || errorDescription,
        },
        window.location.origin,
      );
    }

    // Close this window after a short delay
    setTimeout(() => window.close(), 100);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Completing authorization...</p>
      </div>
    </div>
  );
}
