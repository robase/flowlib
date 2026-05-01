/**
 * AuthenticationTab — 2FA, API tokens, active sessions.
 */

import { TwoFactorSetup } from '../TwoFactorSetup';
import { SessionsList } from '../SessionsList';
import { SettingsDivider, SettingsRow } from '../ui/settings-row';
import { ApiKeysCard } from './ApiKeysCard';

export function AuthenticationTab() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsRow
        title="Two Factor Authentication"
        description="Add a second form of verification at sign-in for an extra layer of security."
      >
        <TwoFactorSetup />
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow
        title="API keys"
        description="Generate keys to call Flowlib programmatically. Keep them secret — anyone with a key can act as you."
      >
        <ApiKeysCard />
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow
        title="Active sessions"
        description="Devices where you're currently signed in. Sign out from any you don't recognise."
      >
        <SessionsList />
      </SettingsRow>
    </div>
  );
}
