/**
 * TwoFactorVerifyForm — TOTP / backup code verification after sign-in.
 *
 * Uses the borrowed `useVerifyTwoFactorTotp` / `useVerifyTwoFactorBackupCode`
 * hooks. AuthProvider's `twoFactorRequired` flag drives display from the
 * AuthAppShell.
 */

import { useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useVerifyTwoFactorBackupCode, useVerifyTwoFactorTotp } from '../hooks';
import { AuthCard, ErrorMessage, Field, SubmitButton, TextInput } from './ui/auth-form';

export interface TwoFactorVerifyFormProps {
  /** Called after successful 2FA verification */
  onSuccess?: () => void;
}

export function TwoFactorVerifyForm({ onSuccess }: TwoFactorVerifyFormProps) {
  const { cancelTwoFactor } = useAuth();
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [trustDevice, setTrustDevice] = useState(false);

  const verifyTotp = useVerifyTwoFactorTotp();
  const verifyBackup = useVerifyTwoFactorBackupCode();
  const pending = verifyTotp.isPending || verifyBackup.isPending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setLocalError(mode === 'totp' ? 'Enter your verification code' : 'Enter a backup code');
      return;
    }

    try {
      if (mode === 'totp') {
        await verifyTotp.mutateAsync({ code: trimmed, trustDevice });
      } else {
        await verifyBackup.mutateAsync({ code: trimmed });
      }
      cancelTwoFactor();
      onSuccess?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  return (
    <AuthCard
      title={mode === 'totp' ? 'Two-factor authentication' : 'Use a backup code'}
      description={
        mode === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the backup codes you saved when you set up 2FA.'
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'totp' ? 'backup' : 'totp');
              setCode('');
              setLocalError(null);
            }}
            className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {mode === 'totp' ? 'Use a backup code instead' : 'Use authenticator app instead'}
          </button>
          <button
            type="button"
            onClick={cancelTwoFactor}
            className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </button>
        </>
      }
    >
      <div className="mb-2 flex justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={mode === 'totp' ? 'Verification code' : 'Backup code'}
          htmlFor="auth-2fa-code"
        >
          <TextInput
            id="auth-2fa-code"
            type="text"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            pattern={mode === 'totp' ? '[0-9]*' : undefined}
            maxLength={mode === 'totp' ? 6 : 20}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={mode === 'totp' ? '000000' : 'xxxx-xxxx-xx'}
            autoComplete="one-time-code"
            autoFocus
            required
            className="text-center text-lg font-mono tracking-widest"
          />
        </Field>

        {mode === 'totp' && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Remember this device for 30 days
          </label>
        )}

        <ErrorMessage>{localError}</ErrorMessage>

        <SubmitButton loading={pending}>{pending ? 'Verifying…' : 'Verify'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
