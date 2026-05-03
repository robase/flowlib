// spec: specs/navigation.plan.md
// seed: tests/seed.spec.ts

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

/** Wait for the Dashboard heading — proves the home route rendered and the API responded. */
async function waitForDashboard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Return the sidebar collapse/expand toggle button.
 *
 * It is the only `button.absolute` inside `.fl-sidebar-shell`: a small
 * `rounded-full` icon button anchored at `-right-3 top-4` that renders a
 * ChevronRight icon (collapsed) or ChevronLeft icon (expanded).
 */
function getSidebarToggle(page: Page) {
  return page.locator('.fl-sidebar-shell button.absolute').first();
}

/**
 * Expand the sidebar if it is currently collapsed.
 *
 * AppSideMenu initialises with `isCollapsed = true`, so nav label <span>s
 * are NOT rendered in the DOM at all when collapsed (conditional render:
 * `{!isCollapsed && <span>{label}</span>}`). Checking for the "Executions"
 * span is therefore a reliable collapsed-state probe.
 */
async function ensureSidebarExpanded(page: Page) {
  const executionsLabel = page
    .locator('.fl-sidebar-shell nav span')
    .filter({ hasText: 'Flow Runs' });
  const isAlreadyExpanded = await executionsLabel.isVisible().catch(() => false);
  if (!isAlreadyExpanded) {
    await getSidebarToggle(page).click();
    await expect(executionsLabel).toBeVisible({ timeout: 3_000 });
  }
}

