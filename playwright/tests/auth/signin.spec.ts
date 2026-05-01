/**
 * Sign-in flow specs — exercise the auth gate against a real auth backend.
 */

import {
  test,
  expect,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  gotoSignIn,
  waitForFlowlibDashboard,
} from './fixtures';

test.describe('Sign-in flow', () => {
  test('requires email and password before submitting', async ({ page }) => {
    await gotoSignIn(page);

    const submit = page.getByRole('button', { name: 'Sign in' });
    await expect(submit).toBeVisible();

    // Empty fields: HTML5 required keeps us on the sign-in shell.
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Bypass HTML5 validation so the JS guard is what fires.
    await page.evaluate(() => {
      document.querySelectorAll('form').forEach((f) => f.setAttribute('novalidate', ''));
    });
    await page.getByLabel('Email').fill('a@b.test');
    // Password left empty — the form's own check surfaces the inline error.
    await submit.click();
    await expect(page.getByText('Email and password are required')).toBeVisible();
  });

  test('rejects invalid credentials with an inline error', async ({ page }) => {
    await gotoSignIn(page);

    await page.getByLabel('Email').fill('not-a-real-user@example.com');
    await page.getByLabel('Password').fill('wrong-password-1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('valid credentials sign the user in and reach the dashboard', async ({ page }) => {
    await gotoSignIn(page);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await waitForFlowlibDashboard(page);
  });

  test('signed-in users hitting /sign-in are redirected to the dashboard', async ({
    page,
    signInAsAdmin,
  }) => {
    await signInAsAdmin();

    await page.goto('/flowlib/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);
    await waitForFlowlibDashboard(page);
  });

  test('"Forgot password?" link points to /forgot-password', async ({ page }) => {
    // The shared Vite frontend mounts Flowlib without a router basename, so
    // navigating to `/forgot-password` lands outside the Flowlib route. We
    // assert the link's target instead of following it — the rendered
    // ForgotPasswordPage is exercised by hosts that wire Flowlib with a
    // basename (Next.js, hosts using `<BrowserRouter basename>`).
    await gotoSignIn(page);
    const link = page.getByRole('link', { name: 'Forgot password?' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/forgot-password$/);
  });
});
