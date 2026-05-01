/**
 * ForgotPasswordForm — request a password reset email.
 *
 * Calls `authClient.requestPasswordReset` via the borrowed
 * `useRequestPasswordReset` hook. The host app must configure
 * `emailAndPassword.sendResetPassword` in better-auth options to actually
 * deliver the reset email — without it the request will fail. We always
 * show the same success message regardless of whether the address exists,
 * to avoid leaking account existence.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useRequestPasswordReset } from '../hooks';
import {
  AuthCard,
  ErrorMessage,
  Field,
  SubmitButton,
  SuccessMessage,
  TextInput,
} from './ui/auth-form';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const request = useRequestPasswordReset();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError('Email is required');
      return;
    }

    try {
      await request.mutateAsync({
        email,
        redirectTo: `${window.location.origin}${window.location.pathname.replace(/\/forgot-password.*/, '')}/reset-password`,
      });
      setSubmitted(true);
    } catch (err) {
      // Same UX whether or not the address exists — don't reveal user existence.
      // Only surface obvious config errors (e.g., when sendResetPassword isn't set up).
      const message = err instanceof Error ? err.message : 'Could not send reset email';
      // eslint-disable-next-line no-console
      console.warn('[auth] requestPasswordReset failed:', message);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <AuthCard
        title="Check your inbox"
        description="If an account exists for that email, we sent a reset link."
        footer={
          <p>
            <Link
              to="/sign-in"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        }
      >
        <SuccessMessage>
          The link expires after a short period — open it on the same device when possible.
        </SuccessMessage>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="We'll send you a link to reset your password."
      footer={
        <p>
          <Link
            to="/sign-in"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Email" htmlFor="auth-forgot-email">
          <TextInput
            id="auth-forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>

        <ErrorMessage>{localError}</ErrorMessage>

        <SubmitButton loading={request.isPending}>
          {request.isPending ? 'Sending…' : 'Send reset link'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
