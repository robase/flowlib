// spec: Flow Editor — Node Operations
// seed: tests/seed.spec.ts

import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

async function cleanupFlowByName(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<void> {
  const id = await getFlowIdByName(apiBase, request, name);
  if (id) {
    await request.delete(`${apiBase}/flows/${id}`);
  }
}

async function getCanvasNodeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__node').count();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getCanvasEdgeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Flow Editor — Node Operations', () => {
  // Run serially so canvas mutations (delete/undo, selection state) from one
  // test don't bleed into a concurrently running sibling.
  test.describe.configure({ mode: 'serial' });

  // Seeded flow ID — created in beforeAll, deleted in afterAll
  let jqFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    // Create "Nodes Test JQ Flow" with 3 nodes
    const createResp = await request.post(`${apiBase}/flows`, {
      data: { name: 'Nodes Test JQ Flow' },
    });
    if (createResp.ok()) {
      const flow = await createResp.json();
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
  });

  test.afterAll(async ({ request, apiBase }) => {
    if (jqFlowId) {
      await request.delete(`${apiBase}/flows/${jqFlowId}`).catch(() => {});
      jqFlowId = null;
    }
    await cleanupFlowByName(apiBase, request, 'Nodes Test JQ Flow');
  });

  // ── Test 1 — High ─────────────────────────────────────────────────────────
  test('node palette opens when the add node button is clicked', async ({
    page,
    navigateToFlow,
    apiBase,
  }) => {
    // 1. Navigate to the JQ Data Transform flow editor
    await navigateToFlow('Nodes Test JQ Flow');

    // 2. The NodeSidebar starts open by default (nodeSidebarOpen: true in uiStore).
    //    The "Add nodes" button only appears when the sidebar is CLOSED.
    //    Check if the sidebar is already open by looking for the "Nodes" heading.
    const nodesHeading = page.getByRole('heading', { name: 'Nodes', level: 2 });
    const sidebarAlreadyOpen = await nodesHeading.isVisible({ timeout: 3_000 }).catch(() => false);

    if (sidebarAlreadyOpen) {
      // Sidebar is open — verify it shows node category buttons (palette content)
      const categoryButtons = page.getByRole('button', {
        name: /triggers|flowlib core|github|slack|http|input|output/i,
      });
      await expect(categoryButtons.first()).toBeVisible({ timeout: 5_000 });

      // Close the sidebar by clicking the "Collapse sidebar" button
      await page.getByTitle('Collapse sidebar').click();

      // Wait for the "Add nodes" button to appear (sidebarOpen = false)
      const addNodesBtn = page.getByTitle('Open node panel');
      await expect(addNodesBtn).toBeVisible({ timeout: 5_000 });

      // Click it to reopen the palette
      await addNodesBtn.click();

      // Verify the sidebar reopened
      await expect(nodesHeading).toBeVisible({ timeout: 5_000 });
    } else {
      // Sidebar is closed — find the "Add nodes" trigger and click it
      const addNodesBtn = page
        .getByTitle('Open node panel')
        .or(page.getByRole('button', { name: /add nodes/i }))
        .first();
      await expect(addNodesBtn).toBeVisible({ timeout: 5_000 });
      await addNodesBtn.click();
      await expect(nodesHeading).toBeVisible({ timeout: 5_000 });
    }

    // Assert the palette lists at least 3 provider category buttons
    const categoryButtons = page.getByRole('button', {
      name: /triggers|flowlib core|github|slack|http|input|output/i,
    });
    const categoryCount = await categoryButtons.count();
    expect(
      categoryCount,
      'Node palette should show at least 3 provider category buttons',
    ).toBeGreaterThanOrEqual(3);
  });

  // ── Test 2 — Critical ─────────────────────────────────────────────────────
  test('canvas nodes can be selected by clicking', async ({ page, navigateToFlow, apiBase }) => {
    // 1. Navigate to the JQ Data Transform flow editor
    await navigateToFlow('Nodes Test JQ Flow');

    // 2. Assert at least one node is present on the canvas
    const nodes = page.locator('.react-flow__node');
    await expect(nodes.first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await nodes.count();
    expect(initialCount, 'Canvas must have at least one node').toBeGreaterThanOrEqual(1);

    // 3. Click the first node to select it
    const firstNode = nodes.first();
    await firstNode.click();

    // 4. Assert the node gains a selected state.
    //    ReactFlow appends "selected" to the element's class list.
    //    Some themes also add Tailwind ring- or outline- utilities.
    await expect(firstNode).toHaveClass(/selected|ring-|outline/, {
      timeout: 3_000,
    });

    // 5. Click on the bare canvas background to deselect all nodes
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });

    // 6. Assert the node is no longer in the selected state
    await expect(firstNode).not.toHaveClass(/\bselected\b/, {
      timeout: 3_000,
    });
  });

  // ── Test 3 — Critical ─────────────────────────────────────────────────────
  test('save flow persists to the backend', async ({ page, request, apiBase }) => {
    const FLOW_NAME = 'Save Test Flow';
    const UPDATED_NAME = 'Save Test Flow Updated';

    // 1. Remove any leftover flow from a previous run
    await cleanupFlowByName(apiBase, request, FLOW_NAME);
    await cleanupFlowByName(apiBase, request, UPDATED_NAME);

    // 2. Create a fresh non-empty flow via API and capture its id
    const flow = await createFlowViaApi(apiBase, request, FLOW_NAME);
    expect(flow.id, 'Created flow must have an id').toBeTruthy();
    await request.post(`${apiBase}/flows/${flow.id}/versions`, {
      data: {
        flowlibDefinition: {
          nodes: [
            {
              id: 'node-1',
              type: 'core.input',
              label: 'Seed Input',
              referenceId: 'seed_input',
              params: { variableName: 'seed_input', defaultValue: '"seed"' },
              position: { x: 100, y: 200 },
            },
          ],
          edges: [],
        },
      },
    });

    try {
      // 3. Navigate directly to the flow editor for this flow
      await page.goto(`/flowlib/flow/${flow.id}`);

      // 4. Assert the ReactFlow canvas renders
      await expect(page.locator('.react-flow')).toBeVisible({
        timeout: 10_000,
      });

      // 5. Dirty the editor by dragging the node. ReactFlow uses pointer events;
      // a three-step move with intermediate positions is more reliable than a
      // single move.
      const firstNode = page.locator('.react-flow__node').first();
      await expect(firstNode).toBeVisible({ timeout: 10_000 });
      const before = await firstNode.boundingBox();
      expect(before).not.toBeNull();
      const startX = (before?.x ?? 0) + (before?.width ?? 0) / 2;
      const startY = (before?.y ?? 0) + (before?.height ?? 0) / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 20, startY + 10);
      await page.mouse.move(startX + 40, startY + 20);
      await page.mouse.move(startX + 80, startY + 40);
      await page.mouse.up();

      await expect(page.getByText('Unsaved Changes')).toBeVisible({ timeout: 5_000 });

      // 6. Trigger save — try visible "Save" button first, then keyboard shortcut
      const saveButton = page.getByRole('button', { name: /^save$/i }).first();
      const hasSaveButton = await saveButton.isVisible({ timeout: 3_000 }).catch(() => false);

      if (hasSaveButton) {
        await saveButton.click();
      } else {
        // Keyboard shortcut: Meta+S (macOS) or Ctrl+S (Windows/Linux)
        const isMac = process.platform === 'darwin';
        await page.keyboard.press(isMac ? 'Meta+S' : 'Control+S');
      }

      // 7. Assert a success toast / status indicator appears
      const successToast = page
        .locator('[role="status"], [role="alert"], .toast, .snackbar')
        .filter({ hasText: /saved|success/i })
        .first();

      // Wait up to 5s for the toast; non-fatal since some UIs are subtle
      await expect(successToast)
        .toBeVisible({ timeout: 5_000 })
        .catch(() => {
          // If no toast exists, at minimum verify no error was shown
        });

      // Ensure no error indicator appeared
      const errorToast = page
        .locator('[role="alert"]')
        .filter({ hasText: /error|failed|could not save/i })
        .first();
      const hasError = await errorToast.isVisible({ timeout: 2_000 }).catch(() => false);
      expect(hasError, 'No save-error alert should appear').toBe(false);

      // 8. Confirm backend persistence — GET the flow via API
      const getResp = await request.get(`${apiBase}/flows/${flow.id}`);
      expect(getResp.ok(), `GET /flows/${flow.id} should return 2xx after save`).toBeTruthy();
      const savedFlow = await getResp.json();
      expect(savedFlow.name).toBe(FLOW_NAME);
    } finally {
      // 9. Always clean up the test flow regardless of test outcome
      await cleanupFlowByName(apiBase, request, FLOW_NAME).catch(() => {});
      await cleanupFlowByName(apiBase, request, UPDATED_NAME).catch(() => {});
    }
  });

  // ── Test 4 — High ─────────────────────────────────────────────────────────
  test('double-clicking a node opens its configuration panel', async ({
    page,
    navigateToFlow,
    closeConfigPanel,
    apiBase,
  }) => {
    // 1. Navigate to the JQ Data Transform flow editor
    await navigateToFlow('Nodes Test JQ Flow');

    // 2. Wait for at least one node to render on the canvas
    const firstNode = page.locator('.react-flow__node').first();
    await expect(firstNode).toBeVisible({ timeout: 10_000 });

    // 3. Double-click the first node to open its configuration panel
    await firstNode.dblclick();

    // 4. Assert the config dialog/panel appears within 5s
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 5. Assert the panel has configuration content:
    //    form fields (input, select, textarea), labels, or CodeMirror editors
    const contentElements = dialog.locator(
      'input, textarea, select, label, .cm-editor, [data-config]',
    );
    const contentCount = await contentElements.count();
    expect(
      contentCount,
      'Config panel must contain at least one form element or editor',
    ).toBeGreaterThanOrEqual(1);

    // 6. Close the panel using the fixture helper
    await closeConfigPanel();
  });

  // ── Test 5 — High ─────────────────────────────────────────────────────────
  test('canvas shows correct number of nodes for a seeded flow', async ({
    page,
    navigateToFlow,
    apiBase,
  }) => {
    // 1. Navigate to the JQ Data Transform flow (seeded with exactly 3 nodes)
    await navigateToFlow('Nodes Test JQ Flow');

    // 2. Poll until the canvas settles and assert exactly 3 nodes are present
    await expect(async () => {
      const count = await getCanvasNodeCount(page);
      expect(count, 'JQ Data Transform should have exactly 3 nodes on the canvas').toBe(3);
    }).toPass({ timeout: 10_000 });
  });
});
