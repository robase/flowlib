/**
 * Shared form primitives used across SignIn / SignUp / ForgotPassword /
 * ResetPassword pages. Visual style cribbed from
 * https://github.com/better-auth-ui/better-auth-ui (shadcn-flavoured cards
 * with stacked fields), expressed using the explicit `fl-*` utility classes
 * defined in `@flowlib/ui/styles` so they render correctly even outside
 * `.fl-shell` (e.g. on the unauthenticated sign-in page).
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Page wrapper ──────────────────────────────────────────────

export interface AuthPageShellProps {
  children: ReactNode;
  /**
   * Brand mark rendered above the card. Pass an SVG / wordmark element.
   * Hosts that omit it get no top branding.
   */
  brand?: ReactNode;
}

export function AuthPageShell({ children, brand }: AuthPageShellProps) {
  return (
    <div className="bg-fl-background text-fl-foreground flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {brand && <div className="flex items-center justify-center">{brand}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────

export interface AuthCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="border-fl-border bg-fl-card text-fl-foreground rounded-lg border shadow-sm">
      <div className="flex flex-col gap-1.5 p-6 pb-0">
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {description && <p className="text-fl-muted-foreground text-sm">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
      {footer && (
        <div className="border-fl-border text-fl-muted-foreground flex flex-col gap-2 border-t p-6 text-center text-sm">
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, trailing, children }: FieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {hint && <p className="text-fl-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        // Distinct fill so the input pops against the card background.
        'border-fl-border bg-fl-muted placeholder:text-fl-muted-foreground focus-visible:ring-fl-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  ),
);
TextInput.displayName = 'TextInput';

// ── Submit button ─────────────────────────────────────────────

export interface SubmitButtonProps {
  loading?: boolean;
  children: ReactNode;
  disabled?: boolean;
  variant?: 'primary' | 'destructive' | 'outline';
}

const VARIANT: Record<NonNullable<SubmitButtonProps['variant']>, string> = {
  primary: 'bg-fl-primary text-fl-primary-foreground hover:bg-fl-primary/90',
  destructive: 'bg-fl-destructive text-white hover:opacity-90',
  outline: 'border-fl-border text-fl-foreground hover:bg-fl-muted/40 border bg-transparent',
};

export function SubmitButton({
  loading,
  children,
  disabled,
  variant = 'primary',
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={cn(
        'focus-visible:ring-fl-ring inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// ── Inline / link button ──────────────────────────────────────
// For text buttons that should *look* like links (cursor pointer, hover
// underline, no background). Use this instead of a bare <button> for
// "Sign up" / "Continue with Email" / "Use a password instead" affordances.

export interface LinkButtonProps {
  onClick?: () => void;
  children: ReactNode;
  /** @default 'primary' (uses --fl-primary), 'muted' picks the muted color. */
  tone?: 'primary' | 'muted' | 'foreground';
  /** @default 'sm' */
  size?: 'sm' | 'xs';
  type?: 'button' | 'submit';
  disabled?: boolean;
}

const LINK_TONE: Record<NonNullable<LinkButtonProps['tone']>, string> = {
  primary: 'text-fl-primary hover:text-fl-primary',
  muted: 'text-fl-muted-foreground hover:text-fl-foreground',
  foreground: 'text-fl-foreground',
};

const LINK_SIZE: Record<NonNullable<LinkButtonProps['size']>, string> = {
  sm: 'text-sm',
  xs: 'text-xs',
};

export function LinkButton({
  onClick,
  children,
  tone = 'primary',
  size = 'sm',
  type = 'button',
  disabled = false,
}: LinkButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 font-medium underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50',
        LINK_TONE[tone],
        LINK_SIZE[size],
      )}
    >
      {children}
    </button>
  );
}

// ── Divider ───────────────────────────────────────────────────
// `<Divider>or</Divider>` renders `── or ──` style row, used between
// social buttons and the email block.

export function Divider({ children }: { children?: ReactNode }) {
  return (
    <div className="text-fl-muted-foreground flex items-center gap-3 text-xs">
      <span className="bg-fl-border h-px flex-1" />
      {children && <span className="uppercase tracking-wider">{children}</span>}
      <span className="bg-fl-border h-px flex-1" />
    </div>
  );
}

// ── Error message ─────────────────────────────────────────────

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <div
      role="alert"
      className="border-fl-destructive/30 bg-fl-destructive/10 text-fl-destructive rounded-md border px-3 py-2 text-sm"
    >
      {children}
    </div>
  );
}

// ── Success message ───────────────────────────────────────────

export function SuccessMessage({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <div className="text-fl-foreground rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm">
      {children}
    </div>
  );
}
