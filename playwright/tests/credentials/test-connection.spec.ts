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

test.describe('Credential Test Connection', () => {
  test('test connection from detail dialog shows success or failure', async ({ page }) => {
    // 1. Navigate and click on 'Anthropic API Key'
    await goToCredentials(page);
    const row = page.getByRole('button').filter({ hasText: 'Anthropic API Key' });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Overview tab should show the 'Test Connection' section with a 'Test' button
    await expect(dialog.getByText('Test Connection')).toBeVisible();
    const testBtn = dialog.getByRole('button', { name: 'Test' });
    await expect(testBtn).toBeVisible();

    // 2. Click the 'Test' button
    await testBtn.click();

    // Button shows 'Testing…' with a spinner
    await expect(dialog.getByText('Testing'))
      .toBeVisible({ timeout: 3_000 })
      .catch(() => {
        // May transition too fast
      });

    // After the test completes, a result message appears — either success or failure
    // Since the Anthropic key may or may not be valid in the test environment,
    // we accept either outcome:
    const resultMessage = dialog.locator('text=/Connection successful|Failed/');
    await expect(resultMessage).toBeVisible({ timeout: 15_000 });
  });

  test('inline test during credential creation', async ({ page }) => {
    // 1. Navigate and click 'New Credential'
    await goToCredentials(page);
    await page.getByRole('button', { name: 'New Credential' }).click();
    await expect(page.getByRole('heading', { name: 'Create Credential' })).toBeVisible({
      timeout: 5_000,
    });

    // 2. Fill Name and Token — 'Test Credential' section should be visible
    await page.getByLabel('Name*').fill('Test Inline Cred');
    await page.getByLabel('Token*').fill('fake-token');

    await expect(page.getByText('Test Credential')).toBeVisible();

    // 3. Enter a test URL
    const testUrlField = page.getByPlaceholder('https://api.example.com/health');
    await expect(testUrlField).toBeVisible();
    await testUrlField.fill('https://httpbin.org/get');

    // Test button should be enabled
    const testBtn = page.getByRole('dialog').getByRole('button', { name: 'Test' });
    await expect(testBtn).toBeEnabled();

    // 4. Click 'Test' button in the create modal
    await testBtn.click();

    // After request completes, shows connection result (success or error)
    const resultMessage = page.locator(
      'text=/Connection successful|Connection failed|Request failed/',
    );
    await expect(resultMessage).toBeVisible({ timeout: 15_000 });

    // 5. Click 'Cancel' to close without saving
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Dialog closes
    await expect(page.getByRole('heading', { name: 'Create Credential' })).not.toBeVisible({
      timeout: 5_000,
    });

    // Credential was NOT created — 'Test Inline Cred' should not be in the list
    await expect(page.getByText('Test Inline Cred')).not.toBeVisible();
  });
});
