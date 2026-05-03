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

test.describe('Credential Usage in Flow Execution', () => {
  test('credential selector appears on nodes that require credentials', async ({
    page,
    navigateToFlow,
    openNodeConfigPanel,
  }) => {
    // 1. Navigate to a flow that contains a node requiring credentials
    await navigateToFlow('Triggered Linear Agent');

    // The flow editor canvas should load with nodes visible
    await expect(page.locator('.react-flow__node').first()).toBeVisible({
      timeout: 10_000,
    });

    // 2. Double-click on a node that has a credential parameter (the Agent node)
    // Agent nodes typically have a credential selector
    const agentNode = page.locator('.react-flow__node').filter({ hasText: /agent/i }).first();

    if (await agentNode.isVisible()) {
      await agentNode.dblclick();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // A credential selector dropdown or field should be visible
      // Look for credential-related UI elements in the config panel
      const credentialField = dialog.locator('text=/credential|api key|model/i');
      await expect(credentialField.first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('credentials page is accessible from the dashboard', async ({ page }) => {
    // 1. Navigate to /flowlib (dashboard)
    await page.goto('/flowlib');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

    // 2. Click the Credentials link in the sidebar navigation (key icon)
    const credsSidebarLink = page.locator('a[href="/flowlib/credentials"]').first();
    await expect(credsSidebarLink).toBeVisible();
    await credsSidebarLink.click();

    // The page navigates to /flowlib/credentials
    await expect(page).toHaveURL(/\/flowlib\/credentials/);
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });

    // Go back to dashboard
    await page.goto('/flowlib');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

    // 3. Click the 'Credentials' button in the dashboard header area
    //    Scope to main content area to avoid matching the sidebar's aria-labeled link
    const credsHeaderLink = page.locator('.fl-page').getByRole('link', { name: 'Credentials' });
    await expect(credsHeaderLink).toBeVisible();
    await credsHeaderLink.click();

    // Navigates to /flowlib/credentials
    await expect(page).toHaveURL(/\/flowlib\/credentials/);
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
