/**
 * Profile page specs — details tab + name editing.
 */

import { test, expect, ADMIN_EMAIL } from './fixtures';

test.describe('Profile page', () => {
  test('renders the user email and name fields', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(ADMIN_EMAIL).first()).toBeVisible();
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByLabel('Last name')).toBeVisible();
  });

  test('Save changes is disabled when the form is pristine', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await expect(page.getByLabel('First name')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: /Save changes/i })).toBeDisabled();
  });

  test('changing the first name persists across reload', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await expect(page.getByLabel('First name')).toBeVisible({ timeout: 15_000 });

    const newFirst = `Renamed-${Date.now().toString(36)}`;
    await page.getByLabel('First name').fill(newFirst);
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByText('Details updated.')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue(newFirst, { timeout: 15_000 });
  });
});
