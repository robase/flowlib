// spec: Flow Editor — Copy / Paste / Cut / Duplicate / Delete
//
// Tests keyboard shortcuts (Cmd+C, Cmd+V, Cmd+X, Cmd+D, Delete/Backspace)
// at different levels of complexity:
//   1. Single node copy-paste
//   2. Multi-node selection with edges
//   3. Duplicate (Cmd+D) preserves edges
//   4. Cut removes originals
//   5. Delete selection via Backspace
//   6. Paste deduplicates display names
//   7. maxInstances enforcement on paste

import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function createFlowWithDefinition(
  apiBase: string,
  request: APIRequestContext,
  name: string,
  definition: { nodes: unknown[]; edges: unknown[] },
): Promise<string> {
  // Clean up any pre-existing flow with the same name
  const listResp = await request.get(`${apiBase}/flows/list`);
  if (listResp.ok()) {
    const body = await listResp.json();
    const flows: Array<{ id: string; name: string }> = body.data ?? body;
    for (const flow of flows.filter((f) => f.name === name)) {
      await request.delete(`${apiBase}/flows/${flow.id}`).catch(() => {});
    }
  }

  const createResp = await request.post(`${apiBase}/flows`, { data: { name } });
  expect(createResp.ok(), `Failed to create flow "${name}"`).toBeTruthy();
  const flow = await createResp.json();

  const versionResp = await request.post(`${apiBase}/flows/${flow.id}/versions`, {
    data: { flowlibDefinition: definition },
  });
  expect(versionResp.ok(), `Failed to create version for "${name}"`).toBeTruthy();

  return flow.id as string;
}

async function getNodeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__node').count();
}

async function getEdgeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count();
}

/** Get all visible node display names on the canvas */
async function getNodeNames(page: Page): Promise<string[]> {
  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await nodes.nth(i).innerText();
    // Node text may include status/type info; first line is typically the display name
    names.push(text.split('\n')[0].trim());
  }
  return names;
}

/** Click on the bare canvas pane to deselect everything */
async function deselectAll(page: Page) {
  // Click the react-flow viewport at a safe offset to deselect nodes.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  // After clicking, Chromium may move focus to <body>.
  // We must put focus on a focusable element INSIDE .react-flow
  // so the useCopyPaste keyboard handler's `el.closest('.react-flow')` guard passes.
  // React Flow's viewport wrapper or the container with [tabindex] is the right target.
  const focusable = page.locator('.react-flow [tabindex]').first();
  if ((await focusable.count()) > 0) {
    await focusable.focus();
  } else {
    // Fallback: programmatically set tabindex and focus
    await page.locator('.react-flow').evaluate((el) => {
      el.setAttribute('tabindex', '0');
      el.focus();
    });
  }
}

/** Click a single node by its display name text */
async function clickNode(page: Page, name: string) {
  const node = page.locator('.react-flow__node').filter({ hasText: name });
  await expect(node.first()).toBeVisible({ timeout: 5_000 });
  await node.first().click();
}

/** Get the number of selected nodes */
async function getSelectedNodeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__node.selected').count();
}

/**
 * Select all nodes on the canvas using a drag-selection rectangle.
 * The editor has selectionOnDrag enabled, so dragging on the background
 * creates a selection box. We first fitView to ensure all nodes are visible,
 * then drag across the full viewport area.
 */
