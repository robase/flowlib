/**
 * SignUpForm — passwordless sign-up via social provider or magic link.
 *
 * State machine:
 *   chooser → magic-link-email   →  email-sent  ⟶ (user clicks link)
 *           ↘ password (if 'password' mode is enabled)
 *
 * - chooser: social provider buttons + "Continue with Email" (and optionally
 *   "Use a password instead" when both modes are enabled).
 * - magic-link-email: collects the email address, calls
 *   `authClient.signIn.magicLink({ email, callbackURL })`. On success flips
 *   to `email-sent`.
 * - email-sent: <EmailSentNotice /> — "Check your email", resend, change
 *   address. The user clicks the link in their inbox; the BA magic-link
 *   verify endpoint signs them in. Configure the plugin's
 *   `newUserCallbackURL` to `/welcome/set-password` so first-time users land
 *   on the password setup page.
 * - password: classic email + password form, only rendered when 'password'
 *   is in `signUpModes`. Calls `authClient.signUp.email`.
 *
 * Server requirements per mode:
 *   - 'magic-link' → Better Auth `magicLink` plugin enabled + sendMagicLink.
 *   - 'password'   → emailAndPassword.enabled (default true).
 *
 * @see https://better-auth.com/docs/plugins/magic-link
 */

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Mail } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { useAuthPublicConfig, useSendMagicLink, useSignUpEmail } from '../hooks';
import {
  AuthCard,
  Divider,
  ErrorMessage,
  Field,
  LinkButton,
  SubmitButton,
  TextInput,
} from './ui/auth-form';
import { EmailSentNotice } from './EmailSentNotice';
import {
  SocialAuthButtons,
  type SocialDisclosure,
  type SocialProviderConfig,
} from './ui/SocialAuthButtons';

export type SignUpMode = 'magic-link' | 'password';

export interface SignUpFormProps {
  /** Called after a successful (signed-in) sign-up. Magic-link sign-up does NOT trigger this — it triggers post-link-click on the other tab. */
  onSuccess?: () => void;
  /**
   * Sign-up flows offered after the user clicks "Continue with Email".
   * First entry is the primary path. When omitted, auto-detected from the
   * server's public-config endpoint (`magicLinkEnabled` + `passwordEnabled`).
   */
  signUpModes?: ReadonlyArray<SignUpMode>;
  /**
   * Social providers shown above the email block. Pass `[]` to hide.
   * @default ['google', 'github']
   */
  socialProviders?: ReadonlyArray<SocialProviderConfig>;
  /** Where to redirect after a successful OAuth round-trip. */
  socialCallbackURL?: string;
  /** Disclosure mode for the social block. @default 'always-visible' */
  socialDisclosure?: SocialDisclosure;
  /**
   * Where to redirect first-time magic-link users. Should match the BA
   * magic-link plugin's `newUserCallbackURL`.
   * @default `${origin}/welcome/set-password`
   */
  magicLinkNewUserCallbackURL?: string;
  /** Where to redirect returning magic-link users. @default `window.location.origin` */
  magicLinkCallbackURL?: string;
}

type Step =
  | { kind: 'chooser' }
  | { kind: 'magic-link-email' }
  | { kind: 'email-sent'; email: string }
  | { kind: 'password' };

