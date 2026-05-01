/**
 * SocialAuthButtons — sign-in/up via configured better-auth socialProviders.
 *
 * Calls `authClient.signIn.social({ provider, callbackURL })` which redirects
 * the browser to the provider's OAuth endpoint. The provider must be
 * configured server-side via `betterAuthOptions.socialProviders`; clicking a
 * button for an unconfigured provider returns a clear error from better-auth.
 */

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useSignInSocial } from '../../hooks';
import { cn } from '../../lib/utils';

export type SocialProviderId = 'google' | 'github';

interface ProviderConfig {
  id: SocialProviderId;
  label: string;
  Icon: () => ReactNode;
  className: string;
}

const PROVIDERS: Record<SocialProviderId, ProviderConfig> = {
  google: {
    id: 'google',
    label: 'Continue with Google',
    Icon: GoogleIcon,
    className:
      'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
  },
  github: {
    id: 'github',
    label: 'Continue with GitHub',
    Icon: GitHubIcon,
    className: 'bg-[#1f2328] text-white hover:bg-[#1f2328]/90 dark:bg-[#0d1117]',
  },
};

export interface SocialAuthButtonsProps {
  /** Which providers to show. @default ['google', 'github'] */
  providers?: ReadonlyArray<SocialProviderId>;
  /** Where to redirect after a successful OAuth round-trip. */
  callbackURL?: string;
}

export function SocialAuthButtons({
  providers = ['google', 'github'],
  callbackURL,
}: SocialAuthButtonsProps) {
  const signInSocial = useSignInSocial();
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) {
    return null;
  }

  const handleClick = async (id: SocialProviderId) => {
    setError(null);
    setPending(id);
    try {
      await signInSocial.mutateAsync({
        provider: id,
        callbackURL: callbackURL ?? window.location.origin,
      });
      // The mutation usually triggers a redirect; if it returns, the OAuth
      // flow was a no-op (provider unconfigured server-side, etc.).
    } catch (err) {
      setError(err instanceof Error ? err.message : `${id} sign-in failed`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {providers.map((id) => {
        const p = PROVIDERS[id];
        if (!p) {
          return null;
        }
        const isPending = pending === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleClick(id)}
            disabled={pending !== null}
            className={cn(
              'inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-60',
              p.className,
            )}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <p.Icon />}
            {p.label}
          </button>
        );
      })}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ── Icons (inline SVGs avoid a brand-icon dep) ─────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