async function selectAllNodes(page: Page) {
  // Fit view so all nodes are visible and centered
  const fitViewButton = page.getByRole('button', { name: 'Fit View' });
  if (await fitViewButton.count()) {
    await fitViewButton.click();
    await page.waitForTimeout(500);
  }

  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  if (count === 0) {
    throw new Error('No nodes on canvas to select');
  }

  // Get the bounding box of each node to compute the region that covers them all
  const nodeBoxes: { x: number; y: number; width: number; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    const box = await nodes.nth(i).boundingBox();
    if (box) {
      nodeBoxes.push(box);
    }
  }

  if (nodeBoxes.length === 0) {
    throw new Error('Could not get bounding boxes for nodes');
  }

  // Compute a bounding rectangle that encompasses all nodes + padding
  const minX = Math.min(...nodeBoxes.map((b) => b.x));
  const minY = Math.min(...nodeBoxes.map((b) => b.y));
  const maxX = Math.max(...nodeBoxes.map((b) => b.x + b.width));
  const maxY = Math.max(...nodeBoxes.map((b) => b.y + b.height));

  const pad = 20; // padding around nodes

  // Drag from top-left to bottom-right of the computed region
  await page.mouse.move(minX - pad, minY - pad);
  await page.mouse.down();
  await page.mouse.move(maxX + pad, maxY + pad, { steps: 10 });
  await page.mouse.up();

  // Wait for all nodes to show selected state
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(count, { timeout: 3_000 });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Simple 2-node linear flow: Input → JavaScript */
const TWO_NODE_FLOW = {
  nodes: [
    {
      id: 'cp-input',
      type: 'core.input',
      label: 'Data Source',
      referenceId: 'data_source',
      params: { variableName: 'data', defaultValue: '{"x": 1}' },
      position: { x: 150, y: 200 },
    },
    {
      id: 'cp-jq',
      type: 'core.javascript',
      label: 'Transform',
      referenceId: 'transform',
      params: { code: '({ ...data })' },
      position: { x: 450, y: 200 },
    },
  ],
  edges: [{ id: 'cp-edge-1', source: 'cp-input', target: 'cp-jq' }],
};

/** 4-node chain flow: Input → JavaScript → Template → Output */
const CHAIN_FLOW = {
  nodes: [
    {
      id: 'chain-input',
      type: 'core.input',
      label: 'Source',
      referenceId: 'source',
      params: { variableName: 'source', defaultValue: '{"value": 42}' },
      position: { x: 100, y: 200 },
    },
    {
      id: 'chain-jq',
      type: 'core.javascript',
      label: 'Process',
      referenceId: 'process',
      params: { code: '({ ...source })' },
      position: { x: 350, y: 200 },
    },
    {
      id: 'chain-template',
      type: 'core.template_string',
      label: 'Format',
      referenceId: 'format',
      params: { template: 'Result: {{ process.value }}' },
      position: { x: 600, y: 200 },
    },
    {
      id: 'chain-output',
      type: 'core.output',
      label: 'Result',
      referenceId: 'result',
      params: { outputName: 'result', outputValue: '{{ format }}' },
      position: { x: 850, y: 200 },
    },
  ],
  edges: [
    { id: 'chain-e1', source: 'chain-input', target: 'chain-jq' },
    { id: 'chain-e2', source: 'chain-jq', target: 'chain-template' },
    { id: 'chain-e3', source: 'chain-template', target: 'chain-output' },
  ],
};

/** Branching flow: Input → If/Else → two branches */
const BRANCHING_FLOW = {
  nodes: [
    {
      id: 'br-input',
      type: 'core.input',
      label: 'User Info',
      referenceId: 'user_info',
      params: { variableName: 'user_info', defaultValue: JSON.stringify({ age: 25 }) },
      position: { x: 100, y: 200 },
    },
    {
      id: 'br-ifelse',
      type: 'core.if_else',
      label: 'Age Check',
      referenceId: 'age_check',
      params: { condition: { '>=': [{ var: 'user_info.age' }, 18] } },
      position: { x: 400, y: 200 },
    },
    {
      id: 'br-true',
      type: 'core.template_string',
      label: 'Adult Path',
      referenceId: 'adult_path',
      params: { template: 'Welcome adult!' },
      position: { x: 700, y: 100 },
    },
    {
      id: 'br-false',
      type: 'core.template_string',
      label: 'Minor Path',
      referenceId: 'minor_path',
      params: { template: 'Restricted access' },
      position: { x: 700, y: 300 },
    },
  ],
  edges: [
    { id: 'br-e1', source: 'br-input', target: 'br-ifelse' },
    { id: 'br-e2', source: 'br-ifelse', target: 'br-true', sourceHandle: 'true_output' },
    { id: 'br-e3', source: 'br-ifelse', target: 'br-false', sourceHandle: 'false_output' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Copy / Paste', () => {
  test.describe.configure({ mode: 'serial' });

  // Grant clipboard permissions for all tests in this block.
  // Without this, navigator.clipboard.readText / writeText may throw
  // in headless Chromium.
  test.use({
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  // ── Single node ────────────────────────────────────────────────────────

  test('copy and paste a single node creates a duplicate with a new name', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Single Node Test';
    await createFlowWithDefinition(apiBase, request, flowName, TWO_NODE_FLOW);
    await navigateToFlow(flowName);

    // Wait for both nodes to render
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 });

    // Select the JQ node
    await clickNode(page, 'Transform');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1, { timeout: 3_000 });

    // Copy
    await page.keyboard.press(`${MOD}+c`);

    // Click canvas to deselect, then paste
    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);

    // Should now have 3 nodes
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 5_000 });

    // The pasted node should be selected
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1, { timeout: 3_000 });

    // Check the pasted node has a deduplicated name
    const names = await getNodeNames(page);
    const transformNames = names.filter((n) => n.startsWith('Transform'));
    expect(transformNames.length).toBe(2);
    // One should be "Transform" and the other "Transform 2"
    expect(transformNames).toContain('Transform');
    expect(transformNames.some((n) => n !== 'Transform')).toBeTruthy();
  });

  // ── Multi-node with edges (chain) ─────────────────────────────────────

  test('copy-paste a multi-node selection preserves internal edges', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Chain Test';
    await createFlowWithDefinition(apiBase, request, flowName, CHAIN_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });

    // Wait for edges to render (SVG paths may lag behind nodes)
    await expect(page.locator('.react-flow__edge')).toHaveCount(3, { timeout: 5_000 });

    // Select all nodes
    await selectAllNodes(page);

    // Verify all 4 nodes are selected
    const selectedCount = await getSelectedNodeCount(page);
    expect(selectedCount).toBe(4);

    // Copy and paste
    await page.keyboard.press(`${MOD}+c`);
    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);

    // Should now have 8 nodes (4 original + 4 pasted)
    await expect(page.locator('.react-flow__node')).toHaveCount(8, { timeout: 5_000 });

    // Should have 6 edges (3 original + 3 pasted internal edges)
    await expect(page.locator('.react-flow__edge')).toHaveCount(6, { timeout: 5_000 });

    // 4 pasted nodes should be selected
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(4, { timeout: 3_000 });
  });

  // ── Branching flow (if/else with two outputs) ─────────────────────────

  test('copy-paste a branching subgraph preserves conditional edges', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Branch Test';
    await createFlowWithDefinition(apiBase, request, flowName, BRANCHING_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(3, { timeout: 5_000 });

    // Select all nodes
    await selectAllNodes(page);
    const selectedCount = await getSelectedNodeCount(page);
    expect(selectedCount).toBe(4);

    // Copy and paste
    await page.keyboard.press(`${MOD}+c`);
    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);

    // 8 nodes and 6 edges
    await expect(page.locator('.react-flow__node')).toHaveCount(8, { timeout: 5_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(6, { timeout: 5_000 });
  });

  // ── Partial selection copies only internal edges ──────────────────────

  test('copying a partial selection only includes edges between selected nodes', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Partial Select Test';
    await createFlowWithDefinition(apiBase, request, flowName, CHAIN_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });

    // Select only the middle two nodes (Process and Format) via drag-select.
    // First fit view, then drag a box around just those two.
    const fitViewButton = page.getByRole('button', { name: 'Fit View' });
    if (await fitViewButton.count()) {
      await fitViewButton.click();
      await page.waitForTimeout(500);
    }

    const processNode = page.locator('.react-flow__node').filter({ hasText: 'Process' });
    const formatNode = page.locator('.react-flow__node').filter({ hasText: 'Format' });
    const processBox = await processNode.boundingBox();
    const formatBox = await formatNode.boundingBox();
    if (!processBox || !formatBox) {
      throw new Error('Could not get bounding boxes for Process/Format nodes');
    }

    const minX = Math.min(processBox.x, formatBox.x) - 10;
    const minY = Math.min(processBox.y, formatBox.y) - 10;
    const maxX = Math.max(processBox.x + processBox.width, formatBox.x + formatBox.width) + 10;
    const maxY = Math.max(processBox.y + processBox.height, formatBox.y + formatBox.height) + 10;

    await page.mouse.move(minX, minY);
    await page.mouse.down();
    await page.mouse.move(maxX, maxY, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2, { timeout: 3_000 });

    // Copy and paste
    await page.keyboard.press(`${MOD}+c`);
    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);

    // 6 nodes total (4 original + 2 pasted)
    await expect(page.locator('.react-flow__node')).toHaveCount(6, { timeout: 5_000 });

    // Only 1 new edge (Process→Format) from the paste, plus original 3 = 4 total
    await expect(page.locator('.react-flow__edge')).toHaveCount(4, { timeout: 5_000 });
  });
});

