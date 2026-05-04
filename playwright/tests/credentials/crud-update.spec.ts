// spec: specs/credential-management.plan.md
// seed: tests/seed.spec.ts

import { test, expect } from '../fixtures';
const CRED_NAME = 'Update Test Cred';

/** Helper: navigate to /flowlib/credentials and wait for the page to load */
async function goToCredentials(page: import('@playwright/test').Page) {
  await page.goto('/flowlib/credentials');
  await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Helper: open the detail dialog for a credential by name */
async function openCredentialDetail(page: import('@playwright/test').Page, name: string) {
  const row = page.getByRole('button').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}

/** Helper: delete all credentials matching a list of names */
async function cleanupCredentials(
  request: import('@playwright/test').APIRequestContext,
  apiBase: string,
  names: string[],
) {
  const list = await request.get(`${apiBase}/credentials`);
  if (!list.ok()) {
    return;
  }
  const creds: Array<{ id: string; name: string }> = await list.json();
  for (const c of creds) {
    if (names.includes(c.name)) {
      await request.delete(`${apiBase}/credentials/${c.id}`);
    }
  }
}

test.describe('Credential CRUD — Update', () => {
  // Use serial mode since tests share and mutate the same credential
  test.describe.configure({ mode: 'serial' });

  // Create a fresh credential before this suite, and clean up after
  test.beforeAll(async ({ request, apiBase }) => {
    await cleanupCredentials(request, apiBase, [CRED_NAME, 'Update Test Cred (Renamed)']);
    const resp = await request.post(`${apiBase}/credentials`, {
      data: {
        name: CRED_NAME,
        type: 'http-api',
        authType: 'bearer',
        config: { token: 'update-test-token' },
        description: 'Credential for update tests',
      },
    });
    expect(resp.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request, apiBase }) => {
    await cleanupCredentials(request, apiBase, [CRED_NAME, 'Update Test Cred (Renamed)']);
  });

  test('edit credential name and description', async ({ page }) => {
    // 1. Navigate and open the test credential's detail
    await goToCredentials(page);
    await openCredentialDetail(page, CRED_NAME);

    const dialog = page.getByRole('dialog');

    // Overview tab visible by default
    await expect(dialog.getByText('Test Connection')).toBeVisible();

    // 2. Click the 'Edit' tab
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();

    // Edit form shows with Name pre-populated
    const nameInput = dialog.getByLabel('Name *');
    await expect(nameInput).toHaveValue(CRED_NAME);

    // 3. Change Name and Description
    await nameInput.clear();
    await nameInput.fill('Update Test Cred (Renamed)');
    const descInput = dialog.getByLabel('Description');
    await descInput.clear();
    await descInput.fill('Updated description');

    // 4. Click 'Save Changes'
    await dialog.getByRole('button', { name: 'Save Changes' }).click();

    // 5. Close the dialog and verify the list reflects the update
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // The list shows the updated name
    await expect(page.getByText('Update Test Cred (Renamed)')).toBeVisible();

    // Re-open the renamed credential to verify the updated title in a fresh dialog instance
    await openCredentialDetail(page, 'Update Test Cred (Renamed)');
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Update Test Cred (Renamed)' }),
    ).toBeVisible({ timeout: 5_000 });

    // Rename it back for subsequent tests
    await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
    const restoreName = page.getByRole('dialog').getByLabel('Name *');
    await restoreName.clear();
    await restoreName.fill(CRED_NAME);
    await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: CRED_NAME })).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press('Escape');
  });

  test('toggle credential active/inactive status', async ({ page, request, apiBase }) => {
    // 1. Navigate and open the test credential's detail dialog
    await goToCredentials(page);
    await openCredentialDetail(page, CRED_NAME);

    const dialog = page.getByRole('dialog');

    // Overview shows 'Active' status badge
    await expect(dialog.getByText('Active')).toBeVisible();

    // The Save Changes click only dispatches the click event — the mutation
    // hook fires the PUT asynchronously, and the dialog switches back to
    // Overview *before* the response lands. Wait on the PUT response itself
    // so the subsequent GET observes the persisted state.
    const waitForCredentialPut = () =>
      page.waitForResponse(
        (resp) =>
          /\/credentials\/[^/]+$/.test(new URL(resp.url()).pathname) &&
          resp.request().method() === 'PUT',
      );

    // 2. Click 'Edit' tab, uncheck the 'Active' checkbox
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const activeCheckbox = dialog.getByLabel('Active');
    await expect(activeCheckbox).toBeChecked();
    await activeCheckbox.uncheck();
    await expect(activeCheckbox).not.toBeChecked();

    // 3. Click 'Save Changes' and wait for the PUT to complete
    const disablePut = waitForCredentialPut();
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await disablePut;

    // Backend state should now reflect the inactive status.
    const listAfterDisable = await request.get(`${apiBase}/credentials`);
    expect(listAfterDisable.ok()).toBeTruthy();
    const credentialsAfterDisable: Array<{ name: string; isActive?: boolean }> =
      await listAfterDisable.json();
    expect(
      credentialsAfterDisable.find((credential) => credential.name === CRED_NAME)?.isActive,
    ).toBe(false);

    // 4. Click 'Edit' again, re-check 'Active', save
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.getByLabel('Active').check();
    const enablePut = waitForCredentialPut();
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await enablePut;

    const listAfterEnable = await request.get(`${apiBase}/credentials`);
    expect(listAfterEnable.ok()).toBeTruthy();
    const credentialsAfterEnable: Array<{ name: string; isActive?: boolean }> =
      await listAfterEnable.json();
    expect(
      credentialsAfterEnable.find((credential) => credential.name === CRED_NAME)?.isActive,
    ).toBe(true);
  });

  test('edit cancel discards changes', async ({ page }) => {
    // 1. Open a credential detail dialog, go to 'Edit' tab
    await goToCredentials(page);
    await openCredentialDetail(page, CRED_NAME);

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();

    // Edit form is shown
    const nameInput = dialog.getByLabel('Name *');
    const originalName = await nameInput.inputValue();

    // 2. Change the Name field
    await nameInput.clear();
    await nameInput.fill('Totally Different Name');
    await expect(nameInput).toHaveValue('Totally Different Name');

    // 3. Click 'Cancel'
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // View returns to Overview tab with the original credential name
    await expect(dialog.getByRole('heading', { name: originalName })).toBeVisible({
      timeout: 5_000,
    });
  });
});
