/**
 * Sign-out specs — Profile button + post-signout redirect behaviour.
 */

import { test, expect } from './fixtures';

test.describe('Sign out', () => {
  test('clicking Sign out on the profile page returns to the auth gate', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Sign out' }).first().click();

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Profile' })).toHaveCount(0);
  });

  test('after sign-out, /profile shows the sign-in shell, not the profile page', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/flowlib/profile');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Profile' })).toHaveCount(0);
  });

  test('revoking the current session signs the user out', async ({ page, signInAsAdmin }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();

    const sessionsList = page
      .locator('ul')
      .filter({ has: page.getByRole('button', { name: 'Sign out' }) })
      .first();
    await expect(sessionsList.locator('li').first()).toBeVisible({ timeout: 15_000 });

    // Revoke sessions one at a time — once the current session goes, the
    // app drops back to the auth gate.
    let attempts = 0;
    while (attempts < 5) {
      const remaining = await sessionsList.locator('li').count();
      if (remaining === 0) {
        break;
      }
      await sessionsList.locator('li').first().getByRole('button', { name: 'Sign out' }).click();
      attempts += 1;
      const stillOnProfile = await page
        .getByRole('heading', { name: 'Profile' })
        .isVisible()
        .catch(() => false);
      if (!stillOnProfile) {
        break;
      }
      await page.waitForTimeout(400);
    }

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
