/**
 * SocialAuthButtons — sign-in/up via configured better-auth socialProviders.
 *
 * Calls `authClient.signIn.social({ provider, callbackURL })` which redirects
 * the browser to the provider's OAuth endpoint. The provider must be
 * configured server-side via `betterAuthOptions.socialProviders`; clicking a
 * button for an unconfigured provider returns a clear error from better-auth.
 *
 * Provider config is the union `string | SocialProviderObject`:
 *   - string shorthand: built-in glyph + label (e.g. `'google'`, `'github'`).
 *   - object: override label / icon / className / hide visibility.
 *
 * `socialDisclosure` controls whether the buttons render eagerly, expanded
 * behind a "More options" toggle, or collapsed behind one. The toggle is
 * used by sign-in pages that prioritize email + password but still want to
 * surface social providers.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useSignInSocial } from '../../hooks';
import { cn } from '../../lib/utils';

export type BuiltInSocialProviderId = 'google' | 'github' | 'microsoft' | 'apple';

// Allows arbitrary provider IDs (e.g. third-party OAuth) while preserving
// type-ahead for the built-ins.
export type SocialProviderId = BuiltInSocialProviderId | (string & {});

export interface SocialProviderObject {
  /** Provider id used by `authClient.signIn.social({ provider })`. */
  id: SocialProviderId;
  /** Override the default "Continue with X" label. */
  label?: string;
  /** Override the built-in glyph. Pass `null` to render no glyph. */
  icon?: ReactNode | null;
  /** Tailwind classes appended to the button. Use for branding colors. */
  className?: string;
  /** Keep in config but skip rendering. Useful for per-tenant toggles. */
  hidden?: boolean;
}

export type SocialProviderConfig = SocialProviderId | SocialProviderObject;

export type SocialDisclosure = 'always-visible' | 'expanded-default' | 'collapsed-default';

interface ResolvedProvider {
  id: SocialProviderId;
  label: string;
  icon: ReactNode | null;
  className: string;
}

// Uniform neutral styling for ALL social buttons by default — same card-
// surface look (border + muted hover), no per-brand backgrounds. Callers
// who want branding colours pass `className` per-provider in the rich
// object form. This keeps a clean, consistent visual grid; per-brand colour
// can clash with the host app's theme.
const NEUTRAL_BUTTON_CLASSNAME =
  'border-fl-border bg-fl-card text-fl-foreground hover:bg-fl-muted/40 border';

const BUILT_IN: Record<BuiltInSocialProviderId, Pick<ResolvedProvider, 'label' | 'icon'>> = {
  google: { label: 'Continue with Google', icon: <GoogleIcon /> },
  github: { label: 'Continue with GitHub', icon: <GitHubIcon /> },
  microsoft: { label: 'Continue with Microsoft', icon: <MicrosoftIcon /> },
  apple: { label: 'Continue with Apple', icon: <AppleIcon /> },
};

function resolveProvider(input: SocialProviderConfig): ResolvedProvider | null {
  const obj: SocialProviderObject = typeof input === 'string' ? { id: input } : input;
  if (obj.hidden) {
    return null;
  }
  const builtIn = BUILT_IN[obj.id as BuiltInSocialProviderId];
  return {
    id: obj.id,
    label: obj.label ?? builtIn?.label ?? `Continue with ${obj.id}`,
    icon: obj.icon === undefined ? (builtIn?.icon ?? null) : obj.icon,
    className: obj.className ?? NEUTRAL_BUTTON_CLASSNAME,
  };
}

export interface SocialAuthButtonsProps {
  /**
   * Providers to render. Order is render order.
   * @default ['google', 'github']
   */
  providers?: ReadonlyArray<SocialProviderConfig>;
  /** Where to redirect after a successful OAuth round-trip. */
  callbackURL?: string;
  /**
   * Whether the buttons render eagerly or behind a "More options" toggle.
   * @default 'always-visible'
   */
  disclosure?: SocialDisclosure;
  /**
   * Render-prop escape hatch: replace the default button entirely. The
   * `signIn()` callback kicks off the OAuth flow when invoked.
   */
  renderButton?: (provider: ResolvedProvider, signIn: () => void, isPending: boolean) => ReactNode;
}

export function SocialAuthButtons({
  providers = ['google', 'github'],
  callbackURL,
  disclosure = 'always-visible',
  renderButton,
}: SocialAuthButtonsProps) {
  const signInSocial = useSignInSocial();
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(disclosure !== 'collapsed-default');

  const resolved = providers.map(resolveProvider).filter((p): p is ResolvedProvider => p !== null);

  if (resolved.length === 0) {
    return null;
  }

  const handleClick = (id: SocialProviderId) => async () => {
    setError(null);
    setPending(id);
    try {
      await signInSocial.mutateAsync({
        provider: id,
        callbackURL: callbackURL ?? window.location.origin,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `${id} sign-in failed`);
    } finally {
      setPending(null);
    }
  };

  const buttons = resolved.map((p) => {
    const signIn = handleClick(p.id);
    const isPending = pending === p.id;
    if (renderButton) {
      return <span key={p.id}>{renderButton(p, signIn, isPending)}</span>;
    }
    return (
      <button
        key={p.id}
        type="button"
        onClick={signIn}
        disabled={pending !== null}
        className={cn(
          'focus-visible:ring-fl-ring inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-60',
          p.className,
        )}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : p.icon}
        {p.label}
      </button>
    );
  });

  // Always-visible: no toggle.
  if (disclosure === 'always-visible') {
    return (
      <div className="flex flex-col gap-2">
        {buttons}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>
    );
  }

  // Collapsible: render the toggle, then the buttons when open.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-fl-muted-foreground hover:text-fl-foreground inline-flex cursor-pointer items-center justify-center gap-1.5 text-sm underline-offset-4 hover:underline"
      >
        {open ? 'Hide other options' : 'More sign-in options'}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && buttons}
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="border-fl-destructive/30 bg-fl-destructive/10 text-fl-destructive rounded-md border px-3 py-2 text-sm"
    >
      {children}
    </p>
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

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.32-.05-.01-.13-.02-.26-.02-.38 0-1.07.5-2.09 1.13-2.84.79-.97 2.16-1.71 3.27-1.74.07.13.1.27.1.36zM20.5 17.07c-.61 1.4-1.32 2.78-2.45 2.81-1.11.03-1.47-.66-2.74-.66-1.27 0-1.66.63-2.71.69-1.09.06-1.92-1.5-2.54-2.9C8.78 14.82 7.74 9.93 9.79 6.66c1.01-1.62 2.82-2.65 4.78-2.68 1.06-.02 2.06.71 2.71.71.65 0 1.86-.88 3.13-.75.53.02 2.03.21 3 1.62-.08.05-1.79 1.04-1.77 3.12.02 2.49 2.18 3.32 2.21 3.33-.02.08-.34 1.18-1.13 2.32z" />
    </svg>
  );
}
