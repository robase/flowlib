/**
 * Phase 6 — Break-glass + threat hardening.
 *
 * Break-glass open/close is covered in environments.test.ts. This file covers
 * the hardening posture checks that back /vc/health: GitHub App preference,
 * production webhook-secret requirement, and signed-commit advisory fields.
 */

import { describe, expect, it } from 'vitest';
import { assessHardeningPosture } from '../src/backend/hardening';

describe('assessHardeningPosture', () => {
  it('warns when GitHub uses token auth instead of GitHub App auth', () => {
    const posture = assessHardeningPosture({
      environment: 'dev',
      providerId: 'github',
      providerSecurity: { authType: 'token', supportsAppAuth: true },
      webhookSecretConfigured: true,
    });

    expect(posture.auth.type).toBe('token');
    expect(posture.auth.githubAppRecommended).toBe(true);
    expect(posture.auth.ok).toBe(false);
    expect(posture.warnings.join('\n')).toMatch(/GitHub App authentication/);
  });

  it('treats GitHub App auth as the hardened path', () => {
    const posture = assessHardeningPosture({
      environment: 'prod',
      providerId: 'github',
      providerSecurity: { authType: 'app', supportsAppAuth: true },
      webhookSecretConfigured: true,
    });

    expect(posture.auth.ok).toBe(true);
    expect(posture.webhooks.ok).toBe(true);
    expect(posture.warnings).toEqual([]);
  });

  it('requires webhookSecret on prod but not dev', () => {
    const prod = assessHardeningPosture({
      environment: 'prod',
      providerId: 'mock',
      providerSecurity: { authType: 'unknown' },
      webhookSecretConfigured: false,
    });
    const dev = assessHardeningPosture({
      environment: 'dev',
      providerId: 'mock',
      providerSecurity: { authType: 'unknown' },
      webhookSecretConfigured: false,
    });

    expect(prod.webhooks.secretRequired).toBe(true);
    expect(prod.webhooks.ok).toBe(false);
    expect(prod.warnings.join('\n')).toMatch(/webhookSecret/);
    expect(dev.webhooks.secretRequired).toBe(false);
    expect(dev.webhooks.ok).toBe(true);
  });

  it('surfaces signed commit support as advisory when available', () => {
    const posture = assessHardeningPosture({
      environment: 'prod',
      providerId: 'github',
      providerSecurity: {
        authType: 'app',
        supportsAppAuth: true,
        supportsSignedCommits: true,
        signedCommitsConfigured: false,
      },
      webhookSecretConfigured: true,
    });

    expect(posture.commitSigning.supported).toBe(true);
    expect(posture.commitSigning.configured).toBe(false);
    expect(posture.commitSigning.ok).toBe(false);
    expect(posture.warnings.join('\n')).toMatch(/Commit signing/);
  });
});
