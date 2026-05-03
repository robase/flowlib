// =============================================================================
// Phase 6 — Threat hardening posture
//
// This module is deliberately advisory: it surfaces whether the instance is
// running with the safer defaults the plan recommends (GitHub App auth,
// webhook secret configured, signed commits when available) without blocking
// existing installations that still use PATs or omit webhooks in dev.
// =============================================================================

import type { GitProviderSecurity } from './git-provider';
import type { VcEnvironment } from './types';

export interface VersionControlHardeningInput {
  environment: VcEnvironment;
  providerId: string;
  providerSecurity?: GitProviderSecurity;
  webhookSecretConfigured: boolean;
}

export interface VersionControlHardeningPosture {
  auth: {
    provider: string;
    type: 'token' | 'app' | 'credential' | 'unknown';
    githubAppRecommended: boolean;
    ok: boolean;
  };
  webhooks: {
    secretConfigured: boolean;
    secretRequired: boolean;
    ok: boolean;
  };
  commitSigning: {
    supported: boolean;
    configured: boolean;
    ok: boolean;
  };
  warnings: string[];
}

export function assessHardeningPosture(
  input: VersionControlHardeningInput,
): VersionControlHardeningPosture {
  const authType = input.providerSecurity?.authType ?? 'unknown';
  const appAuthSupported = input.providerSecurity?.supportsAppAuth ?? input.providerId === 'github';
  const githubAppRecommended =
    input.providerId === 'github' && appAuthSupported && authType !== 'app';
  const webhookSecretRequired = input.environment === 'prod';
  const commitSigningSupported = input.providerSecurity?.supportsSignedCommits ?? false;
  const signedCommitsConfigured = input.providerSecurity?.signedCommitsConfigured ?? false;

  const warnings: string[] = [];
  if (githubAppRecommended) {
    warnings.push(
      'GitHub App authentication is recommended over PATs for narrower repo-scoped permissions.',
    );
  }
  if (webhookSecretRequired && !input.webhookSecretConfigured) {
    warnings.push(
      'Production instances should configure webhookSecret so GitHub webhooks are HMAC verified.',
    );
  }
  if (commitSigningSupported && !signedCommitsConfigured) {
    warnings.push('Commit signing is supported but not configured for plugin-authored commits.');
  }

  return {
    auth: {
      provider: input.providerId,
      type: authType,
      githubAppRecommended,
      ok: !githubAppRecommended,
    },
    webhooks: {
      secretConfigured: input.webhookSecretConfigured,
      secretRequired: webhookSecretRequired,
      ok: !webhookSecretRequired || input.webhookSecretConfigured,
    },
    commitSigning: {
      supported: commitSigningSupported,
      configured: signedCommitsConfigured,
      ok: !commitSigningSupported || signedCommitsConfigured,
    },
    warnings,
  };
}