export function SignUpForm({
  onSuccess,
  signUpModes,
  socialProviders = ['google', 'github'],
  socialCallbackURL,
  socialDisclosure = 'always-visible',
  magicLinkNewUserCallbackURL,
  magicLinkCallbackURL,
}: SignUpFormProps) {
  const config = useAuthPublicConfig();
  const detectedModes = detectSignUpModes(config.data);
  const modes = signUpModes ?? detectedModes;
  const hasMagicLink = modes.includes('magic-link');
  const hasPassword = modes.includes('password');
  const primary: SignUpMode | undefined = modes[0];

  const [step, setStep] = useState<Step>({ kind: 'chooser' });

  // ── Chooser ─────────────────────────────────────────────────

  if (step.kind === 'chooser') {
    return (
      <AuthCard
        title="Let's create your account"
        footer={
          <p>
            Already have an account?{' '}
            <Link
              to="/sign-in"
              className="text-fl-foreground cursor-pointer font-medium underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        }
      >
        <div className="flex flex-col gap-4">
          {socialProviders.length > 0 && (
            <>
              <SocialAuthButtons
                providers={socialProviders}
                callbackURL={socialCallbackURL}
                disclosure={socialDisclosure}
              />
              <Divider />
            </>
          )}

          {primary === 'magic-link' && (
            <LinkButton onClick={() => setStep({ kind: 'magic-link-email' })}>
              Continue with Email <ArrowRight className="h-4 w-4" />
            </LinkButton>
          )}
          {primary === 'password' && (
            <LinkButton onClick={() => setStep({ kind: 'password' })}>
              Sign up with Email <ArrowRight className="h-4 w-4" />
            </LinkButton>
          )}

          {hasMagicLink && hasPassword && primary === 'magic-link' && (
            <LinkButton tone="muted" size="xs" onClick={() => setStep({ kind: 'password' })}>
              Use a password instead
            </LinkButton>
          )}
          {hasMagicLink && hasPassword && primary === 'password' && (
            <LinkButton
              tone="muted"
              size="xs"
              onClick={() => setStep({ kind: 'magic-link-email' })}
            >
              Email me a sign-in link instead
            </LinkButton>
          )}
        </div>
      </AuthCard>
    );
  }

  // ── Magic-link email step ────────────────────────────────────

  if (step.kind === 'magic-link-email') {
    return (
      <MagicLinkEmailStep
        onSent={(email) => setStep({ kind: 'email-sent', email })}
        onBack={() => setStep({ kind: 'chooser' })}
        newUserCallbackURL={magicLinkNewUserCallbackURL}
        callbackURL={magicLinkCallbackURL}
      />
    );
  }

  // ── Email-sent ──────────────────────────────────────────────

  if (step.kind === 'email-sent') {
    return (
      <EmailSentNotice
        email={step.email}
        onBack={() => setStep({ kind: 'magic-link-email' })}
        callbackURL={magicLinkCallbackURL}
      />
    );
  }

  // ── Password step ───────────────────────────────────────────

  return <PasswordSignUpStep onSuccess={onSuccess} onBack={() => setStep({ kind: 'chooser' })} />;
}

// ─────────────────────────────────────────────────────────────
// Mode detection
// ─────────────────────────────────────────────────────────────

function detectSignUpModes(
  config: { magicLinkEnabled?: boolean; passwordEnabled?: boolean } | undefined,
): SignUpMode[] {
  if (!config) {
    // Optimistic default before the public-config query resolves: assume
    // magic link is the primary path.
    return ['magic-link'];
  }
  const modes: SignUpMode[] = [];
  if (config.magicLinkEnabled) {
    modes.push('magic-link');
  }
  if (config.passwordEnabled !== false) {
    modes.push('password');
  }
  if (modes.length === 0) {
    modes.push('password');
  }
  return modes;
}

// ─────────────────────────────────────────────────────────────
// Magic-link email sub-step
// ─────────────────────────────────────────────────────────────

function MagicLinkEmailStep({
  onSent,
  onBack,
  newUserCallbackURL,
  callbackURL,
}: {
  onSent: (email: string) => void;
  onBack: () => void;
  newUserCallbackURL?: string;
  callbackURL?: string;
}) {
  const sendMagicLink = useSendMagicLink();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }
    try {
      await sendMagicLink.mutateAsync({
        email: trimmed,
        callbackURL: callbackURL ?? window.location.origin,
        newUserCallbackURL: newUserCallbackURL ?? `${window.location.origin}/welcome/set-password`,
      });
      onSent(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send sign-in link');
    }
  };

  return (
    <AuthCard
      title="Let's create your account"
      footer={
        <LinkButton tone="muted" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Other sign up options
        </LinkButton>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

        <SubmitButton loading={sendMagicLink.isPending}>
          <Mail className="h-4 w-4" />
          {sendMagicLink.isPending ? 'Sending…' : 'Send sign-in link'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Email + password sign-up sub-step
// ─────────────────────────────────────────────────────────────

function PasswordSignUpStep({ onSuccess, onBack }: { onSuccess?: () => void; onBack: () => void }) {
  const { setTwoFactorRequired } = useAuth();
  const signUp = useSignUpEmail();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    try {
      const trimmedEmail = email.trim();
      const result = await signUp.mutateAsync({
        email: trimmedEmail,
        password,
        name: name.trim() || trimmedEmail.split('@')[0] || trimmedEmail,
      });
      const data = (result as { twoFactorRedirect?: boolean }) ?? {};
      if (data.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    }
  };

  return (
    <AuthCard
      title="Create your account"
      footer={
        <LinkButton tone="muted" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Other sign up options
        </LinkButton>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="signup-name">
          <TextInput
            id="signup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
          />
        </Field>

        <Field label="Email" htmlFor="signup-email">
          <TextInput
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
          <TextInput
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>

        <ErrorMessage>{error}</ErrorMessage>

        <SubmitButton loading={signUp.isPending}>
          {signUp.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {signUp.isPending ? 'Creating account…' : 'Create account'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
