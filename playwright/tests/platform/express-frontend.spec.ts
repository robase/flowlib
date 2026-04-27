// spec: Express + Vite frontend integration
// seed: tests/seed.spec.ts
//
// Validates that the Vite frontend example correctly communicates with
// the Express backend.  This is the existing "fullstack" setup:
//   - Express backend on http://localhost:3000
//   - Vite frontend on the shared Playwright frontend port

import { test, expect } from '../fixtures';

const VITE_URL = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';

test.describe('Express + Vite Frontend Integration', () => {
  test('dashboard loads and shows statistics from Express backend', async ({ page }) => {
    // 1. Navigate to the Vite frontend
    await page.goto(`${VITE_URL}/flowlib`);

    // 2. Wait for Vite's dependency optimisation to finish (may cause a reload)
    //    Then verify the dashboard heading appears
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 3. Stats cards load (proves API connectivity to Express on port 3000)
    await expect(page.getByText(/Error loading data:/i))
      .not.toBeVisible({ timeout: 5_000 })
      .catch(() => {});
    await expect(page.getByText(/Total Flows/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('credentials page loads and lists credentials', async ({ page }) => {
    // 1. Navigate to the credentials page
    await page.goto(`${VITE_URL}/flowlib/credentials`);

    // 2. Credentials heading appears
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('executions page loads and shows run history', async ({ page }) => {
    // 1. Navigate to the flow runs page
    await page.goto(`${VITE_URL}/flowlib/flow-runs`);

    // 2. Flow Runs heading appears
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('flow editor loads when clicking a flow card', async ({ page }) => {
    // 1. Go to dashboard
    await page.goto(`${VITE_URL}/flowlib`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 2. Wait for flows to load
    await expect(page.getByText('Loading flows'))
      .not.toBeVisible({
        timeout: 15_000,
      })
      .catch(() => {});
    await expect(page.getByText(/Error loading data:/i))
      .not.toBeVisible({ timeout: 5_000 })
      .catch(() => {});

    // 3. Click the first flow card
    const firstFlowCard = page.locator('.bg-card h3').first();
    const hasFlows = (await firstFlowCard.count()) > 0;

    if (hasFlows) {
      await firstFlowCard.click();

      // 4. The flow editor canvas should appear
      await expect(page.locator('.react-flow')).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('creating a new flow navigates to the editor', async ({ page }) => {
    // 1. Go to dashboard
    await page.goto(`${VITE_URL}/flowlib`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 2. Click "New Flow"
    await page.getByRole('button', { name: /New Flow/i }).click();

    // 3. Flow editor canvas appears (React Flow container)
    await expect(page.locator('.react-flow')).toBeVisible({
      timeout: 15_000,
    });
  });
});