test.describe('Cut', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('cut removes selected nodes and allows paste', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Cut Test';
    await createFlowWithDefinition(apiBase, request, flowName, TWO_NODE_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 });

    // Select the JQ node
    await clickNode(page, 'Transform');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1, { timeout: 3_000 });

    // Cut (copies + removes)
    await page.keyboard.press(`${MOD}+x`);

    // Node should be removed
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 5_000 });

    // The edge should also be removed (it was connected to the cut node)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0, { timeout: 3_000 });

    // After cutting, the focused element (the cut node) was removed from the DOM.
    // We must refocus on the canvas so the paste keyboard handler fires.
    await deselectAll(page);

    // Paste it back
    await page.keyboard.press(`${MOD}+v`);

    // Should have 2 nodes again (original Input + pasted Transform)
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 5_000 });

    // But no edges restored — the cut node pasted as a standalone copy
    // (edges to non-selected nodes are not captured)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0, { timeout: 3_000 });
  });
});

test.describe('Duplicate', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Cmd+D duplicates selected nodes with edges', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Duplicate Test';
    await createFlowWithDefinition(apiBase, request, flowName, CHAIN_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });

    // Select all nodes
    await selectAllNodes(page);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(4, { timeout: 3_000 });

    // Duplicate
    await page.keyboard.press(`${MOD}+d`);

    // Should now have 8 nodes and 6 edges
    await expect(page.locator('.react-flow__node')).toHaveCount(8, { timeout: 5_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(6, { timeout: 5_000 });

    // Duplicated nodes should be selected (4 new ones)
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(4, { timeout: 3_000 });
  });

  test('Cmd+D on a single node creates a copy without edges', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Dup Single Test';
    await createFlowWithDefinition(apiBase, request, flowName, TWO_NODE_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 });

    // Select one node
    await clickNode(page, 'Data Source');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1, { timeout: 3_000 });

    // Duplicate
    await page.keyboard.press(`${MOD}+d`);

    // 3 nodes, same edge count (only internal edges are duplicated, single node has no internal edges)
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 5_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 3_000 });
  });
});

