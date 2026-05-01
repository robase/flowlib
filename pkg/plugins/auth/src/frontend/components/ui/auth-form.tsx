/**
 * Shared form primitives used across SignIn / SignUp / ForgotPassword /
 * ResetPassword pages. Visual style cribbed from
 * https://github.com/better-auth-ui/better-auth-ui (shadcn-flavoured cards
 * with stacked fields), expressed in the registered theme tokens
 * (`bg-card`, `text-muted-foreground`, etc.) which resolve to `--imp-*`.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Page wrapper ──────────────────────────────────────────────

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-6">{children}</div>
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
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-1.5 p-6 pb-0">
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
      {footer && (
        <div className="flex flex-col gap-2 border-t border-border p-6 text-center text-sm text-muted-foreground">
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
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
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
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
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
        'inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
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
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
    <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
      {children}
    </div>
  );
}
