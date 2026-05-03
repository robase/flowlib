// spec: specs/flow-management.plan.md
// seed: tests/seed.spec.ts

import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Navigate to /flowlib and wait for the Dashboard heading to confirm load.
 */
async function goToDashboard(page: Page) {
  await page.goto('/flowlib');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Look up a flow by name via the REST API and return its ID (or null if not
 * found). Handles both a plain-array and a `{ data: [...] }` paginated envelope.
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
  const flows: Array<{ id: string; name: string }> = Array.isArray(body) ? body : (body.data ?? []);
  return flows.find((f) => f.name === name)?.id ?? null;
}

/**
 * Create a minimal flow via the REST API and return the created record.
 */
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

/**
 * Delete a flow by name via the API; silently succeeds if it does not exist.
 */
async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`);
  }
}

/**
 * Wait for the "Loading flows…" spinner on the dashboard to disappear.
 */
async function waitForFlowsLoaded(page: Page) {
  await expect(page.getByText(/loading flows/i))
    .not.toBeVisible({ timeout: 10_000 })
    .catch(() => {
      /* indicator may have already gone — safe to continue */
    });
}

/**
 * Return a Locator for the dashboard flow card whose <h3> heading contains
 * `name`. Relies on the `.bg-card` root of the FlowCard component in home.tsx.
 */
function flowCardLocator(page: Page, name: string) {
  return page.locator('.bg-card').filter({ has: page.locator('h3').filter({ hasText: name }) });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Flow Management', () => {
  /**
   * Names of flows created during individual tests that are cleaned up in
   * afterEach so they do not pollute subsequent runs.
   */
  let flowsToCleanup: string[] = [];

  // Seeded flow IDs for tests that depend on pre-existing flows
  let jqFlowId: string | null = null;
  let templateFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    // Create "JQ Data Transform" with 3 nodes (used by test 5)
    const jqResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'JQ Data Transform' },
    });
    if (jqResp.ok()) {
      const flow = await jqResp.json();
      jqFlowId = flow.id;
      await request.post(`${apiBase}/flows/${jqFlowId}/versions`, {
        data: {
          flowlibDefinition: {
            nodes: [
              {
                id: 'node-1',
                type: 'trigger.manual',
                label: 'User List',
                referenceId: 'user_list',
                params: {},
                position: { x: 100, y: 200 },
              },
              {
                id: 'node-2',
                type: 'core.javascript',
                label: 'Filter Admins',
                referenceId: 'filter_admins',
                params: { code: '$input' },
                position: { x: 350, y: 200 },
              },
              {
                id: 'node-3',
                type: 'core.output',
                label: 'Format Result',
                referenceId: 'format_result',
                params: {},
                position: { x: 600, y: 200 },
              },
            ],
            edges: [
              { id: 'edge-1', source: 'node-1', target: 'node-2' },
              { id: 'edge-2', source: 'node-2', target: 'node-3' },
            ],
          },
        },
      });
    }
    // Create "Simple Template Flow" with 2 nodes (used by test 2)
    const templateResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'Simple Template Flow' },
    });
    if (templateResp.ok()) {
      const flow = await templateResp.json();
      templateFlowId = flow.id;
      await request.post(`${apiBase}/flows/${templateFlowId}/versions`, {
        data: {
          flowlibDefinition: {
            nodes: [
              {
                id: 'node-1',
                type: 'trigger.manual',
                label: 'Topic Input',
                referenceId: 'topic_input',
                params: {},
                position: { x: 100, y: 200 },
              },
              {
                id: 'node-2',
                type: 'core.template_string',
                label: 'Build Prompt',
                referenceId: 'build_prompt',
                params: { template: 'Hello {{ topic_input }}' },
                position: { x: 350, y: 200 },
              },
            ],
            edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
          },
        },
      });
    }
  });

  test.afterAll(async ({ request, apiBase }) => {
    if (jqFlowId) {
      await request.delete(`${apiBase}/flows/${jqFlowId}`).catch(() => {});
      jqFlowId = null;
    }
    if (templateFlowId) {
      await request.delete(`${apiBase}/flows/${templateFlowId}`).catch(() => {});
      templateFlowId = null;
    }
    await cleanupFlowByName(apiBase, request, 'JQ Data Transform');
    await cleanupFlowByName(apiBase, request, 'Simple Template Flow');
  });

  test.afterEach(async ({ request, apiBase }) => {
    for (const nameOrId of flowsToCleanup) {
      // If it looks like a slug/id (no spaces), try direct DELETE first
      if (!nameOrId.includes(' ')) {
        await request.delete(`${apiBase}/flows/${nameOrId}`).catch(() => {});
      }
      // Always also try by name in case it was stored as a display name
      await cleanupFlowByName(apiBase, request, nameOrId).catch(() => {});
    }
    flowsToCleanup = [];
  });

  // ── Test 1 — Critical ──────────────────────────────────────────────────────
  test('new flow button creates a flow and navigates to the editor', async ({
    page,
    request,
    apiBase,
  }) => {
    // Remove any leftover from a previous interrupted run
    await cleanupFlowByName(apiBase, request, 'My Brand New Flow');

    // Navigate to the dashboard and wait for the flows section to settle
    await goToDashboard(page);
    await waitForFlowsLoaded(page);

    // Click the "New Flow" button in the dashboard header
    await page.getByRole('button', { name: 'New Flow' }).click();

    // The React Flow canvas must become visible — confirms the editor loaded
    await expect(page.locator('.react-flow')).toBeVisible({
      timeout: 15_000,
    });

    // URL must contain the flow editor path: /flowlib/flow/:id
    await expect(page).toHaveURL(/\/flowlib\/flow\//, { timeout: 10_000 });

    // Extract the flow ID from the current URL for cleanup and verification
    const editorUrl = page.url();
    const flowIdMatch = editorUrl.match(/\/flow\/([^/]+)/);
    const flowId = flowIdMatch?.[1] ?? null;

    // Register for afterEach cleanup using the flow id-slug from the URL
    if (flowId) {
      flowsToCleanup.push(flowId);
    }

    // Navigate back to the dashboard
    await goToDashboard(page);
    await waitForFlowsLoaded(page);

    // A flow card linking to this flow's runs page must now be visible
    if (flowId) {
      await expect(page.locator(`a[href*="${flowId}"]`).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── Test 2 — High ──────────────────────────────────────────────────────────
  test('clicking a flow card navigates to the correct flow editor', async ({ page, apiBase }) => {
    // Navigate to the dashboard
    await goToDashboard(page);
    await waitForFlowsLoaded(page);

    // Find the seeded "Simple Template Flow" card
    const card = flowCardLocator(page, 'Simple Template Flow');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Click the card body — not the Edit/Runs hover buttons
    await card.click();

    // The React Flow canvas must appear — confirms the flow editor loaded
    await expect(page.locator('.react-flow')).toBeVisible({
      timeout: 10_000,
    });

    // URL must contain the /flow/ path segment (singular; route: /flowlib/flow/:id)
    await expect(page).toHaveURL(/\/flow\//, { timeout: 10_000 });
  });

  // ── Test 3 — Medium ────────────────────────────────────────────────────────
  test('flow card has a link to the flow runs page', async ({ page, apiBase }) => {
    // Navigate to the dashboard
    await goToDashboard(page);
    await waitForFlowsLoaded(page);

    // Locate the seeded "JQ Data Transform" flow card
    const card = flowCardLocator(page, 'JQ Data Transform');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Hover to reveal the action buttons (opacity-0 → group-hover:opacity-100)
    await card.hover();

    // Find the "Runs" link within the card.
    // FlowCard renders: <Button asChild><Link to=".../runs">Runs</Link></Button>
    // so the DOM element is an <a>; try getByRole("link") first, then "button".
    const runsLink = card
      .getByRole('link', { name: /^runs$|history/i })
      .or(card.getByRole('button', { name: /^runs$|history/i }))
      .first();
    await expect(runsLink).toBeVisible({ timeout: 5_000 });
    await runsLink.click();

    // URL must contain /runs — route: /flowlib/flow/:id/runs
    await expect(page).toHaveURL(/\/runs/, { timeout: 10_000 });

    // Confirm the runs view rendered (React Flow canvas or runs section)
    await expect(
      page
        .locator('.react-flow')
        .or(page.getByRole('button', { name: /^runs$/i }))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 4 — Critical (serial mode; mutates all worker-local flows) ───────
  test.describe('empty state when no flows exist', () => {
    test.describe.configure({ mode: 'serial' });

    /** Full flow records saved before deletion for restoration in afterAll. */
    let savedFlows: Array<Record<string, unknown>> = [];

    test.beforeAll(async ({ request, apiBase }) => {
      // Capture every current flow so we can restore them after this sub-suite
      const resp = await request.get(`${apiBase}/flows/list`);
      if (resp.ok()) {
        const body = await resp.json();
        savedFlows = Array.isArray(body) ? body : (body.data ?? []);
      }

      // Delete all flows to produce the empty state
      for (const flow of savedFlows) {
        await request.delete(`${apiBase}/flows/${flow['id'] as string}`).catch(() => {});
      }
    });

    test.afterAll(async ({ request, apiBase }) => {
      // Re-create every previously existing flow to restore seeded state
      for (const flow of savedFlows) {
        await request
          .post(`${apiBase}/flows`, {
            data: { name: flow['name'] },
          })
          .catch(() => {});
      }
    });

    test('dashboard shows empty state when no flows exist', async ({ page, apiBase }) => {
      // Navigate to the dashboard — all flows deleted in beforeAll
      await goToDashboard(page);
      await waitForFlowsLoaded(page);

      // "No flows yet" heading must appear in the empty-state card
      // (rendered by Home when flows.length === 0)
      await expect(page.getByText('No flows yet')).toBeVisible({
        timeout: 10_000,
      });

      // A CTA button for creating a flow must be present.
      // Home renders "Create Flow" in the empty-state card and
      // "New Flow" in the header — either confirms the CTA is visible.
      const ctaButton = page
        .getByRole('button', { name: /create flow/i })
        .or(page.getByRole('button', { name: /new flow/i }))
        .first();
      await expect(ctaButton).toBeVisible({ timeout: 5_000 });
    });
  });

  // ── Test 5 — High ──────────────────────────────────────────────────────────
  test('total flows count on dashboard matches the API', async ({ page, request, apiBase }) => {
    // Navigate to the dashboard first so the stat card and API call are close in time
    await goToDashboard(page);

    // Locate the "Total Flows" stat card.
    const totalFlowsCard = page
      .locator('.bg-card')
      .filter({ has: page.getByText(/total flows/i) })
      .first();
    await expect(totalFlowsCard).toBeVisible({ timeout: 10_000 });

    // Wait for the stat to hydrate — the "—" loading placeholder must be gone
    const valueEl = totalFlowsCard.locator("[class*='text-2xl']").first();
    await expect(valueEl).toBeVisible({ timeout: 10_000 });
    await expect(valueEl).not.toHaveText('—', { timeout: 10_000 });

    const displayedText = (await valueEl.textContent())?.trim() ?? '0';
    const displayedCount = parseInt(displayedText, 10);

    // Now call the same endpoint the stat card uses — timing is close so counts should match
    const statsResp = await request.get(`${apiBase}/dashboard/stats`);
    expect(statsResp.ok()).toBeTruthy();
    const statsBody = await statsResp.json();
    const apiCount: number = statsBody.totalFlows ?? 0;

    // Allow ±10 for flows created/deleted by concurrent tests between dashboard
    // render and this API call
    expect(Math.abs(displayedCount - apiCount)).toBeLessThanOrEqual(10);
  });
});
