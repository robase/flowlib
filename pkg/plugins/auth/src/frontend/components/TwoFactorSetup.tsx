/**
 * TwoFactorSetup — enable / disable 2FA for the current user.
 *
 * Uses the borrowed `useEnableTwoFactor` / `useDisableTwoFactor` /
 * `useVerifyTwoFactorTotp` hooks. State machine:
 *   idle → password → qr → verify → backup-codes
 *   idle → disable-confirm
 */

import { useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useDisableTwoFactor, useEnableTwoFactor, useVerifyTwoFactorTotp } from '../hooks';
import { ErrorMessage, Field, TextInput } from './ui/auth-form';

type Step = 'idle' | 'password' | 'qr' | 'backup-codes' | 'disable-confirm';

export function TwoFactorSetup() {
  const { user } = useAuth();
  const enable = useEnableTwoFactor();
  const disable = useDisableTwoFactor();
  const verify = useVerifyTwoFactorTotp();

  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const is2FAEnabled = user?.twoFactorEnabled ?? false;

  const reset = () => {
    setStep('idle');
    setPassword('');
    setTotpUri('');
    setBackupCodes([]);
    setVerifyCode('');
    setError(null);
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Password is required');
      return;
    }
    try {
      const result = (await enable.mutateAsync({ password })) as {
        totpURI: string;
        backupCodes: string[];
      };
      setTotpUri(result.totpURI);
      setBackupCodes(result.backupCodes);
      setStep('qr');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable 2FA');
    }
  };

  const handleVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = verifyCode.trim();
    if (!trimmed) {
      setError('Enter the verification code');
      return;
    }
    try {
      await verify.mutateAsync({ code: trimmed });
      setStep('backup-codes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const handleDisableConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Password is required');
      return;
    }
    try {
      await disable.mutateAsync({ password });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  };

  // ── Step views ────────────────────────────────────────────────

  if (step === 'idle') {
    return (
      <div className="rounded-md border border-border bg-background p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Two-factor authentication
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {is2FAEnabled
                ? 'Your account is protected with two-factor authentication.'
                : 'Add an extra layer of security to your account by enabling 2FA.'}
            </p>
          </div>
          {is2FAEnabled ? (
            <button
              type="button"
              onClick={() => setStep('disable-confirm')}
              className="shrink-0 inline-flex h-8 items-center gap-2 rounded-md border border-destructive/30 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Disable 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep('password')}
              className="shrink-0 inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Enable 2FA
            </button>
          )}
        </div>
        <span
          className={
            is2FAEnabled
              ? 'inline-block rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success'
              : 'inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {is2FAEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <form
        onSubmit={handlePasswordSubmit}
        className="rounded-md border border-border bg-background p-4"
      >
        <h3 className="mb-2 text-sm font-medium">Enable two-factor authentication</h3>
        <p className="mb-4 text-sm text-muted-foreground">Enter your password to continue.</p>
        <div className="flex flex-col gap-3">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            autoFocus
            required
          />
          <ErrorMessage>{error}</ErrorMessage>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={enable.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {enable.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue
            </button>
          </div>
        </div>
      </form>
    );
  }

  if (step === 'qr') {
    return (
      <form
        onSubmit={handleVerifySubmit}
        className="rounded-md border border-border bg-background p-4"
      >
        <h3 className="mb-2 text-sm font-medium">Scan QR code</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Scan this with your authenticator app (Google Authenticator, Authy, 1Password, …), then
          enter the 6-digit code below.
        </p>
        <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Or enter this key manually:
          </p>
          <code className="block break-all font-mono text-xs">{totpUri}</code>
        </div>
        <Field label="Verification code" htmlFor="setup-2fa-verify">
          <TextInput
            id="setup-2fa-verify"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            placeholder="000000"
            autoComplete="one-time-code"
            autoFocus
            required
            className="text-center text-lg font-mono tracking-widest"
          />
        </Field>
        <div className="mt-3">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={verify.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {verify.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify &amp; enable
          </button>
        </div>
      </form>
    );
  }

  if (step === 'backup-codes') {
    return (
      <div className="rounded-md border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-medium">Save your backup codes</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Store these somewhere safe. Each code can be used once to sign in if you lose access to
          your authenticator app.
        </p>
        <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {backupCodes.map((code, i) => (
              <code key={i} className="font-mono text-sm">
                {code}
              </code>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy codes'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (step === 'disable-confirm') {
    return (
      <form
        onSubmit={handleDisableConfirm}
        className="rounded-md border border-destructive/30 bg-background p-4"
      >
        <h3 className="mb-2 text-sm font-medium">Disable two-factor authentication</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Enter your password to confirm. Your account will be less secure.
        </p>
        <div className="flex flex-col gap-3">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            autoFocus
            required
          />
          <ErrorMessage>{error}</ErrorMessage>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disable.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {disable.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Disable 2FA
            </button>
          </div>
        </div>
      </form>
    );
  }

  return null;
}
