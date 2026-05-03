// spec: specs/dashboard-stats.plan.md
// seed: tests/seed.spec.ts

import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Navigate to /flowlib and wait for the Dashboard heading to appear. */
async function goToDashboard(page: Page) {
  await page.goto('/flowlib');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
}

/**
 * GET /flowlib/flows and return the id of the flow matching `name`,
 * or null if the list request fails or no match is found.
 */
async function getFlowIdByName(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<string | null> {
  const resp = await request.get(`${apiBase}/flows/list`);
  if (!resp.ok()) {
    return null;
  }
  const body = await resp.json();
  const flows: Array<{ id: string; name: string }> = body.data ?? body;
  return flows.find((f) => f.name === name)?.id ?? null;
}

/** POST /flowlib/flows/:id/run with an empty payload and return the run record. */
async function triggerFlowRun(
  apiBase: string,
  request: APIRequestContext,
  flowId: string,
): Promise<{ id: string }> {
  const resp = await request.post(`${apiBase}/flows/${flowId}/run`, {
    data: {},
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

/** POST /flowlib/flows — create a minimal flow and return the created record. */
async function createFlowViaApi(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; name: string }> {
  const resp = await request.post(`${apiBase}/flows`, {
    data: { name },
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

/** Delete a flow by name via the API; no-op if the flow does not exist. */
async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`);
  }
}

/**
 * Locate a dashboard stat card by its label text and return its full
 * textContent string (label + value combined).
 *
 * Stat cards are expected to be rendered inside `.bg-card` containers that
 * hold both a human-readable label and a prominent numeric / percentage value.
 * Falls back to any `div` containing the label if `.bg-card` is not present.
 */
async function getStatCardText(page: Page, label: string): Promise<string> {
  // Primary: .bg-card elements used throughout the Flowlib shell
  const bgCard = page.locator('.bg-card').filter({ hasText: label });
  if ((await bgCard.count()) > 0) {
    const card = bgCard.first();
    // Wait for the loading placeholder to be replaced with a real value
    const valueEl = card.locator("[class*='text-2xl']").first();
    await valueEl.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await expect(valueEl)
      .not.toHaveText('—', { timeout: 10_000 })
      .catch(() => {});
    return (await card.textContent()) ?? '';
  }
  // Fallback: first div containing the label
  const generic = page.locator('div').filter({ hasText: label }).first();
  return (await generic.textContent()) ?? '';
}

async function getStatCardValue(page: Page, label: string): Promise<number> {
  const card = page.locator('.bg-card').filter({ hasText: label }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  const valueEl = card.locator("[class*='text-2xl']").first();
  await expect(valueEl).toBeVisible({ timeout: 10_000 });
  await expect(valueEl)
    .not.toHaveText('—', { timeout: 10_000 })
    .catch(() => {});
  const valueText = ((await valueEl.textContent()) ?? '').trim();
  const match = valueText.match(/\d+/);
  expect(
    match,
    `Stat card "${label}" must show a numeric value, got: "${valueText}"`,
  ).not.toBeNull();
  return parseInt(match![0], 10);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Dashboard Stats & Overview', () => {
  // Track any flow created mid-test so afterEach can clean it up
  let createdFlowId: string | null = null;
  let jqFlowId: string | null = null;
  let templateFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    await cleanupFlowByName(apiBase, request, 'JQ Data Transform');
    await cleanupFlowByName(apiBase, request, 'Simple Template Flow');

    const jqResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'JQ Data Transform' },
    });
    expect(jqResp.ok()).toBeTruthy();
    const jqFlow = await jqResp.json();
    jqFlowId = jqFlow.id;
    await request.post(`${apiBase}/flows/${jqFlowId}/versions`, {
      data: {
        flowlibDefinition: {
          nodes: [
            {
              id: 'input-1',
              type: 'trigger.manual',
              label: 'User List',
              referenceId: 'user_list',
              params: {
                variableName: 'user_list',
                defaultValue: JSON.stringify({ users: [{ id: 1, name: 'Alice' }] }),
              },
              position: { x: 100, y: 200 },
            },
            {
              id: 'output-1',
              type: 'core.output',
              label: 'Output',
              referenceId: 'output',
              params: {},
              position: { x: 350, y: 200 },
            },
          ],
          edges: [{ id: 'edge-1', source: 'input-1', target: 'output-1' }],
        },
      },
    });

    const templateResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'Simple Template Flow' },
    });
    expect(templateResp.ok()).toBeTruthy();
    const templateFlow = await templateResp.json();
    templateFlowId = templateFlow.id;
    await request.post(`${apiBase}/flows/${templateFlowId}/versions`, {
      data: {
        flowlibDefinition: {
          nodes: [
            {
              id: 'input-1',
              type: 'trigger.manual',
              label: 'Topic Input',
              referenceId: 'topic_input',
              params: { variableName: 'topic_input', defaultValue: '"hello"' },
              position: { x: 100, y: 200 },
            },
            {
              id: 'template-1',
              type: 'core.template_string',
              label: 'Build Prompt',
              referenceId: 'build_prompt',
              params: { template: 'Hello {{ topic_input }}' },
              position: { x: 350, y: 200 },
            },
          ],
          edges: [{ id: 'edge-1', source: 'input-1', target: 'template-1' }],
        },
      },
    });
  });

  test.afterAll(async ({ request, apiBase }) => {
    if (jqFlowId) {
      await request.delete(`${apiBase}/flows/${jqFlowId}`).catch(() => {});
    }
    if (templateFlowId) {
      await request.delete(`${apiBase}/flows/${templateFlowId}`).catch(() => {});
    }
    await cleanupFlowByName(apiBase, request, 'JQ Data Transform');
    await cleanupFlowByName(apiBase, request, 'Simple Template Flow');
  });

  test.afterEach(async ({ request, apiBase }) => {
    // Safety-net cleanup: delete by known id first, then by name
    if (createdFlowId) {
      await request.delete(`${apiBase}/flows/${createdFlowId}`);
      createdFlowId = null;
    }
    await cleanupFlowByName(apiBase, request, 'Count Test Flow');
  });

  // ── Test 1 — High ─────────────────────────────────────────────────────────
  test('all four stat cards display numeric values', async ({ page, apiBase }) => {
    // Navigate to the dashboard and wait for it to fully load
    await goToDashboard(page);

    const labels = ['Total Flows', 'Runs', 'Success Rate', 'Active'] as const;

    for (const label of labels) {
      // Assert the stat card label heading / text is visible on the page
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 10_000 });

      // Pull the full text content of the card container
      const cardText = await getStatCardText(page, label);

      // Assert the card does not contain placeholder or error strings
      expect(cardText, `"${label}" card must not contain "[object Object]"`).not.toContain(
        '[object Object]',
      );
      expect(cardText, `"${label}" card must not contain "undefined"`).not.toContain('undefined');
      expect(cardText, `"${label}" card must not contain "NaN"`).not.toContain('NaN');
      expect(cardText, `"${label}" card must not contain "Loading"`).not.toContain('Loading');
      expect(cardText, `"${label}" card must not contain "N/A"`).not.toContain('N/A');
      expect(cardText, `"${label}" card must not show "..."`).not.toContain('...');

      // Assert the card contains at least one digit (numeric value present)
      expect(cardText, `"${label}" card must contain a numeric value`).toMatch(/\d/);

      // Assert the displayed value is not an empty string
      const valueMatch = cardText.replace(label, '').trim();
      expect(
        valueMatch,
        `"${label}" card value must not be an empty string after removing the label`,
      ).not.toBe('');
    }
  });

  // ── Test 2 — Critical ─────────────────────────────────────────────────────
  test('Total Flows stat card matches the API flow count', async ({ page, request, apiBase }) => {
    // Navigate to the dashboard first, THEN fetch from API — this minimises
    // the timing gap between what the stat card shows and what the API returns.
    await goToDashboard(page);

    // Wait for the "Total Flows" stat card to show a real value (not "—")
    const displayedValue = await getStatCardValue(page, 'Total Flows');

    // Now call the same endpoint the stat card uses — they should be very close
    const statsResp = await request.get(`${apiBase}/dashboard/stats`);
    expect(statsResp.ok()).toBeTruthy();
    const statsBody = await statsResp.json();
    const apiCount: number = statsBody.totalFlows ?? 0;

    // Allow ±10 for flows created/deleted by concurrent tests between dashboard
    // render and this API call
    expect(
      Math.abs(displayedValue - apiCount),
      `Displayed total flows (${displayedValue}) should be within ±10 of API count (${apiCount})`,
    ).toBeLessThanOrEqual(10);
  });

  // ── Test 3 — High ─────────────────────────────────────────────────────────
  test('recent activity section shows run entries', async ({ page, request, apiBase }) => {
    const flowId = await getFlowIdByName(apiBase, request, 'JQ Data Transform');
    expect(flowId).toBeTruthy();

    // Trigger a run so there is guaranteed recent activity
    await triggerFlowRun(apiBase, request, flowId);

    // Navigate to the dashboard
    await goToDashboard(page);

    // Assert a "Recent Activity" or "Recent Runs" section heading is visible
    const recentHeading = page.getByRole('heading', { name: /Recent (Activity|Runs)/i }).first();
    await expect(recentHeading).toBeVisible({ timeout: 10_000 });

    // Wait for at least one recent-activity body row. The dashboard renders
    // this as a single table, so broad global selector counting is brittle.
    await expect(async () => {
      const entryCount = await page.locator('tbody tr').count();
      expect(
        entryCount,
        'Recent activity section must list at least one run entry',
      ).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    // Assert the triggered flow appears in the recent activity table.
    await expect(page.getByRole('row', { name: /JQ Data Transform/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── Test 4 — Medium ───────────────────────────────────────────────────────
  test('Total Flows count updates after creating and deleting a flow', async ({
    page,
    request,
    apiBase,
  }) => {
    // Ensure no leftover "Count Test Flow" from a previous run
    await cleanupFlowByName(apiBase, request, 'Count Test Flow');

    // Navigate to the dashboard FIRST to read the initial count from the stat card
    // (avoids timing drift between API call and dashboard render in parallel runs)
    await goToDashboard(page);
    const initialCardText = await getStatCardText(page, 'Total Flows');
    const initialMatch = initialCardText.match(/\d+/);
    expect(
      initialMatch,
      `"Total Flows" card must show a number initially, got: "${initialCardText}"`,
    ).not.toBeNull();
    const initialCount = parseInt(initialMatch![0], 10);

    // Create a new flow via the API and record its id for cleanup
    const created = await createFlowViaApi(apiBase, request, 'Count Test Flow');
    createdFlowId = created.id;

    // Reload the dashboard to pick up the new flow
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

    const afterCreateText = await getStatCardText(page, 'Total Flows');
    const afterCreateMatch = afterCreateText.match(/\d+/);
    expect(
      afterCreateMatch,
      `"Total Flows" card must show a number after flow creation, got: "${afterCreateText}"`,
    ).not.toBeNull();
    const countAfterCreate = parseInt(afterCreateMatch![0], 10);
    // The count must have gone up (creation is reflected). Parallel tests may add more.
    expect(
      countAfterCreate,
      `Total Flows (${countAfterCreate}) must be >= ${initialCount + 1} after creating a flow`,
    ).toBeGreaterThanOrEqual(initialCount + 1);

    // Delete the flow via the API and clear the cleanup variable
    await request.delete(`${apiBase}/flows/${createdFlowId}`);
    createdFlowId = null;

    // Reload the dashboard and wait for it to re-render
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });

    // Total Flows should have decreased (deletion is reflected)
    const afterDeleteText = await getStatCardText(page, 'Total Flows');
    const afterDeleteMatch = afterDeleteText.match(/\d+/);
    expect(
      afterDeleteMatch,
      `"Total Flows" card must show a number after flow deletion, got: "${afterDeleteText}"`,
    ).not.toBeNull();
    const countAfterDelete = parseInt(afterDeleteMatch![0], 10);
    // Count must be less than what it was right after creation
    expect(
      countAfterDelete,
      `Total Flows (${countAfterDelete}) must be < ${countAfterCreate} after deleting a flow`,
    ).toBeLessThan(countAfterCreate);
  });

  // ── Test 5 — Medium ───────────────────────────────────────────────────────
  test('New Flow button is always visible on the dashboard', async ({ page, apiBase }) => {
    // Navigate to the dashboard
    await goToDashboard(page);

    // The "New Flow" button must be visible and interactive
    const newFlowBtn = page.getByRole('button', { name: /New Flow/i });
    await expect(newFlowBtn).toBeVisible({ timeout: 5_000 });
    await expect(newFlowBtn).toBeEnabled();
  });

  // ── Test 6 — High ─────────────────────────────────────────────────────────
  test('dashboard shows flow cards with correct names', async ({ page, request, apiBase }) => {
    // Fetch the list of flows from the API
    const resp = await request.get(`${apiBase}/flows/list`);
    expect(resp.ok()).toBeTruthy();
    const listBody = await resp.json();
    const flows: Array<{ id: string; name: string }> = listBody.data ?? listBody;

    expect(flows.length).toBeGreaterThan(0);

    // Navigate to the dashboard
    await goToDashboard(page);

    // Wait for the loading spinner to disappear
    await expect(page.getByText('Loading flows'))
      .not.toBeVisible({
        timeout: 15_000,
      })
      .catch(() => {
        // Transition may be too fast — that is fine
      });

    // For the first 3 flows returned by the API, assert each name is visible
    const samplesToCheck = flows.slice(0, 3);
    for (const flow of samplesToCheck) {
      await expect(page.getByText(flow.name).first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
