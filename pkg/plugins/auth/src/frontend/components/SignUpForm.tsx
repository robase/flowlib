/**
 * SignUpForm — passwordless sign-up via social provider or email OTP.
 *
 * Four-step state machine (modeled after Vercel's sign-up flow + an
 * optional password set):
 *   chooser → email → otp → password
 *
 * - chooser: social provider buttons + "Continue with Email" link
 * - email: collects the email address, calls
 *   `authClient.emailOtp.sendVerificationOtp({ type: 'sign-in' })`
 * - otp: 6-digit code input, calls `authClient.signIn.emailOtp({ email, otp })`
 *   which auto-creates the account on first verification (when the
 *   server-side `emailOTP` plugin has `disableSignUp: false`, the default).
 *   On verify success, the user is signed in.
 * - password: prompts the user to set a password (so they can sign in via
 *   email + password later, without going through OTP each time). Skippable;
 *   skipping completes sign-up with the OTP-only account.
 *
 * Requires the `emailOTP` better-auth plugin to be enabled server-side via
 * the auth plugin's `emailOtp` option, with a `sendVerificationOTP`
 * callback that actually delivers the email.
 */

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Mail } from 'lucide-react';
import { Link } from 'react-router';
import { useSendVerificationOtp, useSetPassword, useSignInEmailOtp } from '../hooks';
import { AuthCard, ErrorMessage, Field, TextInput } from './ui/auth-form';
import { OtpInput } from './ui/OtpInput';
import { SocialAuthButtons, type SocialProviderId } from './ui/SocialAuthButtons';

export interface SignUpFormProps {
  /** Called after a successful (signed-in) sign-up */
  onSuccess?: () => void;
  /**
   * Social providers to show on the chooser step. Pass `[]` to hide.
   * @default ['google', 'github']
   */
  socialProviders?: ReadonlyArray<SocialProviderId>;
  /** Where to redirect after a successful OAuth round-trip. */
  socialCallbackURL?: string;
}

type Step = 'chooser' | 'email' | 'otp' | 'password';

export function SignUpForm({
  onSuccess,
  socialProviders = ['google', 'github'],
  socialCallbackURL,
}: SignUpFormProps) {
  const [step, setStep] = useState<Step>('chooser');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendOtp = useSendVerificationOtp();
  const signInOtp = useSignInEmailOtp();
  const setPasswordMutation = useSetPassword();

  // ── Chooser step ────────────────────────────────────────────

  if (step === 'chooser') {
    return (
      <AuthCard
        title="Let's create your account"
        footer={
          <p>
            Already have an account?{' '}
            <Link
              to="/sign-in"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        }
      >
        <div className="flex flex-col gap-4">
          <SocialAuthButtons providers={socialProviders} callbackURL={socialCallbackURL} />
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep('email');
            }}
            className="inline-flex h-10 items-center justify-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Continue with Email <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </AuthCard>
    );
  }

  // ── Email step ──────────────────────────────────────────────

  if (step === 'email') {
    const submitEmail = async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!email.trim()) {
        setError('Email is required');
        return;
      }
      try {
        await sendOtp.mutateAsync({ email: email.trim(), type: 'sign-in' });
        setStep('otp');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send code');
      }
    };

    return (
      <AuthCard
        title="Sign up"
        description="Enter your email to receive a verification code."
        footer={
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep('chooser');
            }}
            className="inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Other sign up options
          </button>
        }
      >
        <form onSubmit={submitEmail} className="flex flex-col gap-4">
          <Field label="Email" htmlFor="signup-email">
            <TextInput
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              required
            />
          </Field>

          <ErrorMessage>{error}</ErrorMessage>

          <button
            type="submit"
            disabled={sendOtp.isPending}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            <Mail className="h-4 w-4" />
            {sendOtp.isPending ? 'Sending…' : 'Continue with Email'}
          </button>
        </form>
      </AuthCard>
    );
  }

  // ── OTP step ────────────────────────────────────────────────

  const verify = async (code: string) => {
    setError(null);
    try {
      await signInOtp.mutateAsync({ email: email.trim(), otp: code });
      // OTP verified — the user is now signed in. Advance to the optional
      // "set a password" step so they can sign in with email+password later.
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code');
    }
  };

  const handleVerifySubmit = (e: FormEvent) => {
    e.preventDefault();
    if (otp.length === 6) {
      void verify(otp);
    }
  };

  const handleResend = async () => {
    setError(null);
    try {
      await sendOtp.mutateAsync({ email: email.trim(), type: 'sign-in' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code');
    }
  };

  if (step === 'otp') {
    return (
      <AuthCard
        title="Sign up"
        footer={
          <button
            type="button"
            onClick={() => {
              setError(null);
              setOtp('');
              setStep('email');
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Use a different email
          </button>
        }
      >
        <form onSubmit={handleVerifySubmit} className="flex flex-col gap-5">
          <p className="text-center text-sm text-muted-foreground">
            If you&apos;re new here, we sent a code to{' '}
            <span className="font-medium text-foreground">{email}</span>.
          </p>

          <OtpInput
            value={otp}
            onChange={setOtp}
            onComplete={(code) => void verify(code)}
            autoFocus
            disabled={signInOtp.isPending}
          />

          <ErrorMessage>{error}</ErrorMessage>

          <button
            type="submit"
            disabled={otp.length !== 6 || signInOtp.isPending}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {signInOtp.isPending ? 'Verifying…' : 'Verify code'}
          </button>

          <button
            type="button"
            onClick={handleResend}
            disabled={sendOtp.isPending}
            className="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          >
            {sendOtp.isPending ? 'Sending…' : 'Resend code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  // ── Password step (post-OTP) ────────────────────────────────

  const submitPassword = async (e: FormEvent) => {
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
      await setPasswordMutation.mutateAsync({ newPassword: password });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password');
    }
  };

  return (
    <AuthCard
      title="Set a password"
      description="Pick a password so you can sign in with email and password next time."
      footer={
        <button
          type="button"
          onClick={() => onSuccess?.()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </button>
      }
    >
      <form onSubmit={submitPassword} className="flex flex-col gap-5">
        <Field label="New password" htmlFor="signup-password" hint="At least 8 characters.">
          <TextInput
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            autoFocus
            required
            minLength={8}
          />
        </Field>

        <Field label="Confirm password" htmlFor="signup-password-confirm">
          <TextInput
            id="signup-password-confirm"
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
          disabled={setPasswordMutation.isPending}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {setPasswordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {setPasswordMutation.isPending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}
