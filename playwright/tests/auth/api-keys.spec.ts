/**
 * API keys card specs — list, create, delete.
 *
 * The auth test server boots with `auth({ apiKey: true, ... })`, so the
 * /flowlib/plugins/auth/api-keys endpoints come online and the ApiKeysCard
 * skips its "not enabled" notice.
 */

import { test, expect, uniqueValue } from './fixtures';

test.describe('API keys', () => {
  test.describe.configure({ mode: 'serial' });

  test('starts empty and shows the per-user limit', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();

    await expect(page.getByRole('heading', { name: 'Your API keys' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/API keys are not enabled/i)).toHaveCount(0);
    await expect(page.getByText(/(\d+)\/\d+/)).toBeVisible();
    await expect(page.getByText(/No API keys yet/i)).toBeVisible();
  });

  test('creating an API key reveals the full token once and lists it', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();
    await expect(page.getByRole('heading', { name: 'Your API keys' })).toBeVisible({
      timeout: 15_000,
    });

    const keyName = uniqueValue('Playwright Key');
    await page.getByRole('button', { name: 'New' }).click();

    const form = page.locator('form').filter({ hasText: 'Name' });
    await form.getByLabel('Name').fill(keyName);
    await form.getByLabel('Expires').selectOption('86400');
    await form.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText(/copy it now/i)).toBeVisible({ timeout: 15_000 });
    const tokenText = await page.locator('code').first().innerText();
    expect(tokenText.length).toBeGreaterThan(8);

    await expect(page.getByRole('cell', { name: keyName })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'active' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText(/copy it now/i)).toHaveCount(0);
  });

  test('deleting an API key requires explicit confirmation', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();
    await expect(page.getByRole('heading', { name: 'Your API keys' })).toBeVisible({
      timeout: 15_000,
    });

    const keyName = uniqueValue('Delete Me');
    await page.getByRole('button', { name: 'New' }).click();
    const form = page.locator('form').filter({ hasText: 'Name' });
    await form.getByLabel('Name').fill(keyName);
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(/copy it now/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Dismiss' }).click();

    const row = page.getByRole('row').filter({ hasText: keyName });
    await expect(row).toBeVisible();

    // First click → confirm-state.
    await row.getByRole('button', { name: 'Delete API key' }).click();
    await expect(row.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // Cancel returns to default state.
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByRole('button', { name: 'Delete API key' })).toBeVisible();

    // Confirm deletes.
    await row.getByRole('button', { name: 'Delete API key' }).click();
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('row').filter({ hasText: keyName })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
