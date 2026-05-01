/**
 * DetailsTab — profile details (read-only email, editable first/last name).
 *
 * Better Auth stores name as a single `name` field; we split on the first
 * space to expose first/last in the UI and rejoin on save.
 */

import { useEffect, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../providers/AuthProvider';
import { useSignOut, useUpdateUser } from '../../hooks';
import { Avatar } from '../ui/Avatar';
import { ErrorMessage, Field, SuccessMessage, TextInput } from '../ui/auth-form';
import { SettingsDivider, SettingsRow } from '../ui/settings-row';

export function DetailsTab() {
  const { user } = useAuth();
  const updateUser = useUpdateUser();
  const navigate = useNavigate();
  // Navigate from the mutation's onSuccess so the redirect runs even if the
  // calling component has already unmounted (which it has, since clearing
  // the auth cache synchronously flips AuthGate to its unauthenticated
  // fallback before this onClick handler's continuation runs).
  const signOut = useSignOut({
    onSuccess: () => navigate('/sign-in', { replace: true }),
  });

  const [first, last] = splitName(user?.name);
  const [firstName, setFirstName] = useState(first);
  const [lastName, setLastName] = useState(last);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const [f, l] = splitName(user?.name);
    setFirstName(f);
    setLastName(l);
  }, [user?.name]);

  const dirty = firstName !== first || lastName !== last;
  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    try {
      const merged = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
      await updateUser.mutateAsync({ name: merged || undefined });
      setSuccess('Details updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsRow
        title="Name"
        description="Your name shown across the app and on shared workflows."
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar src={user?.image} name={user?.name} email={user?.email} size="xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{user?.name || 'No name set'}</p>
              {user?.email && (
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="details-first-name">
              <TextInput
                id="details-first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Last name" htmlFor="details-last-name">
              <TextInput
                id="details-last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </Field>
          </div>

          <ErrorMessage>{error}</ErrorMessage>
          <SuccessMessage>{success}</SuccessMessage>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || updateUser.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {updateUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {updateUser.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow title="Sign out" description="End your session on this device.">
        <button
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/30 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
        >
          {signOut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          {signOut.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </SettingsRow>
    </div>
  );
}

function splitName(name?: string | null): [string, string] {
  if (!name) {
    return ['', ''];
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return ['', ''];
  }
  const idx = trimmed.indexOf(' ');
  if (idx < 0) {
    return [trimmed, ''];
  }
  return [trimmed.slice(0, idx), trimmed.slice(idx + 1).trim()];
}
