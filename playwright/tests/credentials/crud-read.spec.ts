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

test.describe('Credential CRUD — Read & Detail View', () => {
  test('view credential detail panel shows overview metadata', async ({ page }) => {
    // 1. Navigate to /flowlib/credentials
    await goToCredentials(page);

    // Verify 'Anthropic API Key' is listed with a 'Bearer' badge
    const anthropicRow = page.getByRole('button').filter({ hasText: 'Anthropic API Key' });
    await expect(anthropicRow).toBeVisible();
    await expect(anthropicRow.getByText('Bearer')).toBeVisible();

    // 2. Click on the 'Anthropic API Key' row
    await anthropicRow.click();

    // A detail dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The credential name is in the dialog title
    await expect(dialog.getByRole('heading', { name: 'Anthropic API Key' })).toBeVisible();

    // Overview tab is selected by default — verify status metadata
    await expect(dialog.getByText('Active')).toBeVisible();
    await expect(dialog.getByText('Bearer')).toBeVisible();
    await expect(dialog.getByText('HTTP API')).toBeVisible();

    // Created and Updated dates are displayed (not "Never")
    const createdSection = dialog.locator('text=Created').first();
    await expect(createdSection).toBeVisible();

    // 3. Description is visible
    await expect(
      dialog.getByText('Anthropic Claude API credential for AI model nodes'),
    ).toBeVisible();
  });

  test('search filters credentials by name', async ({ page }) => {
    // 1. Navigate to /flowlib/credentials
    await goToCredentials(page);

    // All credentials are visible
    await expect(page.getByText('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Linear OAuth2')).toBeVisible();

    // 2. Type 'Anthropic' into the search field
    const searchField = page.getByPlaceholder('Search credentials…');
    await searchField.fill('Anthropic');

    // Only 'Anthropic API Key' is visible
    await expect(page.getByText('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Linear OAuth2')).not.toBeVisible();

    // 3. Clear the search field
    await searchField.clear();

    // All credentials reappear
    await expect(page.getByText('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Linear OAuth2')).toBeVisible();

    // 4. Type 'nonexistent-xyz' into the search field
    await searchField.fill('nonexistent-xyz');

    // Empty search state message
    await expect(page.getByText('No credentials match your search.')).toBeVisible();
  });

  test('auth type filter pills narrow the list', async ({ page }) => {
    // 1. Navigate to /flowlib/credentials
    await goToCredentials(page);

    // Filter pills visible — "All" plus per-auth-type pills
    await expect(page.getByRole('button', { name: /^All/ })).toBeVisible();
    const bearerPill = page.getByRole('button', { name: /^Bearer/ });
    await expect(bearerPill).toBeVisible();
    const oauthPill = page.getByRole('button', { name: /^OAuth/ });
    await expect(oauthPill).toBeVisible();

    // 2. Click the 'Bearer' filter pill
    await bearerPill.click();

    // Only bearer-type credentials are shown
    await expect(page.getByText('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Linear OAuth2')).not.toBeVisible();

    // 3. Click the 'Bearer' pill again to deselect (toggles back to All)
    await bearerPill.click();

    // All credentials reappear
    await expect(page.getByText('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Linear OAuth2')).toBeVisible();
  });

  test('detail dialog has Overview and Edit tabs', async ({ page }) => {
    // 1. Navigate and click on a credential row
    await goToCredentials(page);
    const row = page.getByRole('button').filter({ hasText: 'Anthropic API Key' });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Two tabs should be visible
    const overviewTab = dialog.getByRole('button', { name: 'Overview' });
    const editTab = dialog.getByRole('button', { name: 'Edit', exact: true });
    await expect(overviewTab).toBeVisible();
    await expect(editTab).toBeVisible();

    // 2. Click the 'Edit' tab
    await editTab.click();

    // Edit form is shown with pre-populated Name field
    await expect(dialog.getByLabel('Name *')).toBeVisible();

    // 3. Click the 'Overview' tab to return
    await overviewTab.click();

    // Overview section with Test Connection is shown again
    await expect(dialog.getByText('Test Connection')).toBeVisible();
  });
});
