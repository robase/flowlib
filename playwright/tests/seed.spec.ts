import { test, expect } from './fixtures';

/**
 * Seed test — verifies the fullstack environment is running and the
 * Flowlib frontend can communicate with the Express backend.
 *
 * This test is used by the Playwright planner/generator agents as:
 *   1. The bootstrap step that proves the app is alive
 *   2. An example of test style and fixture usage
 */
test('seed', async ({ page }) => {
  // 1. Navigate to the Flowlib app (basePath = /flowlib)
  await page.goto('/flowlib');

  // 2. The app shell should render
  await expect(page.locator('.fl-sidebar-shell')).toBeVisible();

  // 3. The dashboard should load (proves the Flowlib component route matched)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: 15_000,
  });

  // 4. The flows section should appear (proves API connectivity)
  //    Either shows flow cards or "No flows yet" empty state
  const flowsLoaded = page.getByText('Loading flows');
  await expect(flowsLoaded)
    .not.toBeVisible({ timeout: 15_000 })
    .catch(() => {});
  await expect(page.getByText(/Error loading data:/i))
    .not.toBeVisible({ timeout: 5_000 })
    .catch(() => {});

  // Should see either flow cards or the empty state
  const hasFlows = (await page.locator('.bg-card h3').count()) > 0;
  const hasEmptyState = await page
    .getByText('No flows yet')
    .isVisible()
    .catch(() => false);
  expect(hasFlows || hasEmptyState).toBeTruthy();
});