test.describe('Delete', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Backspace deletes selected nodes and their edges', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Delete Test';
    await createFlowWithDefinition(apiBase, request, flowName, CHAIN_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });

    // Select the middle node (Process)
    await clickNode(page, 'Process');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1, { timeout: 3_000 });

    // Delete
    await page.keyboard.press('Backspace');

    // 3 nodes remaining
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 5_000 });

    // Edges connected to the deleted node are also removed
    // Original: Source→Process, Process→Format, Format→Result
    // After deleting Process: only Format→Result remains
    await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 3_000 });
  });

  test('Delete key removes multi-selection', async ({ page, request, apiBase, navigateToFlow }) => {
    const flowName = 'CP Delete Multi Test';
    await createFlowWithDefinition(apiBase, request, flowName, CHAIN_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });

    // Select all nodes
    await selectAllNodes(page);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(4, { timeout: 3_000 });

    // Delete all
    await page.keyboard.press('Delete');

    // All nodes and edges removed
    await expect(page.locator('.react-flow__node')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(0, { timeout: 3_000 });
  });
});

test.describe('Repeated paste', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('pasting multiple times creates uniquely named nodes each time', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
  }) => {
    const flowName = 'CP Repeated Paste Test';
    await createFlowWithDefinition(apiBase, request, flowName, TWO_NODE_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 });

    // Select the Transform node
    await clickNode(page, 'Transform');

    // Copy
    await page.keyboard.press(`${MOD}+c`);

    // Paste 3 times — refocus on canvas between pastes since paste changes selection
    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 5_000 });

    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 5_000 });

    await deselectAll(page);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.locator('.react-flow__node')).toHaveCount(5, { timeout: 5_000 });

    // All names should be unique
    const names = await getNodeNames(page);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

test.describe('Focus guard', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
  test('copy-paste shortcuts are suppressed when config panel is open', async ({
    page,
    request,
    apiBase,
    navigateToFlow,
    openNodeConfigPanel,
    closeConfigPanel,
  }) => {
    const flowName = 'CP Focus Guard Test';
    await createFlowWithDefinition(apiBase, request, flowName, TWO_NODE_FLOW);
    await navigateToFlow(flowName);

    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 });

    // First: select a node and copy it while on the canvas
    await clickNode(page, 'Transform');
    await page.keyboard.press(`${MOD}+c`);

    // Now open config panel (dialog) for the same node
    await openNodeConfigPanel('Transform');

    // Try to paste — should NOT work because focus is in a dialog
    await page.keyboard.press(`${MOD}+v`);
    await page.waitForTimeout(500);

    // Close the panel
    await closeConfigPanel();

    // Nodes should still be 2 — the paste should have been suppressed
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 3_000 });
  });
});
