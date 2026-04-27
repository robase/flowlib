/**
 * SignInForm — Email/password sign-in form component.
 *
 * Uses the AuthProvider's signIn action. Styled to match the Flowlib
 * design system with grouped fields, clean labels, and themed inputs.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { Loader2 } from 'lucide-react';

export interface SignInFormProps {
  /** Called after successful sign-in */
  onSuccess?: () => void;
  /** Additional CSS class names */
  className?: string;
}

export function SignInForm({ onSuccess, className }: SignInFormProps) {
  const { signIn, isSigningIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password.trim()) {
      setLocalError('Email and password are required');
      return;
    }

    try {
      await signIn({ email, password });
      onSuccess?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  const displayError = localError ?? error;

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex flex-col gap-6">
        {/* Email field */}
        <div className="grid gap-2">
          <label htmlFor="auth-signin-email" className="text-sm font-medium leading-none">
            Email
          </label>
          <input
            id="auth-signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className="flex h-9 w-full rounded-md border border-imp-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-imp-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-imp-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Password field */}
        <div className="grid gap-2">
          <label htmlFor="auth-signin-password" className="text-sm font-medium leading-none">
            Password
          </label>
          <input
            id="auth-signin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className="flex h-9 w-full rounded-md border border-imp-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-imp-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-imp-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Error message */}
        {displayError && (
          <div className="rounded-md border border-imp-destructive/30 bg-imp-destructive/10 px-3 py-2 text-sm text-imp-destructive">
            {displayError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSigningIn}
          className="inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-imp-primary px-4 py-2 text-sm font-medium text-imp-primary-foreground shadow transition-colors hover:bg-imp-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-imp-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {isSigningIn ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </div>
    </form>
  );
}
