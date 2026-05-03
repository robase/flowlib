/**
 * PasswordSetupForm — prompt an authenticated user to add a password.
 *
 * Used after a passwordless sign-up (magic link or social) so the user can
 * sign in via email + password later. Skippable — they can already sign in
 * with their original method.
 *
 * Wraps `useSetPassword` (which calls BA's `setPassword` endpoint, no current
 * password required since the account was created without one).
 */

import { type FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSetPassword } from '../hooks';
import { AuthCard, ErrorMessage, Field, TextInput } from './ui/auth-form';

export interface PasswordSetupFormProps {
  /** Called when the password is saved or the user skips. */
  onDone?: () => void;
  /** Hide the "Skip for now" link. */
  hideSkip?: boolean;
  /** @default 'Set a password' */
  title?: string;
  /** @default 'Pick a password so you can sign in with email and password next time.' */
  description?: string;
}

export function PasswordSetupForm({
  onDone,
  hideSkip = false,
  title = 'Set a password',
  description = 'Pick a password so you can sign in with email and password next time.',
}: PasswordSetupFormProps) {
  const setPassword = useSetPassword();
  const [password, setPasswordVal] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks -- client-side equality check on user's own input, not a secret comparison
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    try {
      await setPassword.mutateAsync({ newPassword: password });
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password');
    }
  };

  return (
    <AuthCard
      title={title}
      description={description}
      footer={
        hideSkip ? undefined : (
          <button
            type="button"
            onClick={() => onDone?.()}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="New password" htmlFor="setpw-password" hint="At least 8 characters.">
          <TextInput
            id="setpw-password"
            type="password"
            value={password}
            onChange={(e) => setPasswordVal(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            autoFocus
            required
            minLength={8}
          />
        </Field>

        <Field label="Confirm password" htmlFor="setpw-password-confirm">
          <TextInput
            id="setpw-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>

        <ErrorMessage>{error}</ErrorMessage>

        <button
          type="submit"
          disabled={setPassword.isPending}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {setPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {setPassword.isPending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}
