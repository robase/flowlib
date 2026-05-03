/**
 * EmailSentNotice — interstitial shown after `useSendMagicLink()` fires.
 *
 * The user's other tab (or device, if they open the email there) hits the
 * magic-link verify endpoint, lands authenticated, and is redirected to
 * `newUserCallbackURL` (first-time sign-up: `/welcome/set-password`) or
 * `callbackURL`. The original tab can sit on this notice until the session
 * query refetches and AuthGate flips it into the authenticated tree.
 *
 * Resend re-POSTs `/sign-in/magic-link` for the same email.
 */

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useSendMagicLink } from '../hooks';
import { AuthCard, ErrorMessage } from './ui/auth-form';

export interface EmailSentNoticeProps {
  /** The address the magic link was sent to. */
  email: string;
  /** "Use a different email" / "Back" handler. */
  onBack: () => void;
  /** Override the magic-link callback URL passed on resend. */
  callbackURL?: string;
}

export function EmailSentNotice({ email, onBack, callbackURL }: EmailSentNoticeProps) {
  const sendMagicLink = useSendMagicLink();
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    setError(null);
    setResent(false);
    try {
      await sendMagicLink.mutateAsync({
        email,
        callbackURL: callbackURL ?? window.location.origin,
      });
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend');
    }
  };

  return (
    <AuthCard
      title="Check your email"
      footer={
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Use a different email
        </button>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mail className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>.
          Click it to continue. The link expires in 15 minutes.
        </p>

        <div className="flex w-full flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={handleResend}
            disabled={sendMagicLink.isPending}
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {sendMagicLink.isPending ? 'Sending…' : 'Resend sign-in link'}
          </button>

          {resent && !sendMagicLink.isPending && (
            <p className="text-xs text-muted-foreground">
              Sent — check your inbox (and spam folder).
            </p>
          )}
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      </div>
    </AuthCard>
  );
}
