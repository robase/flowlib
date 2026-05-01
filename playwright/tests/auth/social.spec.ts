/**
 * Sign-up + social sign-in specs.
 *
 * The shared Vite frontend renders SocialAuthButtons on /sign-up
 * unconditionally (the buttons are client-rendered; the server-side
 * provider configuration is only consulted on click). We assert the
 * buttons render, then intercept the better-auth POST /sign-in/social
 * call so the test never tries to follow OAuth.
 */

import { test, expect } from './fixtures';

test.describe('Sign-up + social sign-in', () => {
  test('renders Google and GitHub social buttons on /sign-up', async ({ page }) => {
    await page.goto('/flowlib/sign-up');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Email/i })).toBeVisible();
  });

  test('Google button POSTs to /sign-in/social with provider=google', async ({ page }) => {
    await page.goto('/flowlib/sign-up');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible({
      timeout: 30_000,
    });

    await page.route('**/sign-in/social', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'social provider not configured for test' }),
      });
    });

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/sign-in/social') && req.method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const request = await requestPromise;

    const body = request.postDataJSON() as { provider?: string; callbackURL?: string };
    expect(body.provider).toBe('google');
    expect(body.callbackURL).toBeTruthy();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });

  test('GitHub button POSTs to /sign-in/social with provider=github', async ({ page }) => {
    await page.goto('/flowlib/sign-up');
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible({
      timeout: 30_000,
    });

    await page.route('**/sign-in/social', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'social provider not configured for test' }),
      });
    });

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/sign-in/social') && req.method() === 'POST',
      { timeout: 15_000 },
    );

    await page.getByRole('button', { name: 'Continue with GitHub' }).click();
    const request = await requestPromise;

    const body = request.postDataJSON() as { provider?: string };
    expect(body.provider).toBe('github');
  });

  test('email step exposes the email input after Continue with Email', async ({ page }) => {
    await page.goto('/flowlib/sign-up');
    await expect(page.getByRole('button', { name: /Continue with Email/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /Continue with Email/i }).click();

    await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Other sign up options' })).toBeVisible();
  });
});
