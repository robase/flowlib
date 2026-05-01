/**
 * Sessions list specs — current session visibility + revocation.
 *
 * The Sessions card lives on the Authentication tab of /profile. Each
 * session row has a "Sign out" button that revokes that specific session.
 *
 * To test "revoke a non-current session" we create a second session via a
 * direct API call (sign-in/email against the auth server) — that's enough
 * to populate the sessions table; the UI then shows the new row alongside
 * the current one.
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
    page,
    signInAsAdmin,
    authServer,
  }) => {
    await signInAsAdmin();

    // Create a second session by signing in with a separate cookie jar.
    // We hit the auth test server directly so we don't have to install the
    // route interception on a fresh BrowserContext just to authenticate.
    // The Origin header has to match the auth plugin's trustedOrigins list.
    const trustedOrigin = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';
    const second = await fetch(
      `${authServer.serverUrl}/flowlib/plugins/auth/api/auth/sign-in/email`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          'user-agent': 'playwright-second-session',
        },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      },
    );
    expect(
      second.ok,
      `second sign-in failed: ${second.status} ${await second.text()}`,
    ).toBeTruthy();

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
    await list.locator('li').last().getByRole('button', { name: 'Sign out' }).click();

    await expect
      .poll(async () => list.locator('li').count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });
});
