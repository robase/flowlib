// spec: Next.js frontend rendering — Invect React component
//
// Validates that the @flowlib/ui `<Invect>` component renders correctly
// when imported and used in a Next.js App Router application.
// The Next.js example runs on the shared Playwright Next.js port.
//
// The playwright.config.ts webServer array auto-starts the Next.js server.

import { test, expect } from './nextjs-frontend.fixtures';

const NEXTJS_URL = process.env.NEXTJS_URL ?? 'http://localhost:43002';

test.describe('Next.js Invect Frontend Rendering', () => {
  test('home page loads and links to Invect', async ({ page }) => {
    // 1. Navigate to the Next.js home page
    await page.goto(NEXTJS_URL);

    // 2. Verify Next.js app shell renders
    await expect(page.locator('body')).toBeVisible();

    // 3. There should be a link/button to open Invect
    const invectLink = page.getByRole('link', { name: /Open Invect/i });
    await expect(invectLink).toBeVisible({ timeout: 15_000 });
    expect(await invectLink.getAttribute('href')).toBe('/flowlib');
  });

  test('Invect component renders dashboard in Next.js', async ({ page }) => {
    // 1. Navigate directly to the /flowlib page where <Invect> is mounted
    await page.goto(`${NEXTJS_URL}/flowlib`);

    // 2. The Invect shell should render — it contains a side menu and main area
    //    Wait generously since Next.js has to hydrate the client component
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 3. Dashboard should show statistics (proves API connectivity to /api/flowlib)
    //    The dashboard calls getDashboardStats() and listFlows()
    await expect(page.getByText(/Total Flows/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Invect side navigation works in Next.js', async ({ page }) => {
    // 1. Navigate to the Invect page
    await page.goto(`${NEXTJS_URL}/flowlib`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 2. Click the Credentials nav link in the side menu
    const credLink = page.getByRole('link', { name: /credentials/i }).first();
    await credLink.click();

    // 3. Verify the Credentials page renders
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 10_000,
    });

    // 4. Click the Flow Runs nav link
    const execLink = page.getByRole('link', { name: /flow runs/i }).first();
    await execLink.click();

    // 5. Verify the Flow Runs page renders
    await expect(page.getByRole('heading', { level: 1, name: 'Flow Runs' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Invect flow editor loads in Next.js', async ({ page }) => {
    // 1. Go to dashboard
    await page.goto(`${NEXTJS_URL}/flowlib`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 2. Create a new flow via the "New Flow" button
    const newFlowBtn = page.getByRole('button', { name: /New Flow/i });
    await expect(newFlowBtn).toBeVisible({ timeout: 5_000 });
    await newFlowBtn.click();

    // 3. The flow editor canvas should appear (React Flow)
    await expect(page.locator('.react-flow')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Invect CSS loads without console errors in Next.js', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Navigate to the Invect page
    await page.goto(`${NEXTJS_URL}/flowlib`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

    // 2. Verify no critical console errors related to CSS/imports
    //    Filter out common benign Next.js warnings
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('React does not recognize') &&
        !e.includes('downloadable font') &&
        !e.includes('hydration'),
    );

    // No errors about createRequire (the types.frontend.ts bug) or missing CSS
    const hasBuildErrors = criticalErrors.some(
      (e) =>
        e.includes('createRequire') ||
        e.includes('not exported') ||
        e.includes('Failed to load stylesheet'),
    );
    expect(hasBuildErrors).toBeFalsy();

    // 3. Verify Invect styles are actually loaded — check for the flowlib shell div
    const invectShell = page.locator('.flowlib');
    await expect(invectShell).toBeVisible();
  });
});
