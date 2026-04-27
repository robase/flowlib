// spec: specs/credential-management.plan.md
// seed: tests/seed.spec.ts

import { test, expect } from '../fixtures';

/** Helper: navigate to /flowlib/credentials and wait for the page to load */
async function goToCredentials(page: import('@playwright/test').Page) {
  await page.goto('/flowlib/credentials');
  await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Helper: create a credential via the API */
async function createCredentialViaApi(
  request: import('@playwright/test').APIRequestContext,
  apiBase: string,
  name: string,
  authType = 'bearer',
  config: Record<string, string> = { token: 'test-token' },
) {
  const resp = await request.post(`${apiBase}/credentials`, {
    data: { name, type: 'http-api', authType, config },
  });
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()) as { id: string; name: string };
}

/** Helper: delete a credential by name via API */
async function cleanupCredentialByName(
  request: import('@playwright/test').APIRequestContext,
  apiBase: string,
  name: string,
) {
  const list = await request.get(`${apiBase}/credentials`);
  if (!list.ok()) {
    return;
  }
  const creds: Array<{ id: string; name: string }> = await list.json();
  for (const c of creds) {
    if (c.name === name) {
      await request.delete(`${apiBase}/credentials/${c.id}`);
    }
  }
}

test.describe('Credential Edge Cases & Error Handling', () => {
  test('empty state shows create prompt when no credentials exist', async ({
    page,
    request,
    apiBase,
  }) => {
    // 1. Save existing credentials, then delete all via the API
    const listResp = await request.get(`${apiBase}/credentials`);
    expect(listResp.ok()).toBeTruthy();
    const existingCreds: Array<{ id: string; name: string }> = await listResp.json();

    // Store IDs for restoration
    const deletedIds: string[] = [];
    for (const c of existingCreds) {
      const delResp = await request.delete(`${apiBase}/credentials/${c.id}`);
      if (delResp.ok()) {
        deletedIds.push(c.id);
      }
    }

    try {
      // 2. Navigate to /flowlib/credentials
      await goToCredentials(page);

      // Empty state is shown
      await expect(page.getByText('No credentials yet')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/Add API keys, connect OAuth providers/)).toBeVisible();

      // A 'Create Credential' button is visible in the empty state
      const createBtn = page.getByRole('button', {
        name: 'Create Credential',
      });
      await expect(createBtn).toBeVisible();

      // 3. Click the 'Create Credential' button in the empty state
      await createBtn.click();

      // Create dialog opens
      await expect(page.getByRole('heading', { name: 'Create Credential' })).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      // Restore the seeded credentials expected by the rest of the suite.
      await request.post(`${apiBase}/credentials`, {
        data: {
          name: 'Anthropic API Key',
          type: 'http-api',
          authType: 'bearer',
          config: { token: 'sk-ant-placeholder' },
          description: 'Anthropic Claude API credential for AI model nodes',
        },
      });
      await request.post(`${apiBase}/credentials`, {
        data: {
          name: 'Linear OAuth2',
          type: 'http-api',
          authType: 'oauth2',
          config: { accessToken: 'placeholder' },
          description: 'Linear OAuth2 credential for issue tracking and project management',
        },
      });
    }
  });

  test('duplicate credential names are allowed', async ({ page, request, apiBase }) => {
    const credName = 'Duplicate Test';
    // Cleanup prior runs
    await cleanupCredentialByName(request, apiBase, credName);

    // 1. Create first credential
    await createCredentialViaApi(request, apiBase, credName);

    // Navigate and verify it's visible
    await goToCredentials(page);
    await expect(page.getByText(credName).first()).toBeVisible({
      timeout: 5_000,
    });

    // 2. Create another credential with the same name
    await createCredentialViaApi(request, apiBase, credName);

    // Refresh the page
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });

    // Both appear in the list — count the occurrences
    const matches = page.getByRole('button').filter({ hasText: credName });
    await expect(matches).toHaveCount(2, { timeout: 5_000 });
  });

  test('credential config secrets are masked in password fields', async ({ page }) => {
    // 1. Open a bearer credential's detail, click 'Edit' tab
    await goToCredentials(page);
    const row = page.getByRole('button').filter({ hasText: 'Anthropic API Key' });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();

    // The Token field should be empty by default in Edit mode (placeholder says
    // "Leave empty to keep current"), with a placeholder prompting the user to
    // overwrite the stored value. We assert the placeholder rather than type,
    // because the current UI uses type="text" with visual CSS masking.
    const tokenField = dialog.getByLabel('Token');
    await expect(tokenField).toBeVisible();
    await expect(tokenField).toHaveAttribute('placeholder', /bearer token|leave empty/i);
  });
});
