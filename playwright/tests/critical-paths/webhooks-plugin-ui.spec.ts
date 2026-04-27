import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

type WebhookTriggerRecord = {
  id: string;
  name: string;
  flowId?: string | null;
  isEnabled: boolean;
};

async function getFlowIdByName(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<string | null> {
  const response = await request.get(`${apiBase}/flows/list`);
  if (!response.ok()) {
    return null;
  }

  const payload = await response.json();
  const flows: Array<{ id: string; name: string }> = payload.data ?? payload;
  return flows.find((flow) => flow.name === name)?.id ?? null;
}

async function createFlow(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const response = await request.post(`${apiBase}/flows`, {
    data: { name },
  });
  expect(response.ok()).toBeTruthy();
  const created = await response.json();
  return created.id as string;
}

async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`).catch(() => undefined);
  }
}

async function listWebhookTriggers(
  apiBase: string,
  request: APIRequestContext,
): Promise<WebhookTriggerRecord[]> {
  const response = await request.get(`${apiBase}/plugins/webhooks/triggers`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.data as WebhookTriggerRecord[];
}

async function findWebhookTriggerIdByName(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<string | null> {
  const triggers = await listWebhookTriggers(apiBase, request);
  return triggers.find((trigger) => trigger.name === name)?.id ?? null;
}

async function cleanupWebhookByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await findWebhookTriggerIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/plugins/webhooks/triggers/${id}`).catch(() => undefined);
  }
}

async function createWebhookTrigger(
  apiBase: string,
  request: APIRequestContext,
  input: {
    name: string;
    description?: string;
    flowId?: string;
    allowedMethods?: string;
  },
): Promise<{ id: string }> {
  const response = await request.post(`${apiBase}/plugins/webhooks/triggers`, {
    data: {
      provider: 'generic',
      ...input,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function goToWebhooksPage(page: Page) {
  await page.goto('/flowlib');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.imp-sidebar-shell').getByRole('link', { name: 'Webhooks' }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Webhooks Plugin UI', () => {
  test('can create a webhook from the webhooks page and show the success state', async ({
    page,
    request,
    apiBase,
  }) => {
    const webhookName = `PW Webhook ${Date.now()}`;
    await cleanupWebhookByName(apiBase, request, webhookName);

    await goToWebhooksPage(page);

    await page.getByRole('button', { name: 'New Webhook' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create Webhook' })).toBeVisible({
      timeout: 5_000,
    });

    await expect(dialog.getByRole('button', { name: 'Create Webhook' })).toBeDisabled();

    await dialog.getByLabel('Name *').fill(webhookName);
    await dialog.getByLabel('Description').fill('Playwright webhook management test');
    await dialog.getByLabel('HTTP Methods').selectOption('POST,PUT');

    await dialog.getByRole('button', { name: 'Create Webhook' }).click();

    await expect(dialog.getByText('Webhook Created')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(/\/plugins\/webhooks\/receive\//)).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole('button').filter({ hasText: webhookName })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('supports search, status filters, detail view, and linked flow navigation', async ({
    page,
    request,
    apiBase,
  }) => {
    const timestamp = Date.now();
    const linkedFlowName = `PW Linked Flow ${timestamp}`;
    const linkedWebhookName = `PW Linked Webhook ${timestamp}`;
    const disabledWebhookName = `PW Disabled Webhook ${timestamp}`;

    await cleanupWebhookByName(apiBase, request, linkedWebhookName);
    await cleanupWebhookByName(apiBase, request, disabledWebhookName);
    await cleanupFlowByName(apiBase, request, linkedFlowName);

    const flowId = await createFlow(apiBase, request, linkedFlowName);
    const linkedTrigger = await createWebhookTrigger(apiBase, request, {
      name: linkedWebhookName,
      description: 'Linked to a flow for navigation coverage',
      flowId,
      allowedMethods: 'POST',
    });
    const disabledTrigger = await createWebhookTrigger(apiBase, request, {
      name: disabledWebhookName,
      description: 'Disabled webhook for filter coverage',
      allowedMethods: 'ANY',
    });

    const disableResponse = await request.put(
      `${apiBase}/plugins/webhooks/triggers/${disabledTrigger.id}`,
      { data: { isEnabled: false } },
    );
    expect(disableResponse.ok()).toBeTruthy();

    await goToWebhooksPage(page);

    const searchInput = page.getByPlaceholder('Search webhooks…');
    await searchInput.fill(linkedFlowName);
    await expect(page.getByRole('button').filter({ hasText: linkedWebhookName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button').filter({ hasText: disabledWebhookName }),
    ).not.toBeVisible();

    await searchInput.clear();

    await page.getByRole('button', { name: /Enabled \(/ }).click();
    await expect(page.getByRole('button').filter({ hasText: linkedWebhookName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button').filter({ hasText: disabledWebhookName }),
    ).not.toBeVisible();

    await page.getByRole('button', { name: /Disabled \(/ }).click();
    await expect(page.getByRole('button').filter({ hasText: disabledWebhookName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button').filter({ hasText: linkedWebhookName })).not.toBeVisible();

    await page.getByRole('button', { name: /All \(/ }).click();

    await page.getByRole('button').filter({ hasText: linkedWebhookName }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(linkedWebhookName)).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Webhook URL')).toBeVisible();
    await expect(dialog.getByText('Linked Flow', { exact: true })).toBeVisible();

    const flowLink = dialog.getByRole('link', { name: linkedFlowName });
    await expect(flowLink).toBeVisible();
    await flowLink.click();

    await expect(page).toHaveURL(new RegExp(`/flowlib/flow/${flowId}$`), { timeout: 10_000 });

    const triggerStillExists = await request.get(
      `${apiBase}/plugins/webhooks/triggers/${linkedTrigger.id}`,
    );
    expect(triggerStillExists.ok()).toBeTruthy();
  });
});