async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Navigation & App Shell', () => {
  // Seeded flow IDs — created in beforeAll, deleted in afterAll
  let jqFlowId: string | null = null;
  let templateFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    // Create "JQ Data Transform" with 3 nodes (used by test 4)
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
                type: 'core.input',
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
    // Create "Simple Template Flow" with 2 nodes (used by test 6)
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
                type: 'core.input',
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
  // ─── Test 1 — High ─────────────────────────────────────────────────────────
  test('sidebar links navigate to all main pages', async ({ page, apiBase }) => {
    // 1. Navigate to the dashboard and wait for the Dashboard heading
    await page.goto('/flowlib');
    await waitForDashboard(page);

    // Assert the sidebar shell is present on the dashboard
    await expect(page.locator('.fl-sidebar-shell')).toBeVisible();

    // 2. Click the Executions sidebar link
    //    Each nav Link renders with aria-label={label}, so getByRole works even
    //    in collapsed (icon-only) mode — no need to expand the sidebar first.
    await page.locator('.fl-sidebar-shell').getByRole('link', { name: 'Flow Runs' }).click();

    // Assert URL contains /executions
    await expect(page).toHaveURL(/\/flow-runs/);
    // Assert "Executions" heading is visible
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });
    // Assert the sidebar persists on the Executions page
    await expect(page.locator('.fl-sidebar-shell')).toBeVisible();

    // 3. Click the Credentials sidebar link
    await page.locator('.fl-sidebar-shell').getByRole('link', { name: 'Credentials' }).click();

    // Assert URL contains /credentials
    await expect(page).toHaveURL(/\/credentials/);
    // Assert "Credentials" heading is visible
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
    // Assert the sidebar persists on the Credentials page
    await expect(page.locator('.fl-sidebar-shell')).toBeVisible();

    // 4. Click the Home/Dashboard sidebar link (aria-label="Home")
    await page.locator('.fl-sidebar-shell').getByRole('link', { name: 'Home' }).click();

    // Assert URL is /flowlib or /flowlib/
    await expect(page).toHaveURL(/\/flowlib\/?$/);
    // Assert "Dashboard" heading is visible
    await waitForDashboard(page);
    // Assert the sidebar persists on the Dashboard page
    await expect(page.locator('.fl-sidebar-shell')).toBeVisible();
  });

  // ─── Test 2 — Medium ───────────────────────────────────────────────────────
  test('sidebar collapses to icon-only mode and expands again', async ({ page, apiBase }) => {
    // 1. Navigate to the dashboard and wait for the Dashboard heading
    await page.goto('/flowlib');
    await waitForDashboard(page);

    const toggle = getSidebarToggle(page);
    await expect(toggle).toBeVisible();

    // The sidebar STARTS COLLAPSED by default (isCollapsed = true).
    // Nav label <span>s are not in the DOM when collapsed.
    // Expand it first to establish a verified expanded baseline.

    // 2. Click the toggle button to expand the sidebar
    await toggle.click();

    // 3. Assert nav labels are now visible (expanded state)
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Flow Runs' }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Credentials' }),
    ).toBeVisible();

    // 4. Click the toggle button to collapse the sidebar
    await toggle.click();

    // 5. Wait for the CSS transition and assert nav labels are NOT in the DOM
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Flow Runs' }),
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Credentials' }),
    ).not.toBeVisible();

    // 6. Click the toggle button again to re-expand
    await toggle.click();

    // 7. Assert nav labels are visible again (restored expanded state)
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Flow Runs' }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      page.locator('.fl-sidebar-shell nav span').filter({ hasText: 'Credentials' }),
    ).toBeVisible();
  });

  // ─── Test 3 — Medium ───────────────────────────────────────────────────────
  test('dark/light theme toggle switches the color scheme', async ({ page, apiBase }) => {
    // 1. Navigate to the dashboard and wait for the Dashboard heading
    await page.goto('/flowlib');
    await waitForDashboard(page);

    // 2. Record the initial theme state.
    //    ThemeProvider applies "light" or "dark" as a class on the .flowlib
    //    element (NOT on <html>) via document.querySelector(".flowlib").classList.
    //    The provider is initialised with defaultTheme="light".
    const flowlibEl = page.locator('.flowlib').first();
    const initialIsDark = await flowlibEl.evaluate((el) => el.classList.contains('dark'));

    // 3. Expand the sidebar so the theme toggle shows its visible text label
    await ensureSidebarExpanded(page);

    // 4. Locate the theme toggle button by its expanded text label.
    //    theme=light  → button reads "Dark Mode"
    //    theme=dark   → button reads "Light Mode"
    const expectedLabel = initialIsDark ? 'Light Mode' : 'Dark Mode';
    const themeToggleBtn = page
      .locator('.fl-sidebar-shell button')
      .filter({ hasText: expectedLabel });
    await expect(themeToggleBtn).toBeVisible({ timeout: 5_000 });

    // 5. Click the theme toggle
    await themeToggleBtn.click();

    // 6. Assert the .flowlib element has changed its theme class
    if (initialIsDark) {
      await expect(flowlibEl).not.toHaveClass(/\bdark\b/, { timeout: 3_000 });
    } else {
      await expect(flowlibEl).toHaveClass(/\bdark\b/, { timeout: 3_000 });
    }

    // 7. Navigate to /flowlib/flow-runs via the sidebar link
    await page.locator('.fl-sidebar-shell').getByRole('link', { name: 'Flow Runs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });

    // 8. Assert the theme class persists after SPA navigation
    if (initialIsDark) {
      await expect(flowlibEl).not.toHaveClass(/\bdark\b/);
    } else {
      await expect(flowlibEl).toHaveClass(/\bdark\b/);
    }

    // 9. Ensure the sidebar is still expanded before locating the toggle again
    await ensureSidebarExpanded(page);

    // 10. Click the theme toggle again to restore the original theme
    const restoreLabel = initialIsDark ? 'Dark Mode' : 'Light Mode';
    const restoreBtn = page.locator('.fl-sidebar-shell button').filter({ hasText: restoreLabel });
    await expect(restoreBtn).toBeVisible({ timeout: 5_000 });
    await restoreBtn.click();

    // Assert the original theme is restored
    if (initialIsDark) {
      await expect(flowlibEl).toHaveClass(/\bdark\b/, { timeout: 3_000 });
    } else {
      await expect(flowlibEl).not.toHaveClass(/\bdark\b/, { timeout: 3_000 });
    }
  });

  // ─── Test 4 — High ─────────────────────────────────────────────────────────
  test('deep link to a flow editor URL loads the correct flow', async ({
    page,
    request,
    apiBase,
  }) => {
    // 1. Resolve the "JQ Data Transform" flow ID via the REST API
    const flowId = await getFlowIdByName(apiBase, request, 'JQ Data Transform');
    expect(flowId, 'Flow "JQ Data Transform" must exist in the database').not.toBeNull();

    // 2. Navigate directly to the flow editor URL — no prior app visit (cold deep link).
    //    The flow editor route is /flowlib/flow/:flowId  (singular "flow", not "flows").
    await page.goto(`/flowlib/flow/${flowId}`);

    // 3. Assert the React Flow canvas is visible within 15s
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });

    // 4. Assert at least one node is rendered on the canvas
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // 5. Assert the editor header shows a non-empty flow name.
    //    FlowHeader renders the name via an InlineEdit component that displays
    //    the value as a <span class="cursor-pointer …"> inside a <header>.
    const flowNameSpan = page.locator('header span.cursor-pointer').first();
    await expect(flowNameSpan).toBeVisible({ timeout: 10_000 });
    const flowNameText = await flowNameSpan.innerText();
    expect(
      flowNameText.trim().length,
      'Flow name in the editor header should not be empty',
    ).toBeGreaterThan(0);
  });

  // ─── Test 5 — Medium ───────────────────────────────────────────────────────
  test('deep link to executions page loads cleanly from cold start', async ({ page, apiBase }) => {
    // 1. Navigate directly to /flowlib/flow-runs — cold start, no prior navigation
    await page.goto('/flowlib/flow-runs');

    // 2. Assert the "Executions" h1 heading is visible within 15s
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });

    // 3. Assert the sidebar shell rendered correctly
    await expect(page.locator('.fl-sidebar-shell')).toBeVisible({ timeout: 10_000 });
    // Nav links carry aria-labels and are present in the DOM even when collapsed
    await expect(page.getByRole('link', { name: 'Flow Runs' })).toBeVisible({ timeout: 5_000 });

    // 4. Assert no JS error banner is visible
    //    Vite dev-mode error overlay uses a <vite-error-overlay> custom element
    await expect(page.locator('vite-error-overlay')).not.toBeAttached();
    // Generic React error-boundary copy
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  // ─── Test 6 — Medium ───────────────────────────────────────────────────────
  test('browser back button returns from editor to dashboard', async ({ page, apiBase }) => {
    // 1. Navigate to the dashboard and wait for the Dashboard heading
    await page.goto('/flowlib');
    await waitForDashboard(page);

    // Wait for flows list to finish loading before looking for a card
    await expect(page.getByText('Loading flows'))
      .not.toBeVisible({ timeout: 15_000 })
      .catch(() => {});

    // 2. Click the "Simple Template Flow" flow card to open the editor
    const card = page.locator('.bg-card').filter({
      has: page.getByRole('heading', {
        level: 3,
        name: 'Simple Template Flow',
        exact: true,
      }),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // 3. Assert the React Flow canvas is visible (editor loaded successfully)
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });

    // 4. Press the browser back button
    await page.goBack();

    // 5. Assert the URL returns to /flowlib or /flowlib/
    await expect(page).toHaveURL(/\/flowlib\/?$/, { timeout: 10_000 });

    // 6. Assert the "Dashboard" heading is visible again
    await waitForDashboard(page);
  });

  // ─── Test 7 — Medium ───────────────────────────────────────────────────────
  test('page reload on sub-routes stays on the same route', async ({ page, apiBase }) => {
    // ── Executions sub-route ──────────────────────────────────────────────────

    // 1. Navigate to /flowlib/flow-runs and wait for the Executions heading
    await page.goto('/flowlib/flow-runs');
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });

    // 2. Reload the page
    await page.reload();

    // 3. Wait for the Executions heading to reappear after reload
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });

    // 4. Assert the URL is still /flowlib/flow-runs
    await expect(page).toHaveURL(/\/flowlib\/flow-runs$/);

    // ── Credentials sub-route ─────────────────────────────────────────────────

    // 5. Navigate to /flowlib/credentials and wait for the Credentials heading
    await page.goto('/flowlib/credentials');
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });

    // 6. Reload the page
    await page.reload();

    // 7. Wait for the Credentials heading to reappear after reload
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });

    // 8. Assert the URL is still /flowlib/credentials
    await expect(page).toHaveURL(/\/flowlib\/credentials$/);
  });
});
