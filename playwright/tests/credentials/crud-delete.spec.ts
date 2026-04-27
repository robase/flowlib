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
) {
  const resp = await request.post(`${apiBase}/credentials`, {
    data: {
      name,
      type: 'http-api',
      authType: 'bearer',
      config: { token: 'test-token-for-delete' },
    },
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

test.describe('Credential CRUD — Delete', () => {
  test('delete a credential with confirmation', async ({ page, request, apiBase }) => {
    const credName = 'Cred To Delete';
    // Cleanup first, then create fresh
    await cleanupCredentialByName(request, apiBase, credName);
    await createCredentialViaApi(request, apiBase, credName);

    // 1. Navigate to /flowlib/credentials — 'Cred To Delete' appears in the list
    await goToCredentials(page);
    await expect(page.getByText(credName)).toBeVisible({ timeout: 5_000 });

    // 2. Click on 'Cred To Delete' to open detail dialog
    const row = page.getByRole('button').filter({ hasText: credName });
    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 3. Click the 'Delete' button at the bottom of the Overview tab
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // A confirmation dialog appears
    await expect(page.getByRole('heading', { name: 'Delete Credential?' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(`Are you sure you want to delete "${credName}"`)).toBeVisible();

    // 4. Click 'Delete' in the confirmation dialog
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

    // Both dialogs close
    await expect(page.getByRole('heading', { name: 'Delete Credential?' })).not.toBeVisible({
      timeout: 5_000,
    });

    // 'Cred To Delete' is removed from the credentials list
    await expect(page.getByText(credName)).not.toBeVisible({ timeout: 5_000 });
  });

  test('cancel delete preserves the credential', async ({ page, request, apiBase }) => {
    const credName = 'Cancel Delete Test Cred';
    // Create our own credential so we don't depend on seeded data
    await cleanupCredentialByName(request, apiBase, credName);
    await createCredentialViaApi(request, apiBase, credName);

    // 1. Navigate and open the credential's detail dialog
    await goToCredentials(page);
    await expect(page.getByText(credName)).toBeVisible({ timeout: 5_000 });

    const row = page.getByRole('button').filter({ hasText: credName });
    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 2. Click 'Delete' button
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // Confirmation dialog appears
    await expect(page.getByRole('heading', { name: 'Delete Credential?' })).toBeVisible({
      timeout: 5_000,
    });

    // 3. Click 'Cancel' in the confirmation dialog
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

    // Confirmation dialog closes
    await expect(page.getByRole('heading', { name: 'Delete Credential?' })).not.toBeVisible({
      timeout: 5_000,
    });

    // Detail dialog remains open
    await expect(dialog).toBeVisible();

    // Close the detail dialog
    await page.keyboard.press('Escape');

    // The credential still exists in the list
    await expect(page.getByText(credName)).toBeVisible();
  });
});
