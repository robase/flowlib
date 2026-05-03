/**
 * SignInForm — email/password sign-in.
 *
 * Uses the borrowed `useSignInEmail` hook which wraps `authClient.signIn.email`
 * with React Query. When the response includes `twoFactorRedirect: true`,
 * flips the AuthProvider's `twoFactorRequired` flag so AuthAppShell renders
 * the 2FA verification page next.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { useAuthPublicConfig, useSignInEmail } from '../hooks';
import { AuthCard, Divider, ErrorMessage, Field, SubmitButton, TextInput } from './ui/auth-form';
import {
  SocialAuthButtons,
  type SocialDisclosure,
  type SocialProviderConfig,
} from './ui/SocialAuthButtons';

export interface SignInFormProps {
  /** Called after successful (no-2FA) sign-in */
  onSuccess?: () => void;
  /**
   * Force-hide the sign-up footer link. By default the form auto-hides it
   * when the server-side public config reports `signUpEnabled: false`.
   */
  hideSignUp?: boolean;
  /**
   * Social providers shown above the email block. Pass `[]` to hide.
   * @default ['google', 'github']
   */
  socialProviders?: ReadonlyArray<SocialProviderConfig>;
  /** Where to redirect after a successful OAuth round-trip. */
  socialCallbackURL?: string;
  /**
   * How the social block is presented. Sign-in defaults to `collapsed-default`
   * because most returning users sign in with email + password.
   * @default 'collapsed-default'
   */
  socialDisclosure?: SocialDisclosure;
}

export function SignInForm({
  onSuccess,
  hideSignUp = false,
  socialProviders = ['google', 'github'],
  socialCallbackURL,
  socialDisclosure = 'collapsed-default',
}: SignInFormProps) {
  const { setTwoFactorRequired } = useAuth();
  const config = useAuthPublicConfig();
  const signUpDisabled = hideSignUp || config.data?.signUpEnabled === false;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const signIn = useSignInEmail();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password) {
      setLocalError('Email and password are required');
      return;
    }

    try {
      const result = await signIn.mutateAsync({ email, password });
      const data = (result as { twoFactorRedirect?: boolean }) ?? {};
      if (data.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      onSuccess?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your account to continue"
      footer={
        !signUpDisabled ? (
          <p>
            Don&apos;t have an account?{' '}
            <Link
              to="/sign-up"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {socialProviders.length > 0 && (
          <>
            <SocialAuthButtons
              providers={socialProviders}
              callbackURL={socialCallbackURL}
              disclosure={socialDisclosure}
            />
            <Divider>or sign in with email</Divider>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field label="Email" htmlFor="auth-signin-email">
            <TextInput
              id="auth-signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>

          <Field
            label="Password"
            htmlFor="auth-signin-password"
            trailing={
              <Link
                to="/forgot-password"
                className="text-xs font-normal text-muted-foreground underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            }
          >
            <TextInput
              id="auth-signin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          <ErrorMessage>{localError}</ErrorMessage>

          <SubmitButton loading={signIn.isPending}>
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </SubmitButton>
        </form>
      </div>
    </AuthCard>
  );
}
