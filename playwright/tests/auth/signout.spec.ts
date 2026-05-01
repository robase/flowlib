/**
 * Sign-out specs.
 *
 * On click, the auth plugin's DetailsTab fires `signOut.mutate()` and then
 * `navigate('/sign-in')`. The shared Vite frontend doesn't mount Flowlib
 * with a router basename, so the post-signout `navigate('/sign-in')` lands
 * outside the Flowlib route. To stay decoupled from that host quirk we
 * assert the auth-state change directly: after the click, polling
 * `/get-session` returns `null` and the cookie cache is gone.
 */

import { test, expect } from './fixtures';

async function getSession(page: import('@playwright/test').Page): Promise<unknown> {
  // Run the fetch from the page so it goes through Playwright's route
  // interception (which forwards to the worker-local auth server) and uses
  // the browser context's cookie jar.
  return page.evaluate(async () => {
    const res = await fetch('/api/flowlib/plugins/auth/api/auth/get-session', {
      credentials: 'include',
    });
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    if (!text || text === 'null') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

test.describe('Sign out', () => {
  test('clicking Sign out on the profile page invalidates the session', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 });

    // Sanity check: an authenticated session exists before the click.
    const before = await getSession(page);
    expect(before).not.toBeNull();

    await page.getByRole('button', { name: 'Sign out' }).first().click();

    // The mutation flushes the session; poll until the server agrees.
    await expect.poll(async () => await getSession(page), { timeout: 15_000 }).toBeNull();
  });

  test('after sign-out, navigating back to /flowlib lands on the auth gate', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect.poll(async () => await getSession(page), { timeout: 15_000 }).toBeNull();

    // Going back to the Flowlib mount with no session shows the sign-in form.
    await page.goto('/flowlib');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Profile' })).toHaveCount(0);
  });

  test('revoking the current session removes it from the sessions list', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();
    await page.goto('/flowlib/profile');
    await page.getByRole('tab', { name: 'Authentication' }).click();

    const sessionsList = page
      .locator('ul')
      .filter({ has: page.getByRole('button', { name: 'Sign out' }) })
      .first();
    await expect(sessionsList.locator('li').first()).toBeVisible({ timeout: 15_000 });

    // Revoke all rows. With a fresh worker there's only the current
    // session; clicking its "Sign out" should bring the count to zero.
    // (Note: better-auth caches the session payload in a `session_data`
    // cookie for ~5 min, so /get-session can keep returning the cached
    // user even after the DB row is gone — that's why we assert against
    // the rendered list instead of the API.)
    const initial = await sessionsList.locator('li').count();
    for (let i = 0; i < initial + 2; i++) {
      const remaining = await sessionsList
        .locator('li')
        .count()
        .catch(() => 0);
      if (remaining === 0) {
        break;
      }
      await sessionsList
        .locator('li')
        .first()
        .getByRole('button', { name: 'Sign out' })
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
    }

    await expect
      .poll(
        async () =>
          sessionsList
            .locator('li')
            .count()
            .catch(() => 0),
        { timeout: 15_000 },
      )
      .toBe(0);
  });
});
