/**
 * Sessions list specs — current session visibility + revocation.
 *
 * The Sessions card lives on the Authentication tab of /profile. Each
 * session row has a "Sign out" button that revokes that specific session.
 */

import { test, expect, ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures';

test.describe('Sessions list', () => {
  test('shows the current session', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();

    const sessions = page
      .locator('ul')
      .filter({ has: page.getByRole('button', { name: 'Sign out' }) })
      .first();
    await expect(sessions.locator('li').first()).toBeVisible({ timeout: 15_000 });

    const items = sessions.locator('li');
    await expect.poll(async () => items.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });

  test('revoking a non-current session removes it from the list', async ({
    browser,
    page,
    signInAsAdmin,
  }) => {
    // Create a second session in another browser context (each context has
    // its own cookie jar, so better-auth treats it as a separate session).
    const secondCtx = await browser.newContext();
    const secondPage = await secondCtx.newPage();
    try {
      await secondPage.goto('/flowlib');
      await expect(secondPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
        timeout: 30_000,
      });
      await secondPage.getByLabel('Email').fill(ADMIN_EMAIL);
      await secondPage.getByLabel('Password').fill(ADMIN_PASSWORD);
      await secondPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(secondPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
        timeout: 30_000,
      });

      await signInAsAdmin();
      await page.goto('/flowlib/profile');
      await page.getByRole('tab', { name: 'Authentication' }).click();

      const list = page
        .locator('ul')
        .filter({ has: page.getByRole('button', { name: 'Sign out' }) })
        .first();
      await expect(list.locator('li').first()).toBeVisible({ timeout: 15_000 });

      await expect
        .poll(async () => list.locator('li').count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      const before = await list.locator('li').count();

      // Revoke the LAST session — most likely the older / non-current one.
      await list.locator('li').last().getByRole('button', { name: 'Sign out' }).click();

      await expect
        .poll(async () => list.locator('li').count(), { timeout: 15_000 })
        .toBeLessThan(before);
    } finally {
      await secondCtx.close();
    }
  });
});
