// spec: specs/flow-editor-toolbar.plan.md
// seed: tests/seed.spec.ts

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

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

async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Reads the current ReactFlow viewport transform from the DOM style attribute.
 * Returns { x, y, scale } parsed from the inline `transform` on the viewport div.
 */
async function getViewportTransform(page: Page): Promise<{ x: number; y: number; scale: number }> {
  const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
  const scaleMatch = style.match(/scale\(([^)]+)\)/);
  const translateMatch = style.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  return {
    x: translateMatch ? parseFloat(translateMatch[1]) : 0,
    y: translateMatch ? parseFloat(translateMatch[2]) : 0,
    scale: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
  };
}

test.describe('Flow Editor — Toolbar & Canvas', () => {
  test.describe.configure({ mode: 'serial' });

  // Seeded flow IDs — created in beforeAll, deleted in afterAll
  let jqFlowId: string | null = null;
  let templateFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    // Create "Toolbar Test JQ Flow" with 3 nodes
    const jqResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'Toolbar Test JQ Flow' },
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
    // Create "Toolbar Test Template Flow" with 2 nodes
    const templateResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'Toolbar Test Template Flow' },
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
    await cleanupFlowByName(apiBase, request, 'Toolbar Test JQ Flow');
    await cleanupFlowByName(apiBase, request, 'Toolbar Test Template Flow');
  });

  // ── Test 1 — Medium ───────────────────────────────────────────────────────
  test('zoom in button increases canvas scale', async ({ page, navigateToFlow, apiBase }) => {
    // Navigate to the JQ Data Transform flow
    await navigateToFlow('Toolbar Test JQ Flow');

    // Get the initial viewport scale before zooming
    const before = await getViewportTransform(page);

    // Click the zoom-in control button
    await page.locator('.react-flow__controls-zoomin').click();

    // Wait for the zoom animation to settle
    await page.waitForTimeout(400);

    // Get the updated viewport scale
    const after = await getViewportTransform(page);

    // Assert the scale increased
    expect(after.scale).toBeGreaterThan(before.scale);
  });

  // ── Test 2 — Medium ───────────────────────────────────────────────────────
  test('zoom out button decreases canvas scale', async ({ page, navigateToFlow, apiBase }) => {
    // Navigate to the JQ Data Transform flow
    await navigateToFlow('Toolbar Test JQ Flow');

    // First zoom in so we're not already at the minimum zoom level
    await page.locator('.react-flow__controls-zoomin').click();
    await page.waitForTimeout(400);

    // Record the zoomed-in scale as our "before" baseline
    const before = await getViewportTransform(page);

    // Click the zoom-out control button
    await page.locator('.react-flow__controls-zoomout').click();

    // Wait for the zoom animation to settle
    await page.waitForTimeout(400);

    // Get the final scale
    const after = await getViewportTransform(page);

    // Assert the scale decreased
    expect(after.scale).toBeLessThan(before.scale);
  });

  // ── Test 3 — Medium ───────────────────────────────────────────────────────
  test('fit-to-view button makes all nodes visible', async ({ page, navigateToFlow, apiBase }) => {
    // Navigate to the JQ Data Transform flow
    await navigateToFlow('Toolbar Test JQ Flow');

    // Pan the canvas far off-center so nodes move out of view
    const pane = page.locator('.react-flow__pane');
    const paneBounds = await pane.boundingBox();
    const centerX = (paneBounds?.x ?? 0) + (paneBounds?.width ?? 800) / 2;
    const centerY = (paneBounds?.y ?? 0) + (paneBounds?.height ?? 600) / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 500, centerY + 500);
    await page.mouse.up();

    // Brief pause after panning
    await page.waitForTimeout(200);

    // Click the fit-view control button to restore all nodes into view
    await page.locator('.react-flow__controls-fitview').click();

    // Wait for the fit-view animation to complete
    await page.waitForTimeout(600);

    // Assert that every node is visible in the viewport
    const nodes = page.locator('.react-flow__node');
    const nodeCount = await nodes.count();
    expect(nodeCount).toBeGreaterThan(0);

    for (let i = 0; i < nodeCount; i++) {
      await expect(nodes.nth(i)).toBeVisible();
    }
  });

  // ── Test 4 — Medium ───────────────────────────────────────────────────────
  test('canvas can be panned by mouse drag', async ({ page, navigateToFlow, apiBase }) => {
    // Navigate to the JQ Data Transform flow
    await navigateToFlow('Toolbar Test JQ Flow');

    // Record the initial viewport translation values
    const before = await getViewportTransform(page);

    // Locate the pane and compute its center coordinates
    const pane = page.locator('.react-flow__pane');
    const paneBounds = await pane.boundingBox();
    const centerX = (paneBounds?.x ?? 0) + (paneBounds?.width ?? 800) / 2;
    const centerY = (paneBounds?.y ?? 0) + (paneBounds?.height ?? 600) / 2;

    // Drag the canvas 200px right and 150px down
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(centerX + 200, centerY + 150);
    await page.mouse.up({ button: 'middle' });

    // Brief pause for panning to register
    await page.waitForTimeout(200);

    // Record the new viewport translation
    const after = await getViewportTransform(page);

    // Assert that the x or y translation changed — the canvas was panned
    const xChanged = Math.abs(after.x - before.x) > 1;
    const yChanged = Math.abs(after.y - before.y) > 1;
    expect(xChanged || yChanged).toBeTruthy();
  });
});
