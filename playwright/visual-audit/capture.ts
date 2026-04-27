/**
 * Visual Audit — Screenshot Capture Script
 *
 * A Playwright "test" that navigates every major UI state and saves annotated
 * screenshots + metadata.json to `playwright/visual-audit/output/`.
 *
 * Uses the same isolated-server pattern as critical-paths tests:
 *   - Fresh SQLite DB per worker
 *   - Express server on a random port
 *   - Route interception so the Vite frontend talks to the isolated server
 *
 * Run: pnpm ux:capture
 */

import { type Page, type APIRequestContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS, SEED_FLOWS, type ScreenDefinition } from './screens';
import { createSqliteBrowserIsolationTest, expect } from '../test-support/sqlite-isolation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VITE_BASE = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

// ─── Metadata tracking ────────────────────────────────────────────────────

interface ScreenshotMeta {
  id: string;
  filename: string;
  focusCrop: string | null;
  description: string;
  url: string;
  tags: string[];
  viewport: { width: number; height: number };
}

const capturedMetadata: ScreenshotMeta[] = [];

async function takeScreenshot(page: Page, screen: ScreenDefinition, currentUrl: string) {
  const viewport = screen.viewport ?? DEFAULT_VIEWPORT;
  await page.setViewportSize(viewport);
  // Small settle time for layout reflows
  await page.waitForTimeout(500);

  const filename = `${screen.id}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename) });

  let focusCrop: string | null = null;
  if (screen.focusCropSelector) {
    const locator = page.locator(screen.focusCropSelector).first();
    if (await locator.isVisible().catch(() => false)) {
      focusCrop = `${screen.id}-focus.png`;
      await locator.screenshot({ path: path.join(SCREENSHOTS_DIR, focusCrop) });
    }
  }

  capturedMetadata.push({
    id: screen.id,
    filename,
    focusCrop,
    description: screen.description,
    url: currentUrl,
    tags: screen.tags,
    viewport,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getSidebarToggle(page: Page) {
  return page.locator('.imp-sidebar-shell button.absolute').first();
}

async function ensureSidebarExpanded(page: Page) {
  const label = page.locator('.imp-sidebar-shell nav span').filter({ hasText: 'Executions' });
  if (!(await label.isVisible().catch(() => false))) {
    await getSidebarToggle(page).click();
    await expect(label).toBeVisible({ timeout: 3_000 });
  }
}

async function enableDarkMode(page: Page) {
  await ensureSidebarExpanded(page);
  const btn = page.locator('.imp-sidebar-shell button').filter({ hasText: 'Dark Mode' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(page.locator('.flowlib').first()).toHaveClass(/\bdark\b/, { timeout: 3_000 });
  }
}

async function enableLightMode(page: Page) {
  await ensureSidebarExpanded(page);
  const btn = page.locator('.imp-sidebar-shell button').filter({ hasText: 'Light Mode' });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(page.locator('.flowlib').first()).not.toHaveClass(/\bdark\b/, { timeout: 3_000 });
  }
}

async function waitForDashboard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  await page
    .getByText('Loading flows')
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
}

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

// ─── Fixtures ─────────────────────────────────────────────────────────────

type WorkerFixtures = {
  apiBase: string;
};

type TestFixtures = {
  _routeInterception: void;
};

const rootDir = path.resolve(__dirname, '../..');
const test = createSqliteBrowserIsolationTest({
  apiPrefix: '/flowlib',
  apiRoutePrefix: '/api/flowlib',
  dbFilePrefix: 'flowlib-va',
  readyPath: '/health',
  serverCwd: path.join(rootDir, 'playwright'),
  serverScript: path.join(rootDir, 'playwright/test-support/express-test-server.ts'),
  sharedOrigin: VITE_BASE,
});

// ─── Main capture test ────────────────────────────────────────────────────

test.describe('Visual Audit — Screenshot Capture', () => {
  let dataPipelineId: string | null = null;
  let aiAssistantId: string | null = null;
  let agentEmptyFlowId: string | null = null;
  let agentWithToolsFlowId: string | null = null;

  test.beforeAll(async ({ request, apiBase }) => {
    // Ensure output directories exist
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    // Seed flows
    for (const [key, flow] of Object.entries(SEED_FLOWS)) {
      const resp = await request.post(`${apiBase}/flows`, {
        data: { name: flow.name },
      });
      if (!resp.ok()) {
        console.error(
          `[SEED] Failed to create flow "${flow.name}": ${resp.status()} ${resp.statusText()} — ${await resp.text().catch(() => '(no body)')}`,
        );
        continue;
      }
      const created = await resp.json();
      const flowId = created.id;

      if (key === 'dataPipeline') {
        dataPipelineId = flowId;
      }
      if (key === 'aiAssistant') {
        aiAssistantId = flowId;
      }
      if (key === 'agentEmpty') {
        agentEmptyFlowId = flowId;
      }
      if (key === 'agentWithTools') {
        agentWithToolsFlowId = flowId;
      }

      await request.post(`${apiBase}/flows/${flowId}/versions`, {
        data: { flowlibDefinition: flow.definition },
      });
    }
  });

  test('capture all screens', async ({ page, apiBase, request }) => {
    const screensById = Object.fromEntries(SCREENS.map((s) => [s.id, s]));

    // ── 01: Dashboard collapsed ───────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib`);
    await waitForDashboard(page);
    await takeScreenshot(page, screensById['01-dashboard-collapsed']!, '/flowlib');

    // ── 02: Dashboard expanded ────────────────────────────────────────────
    await ensureSidebarExpanded(page);
    await takeScreenshot(page, screensById['02-dashboard-expanded']!, '/flowlib');

    // ── 03: Executions page ───────────────────────────────────────────────
    await page.locator('.imp-sidebar-shell').getByRole('link', { name: 'Executions' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Executions' })).toBeVisible({
      timeout: 15_000,
    });
    await takeScreenshot(page, screensById['03-executions-page']!, '/flowlib/executions');

    // ── 04: Credentials page ──────────────────────────────────────────────
    await page.locator('.imp-sidebar-shell').getByRole('link', { name: 'Credentials' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
    await takeScreenshot(page, screensById['04-credentials-page']!, '/flowlib/credentials');

    // ── 05: Add Flow modal ────────────────────────────────────────────────
    await page.locator('.imp-sidebar-shell').getByRole('link', { name: 'Home' }).click();
    await waitForDashboard(page);
    // Look for a "New Flow" button
    const newFlowBtn = page.getByRole('button', { name: /new flow/i }).first();
    if (await newFlowBtn.isVisible().catch(() => false)) {
      await newFlowBtn.click();
      await page.waitForTimeout(500);
      await takeScreenshot(page, screensById['05-add-flow-modal']!, '/flowlib');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 06: Add Credential modal ──────────────────────────────────────────
    await page.locator('.imp-sidebar-shell').getByRole('link', { name: 'Credentials' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
    const addCredBtn = page.getByRole('button', { name: /add|create|new/i }).first();
    if (await addCredBtn.isVisible().catch(() => false)) {
      await addCredBtn.click();
      await page.waitForTimeout(500);
      await takeScreenshot(page, screensById['06-add-credential-modal']!, '/flowlib/credentials');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 06b: Credential edit modal ───────────────────────────────────────
    const editCredName = 'Visual Audit Edit Credential';
    await request.post(`${apiBase}/credentials`, {
      data: {
        name: editCredName,
        type: 'http-api',
        authType: 'bearer',
        config: { token: 'va-edit-token' },
        description: 'Credential seeded for edit modal visual capture',
      },
    });
    await page.goto(`${VITE_BASE}/flowlib/credentials`);
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible({
      timeout: 15_000,
    });
    const seededCredRow = page.getByRole('button', { name: new RegExp(editCredName, 'i') }).first();
    if (await seededCredRow.isVisible().catch(() => false)) {
      await seededCredRow.click();
      await page
        .getByRole('dialog')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      const editTab = page.getByRole('dialog').getByRole('button', { name: 'Edit' });
      if (await editTab.isVisible().catch(() => false)) {
        await editTab.click();
      }
      await page.waitForTimeout(500);
      await takeScreenshot(page, screensById['06b-credential-edit-modal']!, '/flowlib/credentials');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 07: Editor canvas (Data Pipeline) ─────────────────────────────────
    const flowId = dataPipelineId ?? (await getFlowIdByName(apiBase, request, 'Data Pipeline'));
    expect(flowId, 'Data Pipeline flow must exist').not.toBeNull();

    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000); // Let canvas settle
    await takeScreenshot(page, screensById['07-editor-canvas']!, `/flowlib/flow/${flowId}`);

    // ── 08: Node selected ─────────────────────────────────────────────────
    const transformNode = page.locator('.react-flow__node').filter({ hasText: 'Transform' });
    if (await transformNode.isVisible().catch(() => false)) {
      await transformNode.click();
      await page.waitForTimeout(300);
    }
    await takeScreenshot(page, screensById['08-node-selected']!, `/flowlib/flow/${flowId}`);

    // ── 09: Input node config panel ───────────────────────────────────────
    const inputNode = page.locator('.react-flow__node').filter({ hasText: 'User Data' });
    if (await inputNode.isVisible().catch(() => false)) {
      await inputNode.dblclick();
      await page
        .getByRole('dialog')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['09-input-config-panel']!, `/flowlib/flow/${flowId}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── 10: JQ node config panel ──────────────────────────────────────────
    if (await transformNode.isVisible().catch(() => false)) {
      await transformNode.dblclick();
      await page
        .getByRole('dialog')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['10-jq-config-panel']!, `/flowlib/flow/${flowId}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── 11: Agent node config panel (AI Assistant flow) ───────────────────
    const agentFlowId = aiAssistantId ?? (await getFlowIdByName(apiBase, request, 'AI Assistant'));
    if (agentFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${agentFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);

      const agentNode = page.locator('.react-flow__node').filter({ hasText: 'Research Agent' });
      if (await agentNode.isVisible().catch(() => false)) {
        await agentNode.dblclick();
        await page
          .getByRole('dialog')
          .waitFor({ state: 'visible', timeout: 5_000 })
          .catch(() => {});
        await page.waitForTimeout(500);
      }
      await takeScreenshot(
        page,
        screensById['11-agent-config-panel']!,
        `/flowlib/flow/${agentFlowId}`,
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 12: Editor toolbar ────────────────────────────────────────────────
    // Go back to data pipeline to capture toolbar
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await takeScreenshot(page, screensById['12-editor-toolbar']!, `/flowlib/flow/${flowId}`);

    // ── Chat Assistant Screenshots ────────────────────────────────────────

    // Create an LLM credential via API for the chat to use
    const credResp = await request.post(`${apiBase}/credentials`, {
      data: {
        name: 'OpenAI GPT-4o',
        type: 'llm',
        authType: 'api_key',
        config: { apiKey: 'sk-mock-key-for-visual-audit', provider: 'openai' },
        description: 'OpenAI API key for chat assistant',
      },
    });
    const credentialId = credResp.ok() ? (await credResp.json()).id : null;

    // Navigate to the data pipeline flow for chat screenshots
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    // ── 13: Chat panel — no credential state ──────────────────────────────
    // Open chat panel via the Assistant button
    const chatToggle = page.locator('button', { hasText: 'Assistant' });
    if (await chatToggle.isVisible().catch(() => false)) {
      await chatToggle.click();
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['13-chat-no-credential']!, `/flowlib/flow/${flowId}`);

    // ── 14: Chat settings panel ───────────────────────────────────────────
    // Click the settings gear icon in the chat header
    const settingsButton = page.locator("button[title='Chat settings']");
    if (await settingsButton.isVisible().catch(() => false)) {
      await settingsButton.click();
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['14-chat-settings-panel']!, `/flowlib/flow/${flowId}`);

    // Close settings panel — click the "Back to chat" arrow button in the overlay header
    const backButton = page.locator("button[title='Back to chat']");
    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click();
      await page.waitForTimeout(300);
    }

    // ── 15: Chat panel — ready state (with credential) ────────────────────
    // Set the credential in localStorage so the chat recognises it
    if (credentialId) {
      await page.evaluate((cId) => {
        localStorage.setItem(
          'flowlib-chat-settings',
          JSON.stringify({ maxSteps: 8, credentialId: cId }),
        );
      }, credentialId);
    }
    // Reload to pick up the stored credential
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    // Re-open chat panel
    const chatToggle2 = page.locator('button', { hasText: 'Assistant' });
    if (await chatToggle2.isVisible().catch(() => false)) {
      await chatToggle2.click();
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['15-chat-ready']!, `/flowlib/flow/${flowId}`);

    // ── 16–19: Chat conversation states ───────────────────────────────────
    // We mock the /chat/messages/:flowId endpoint to return pre-built
    // conversations. The API returns a raw array (not wrapped in { messages }).
    // createdAt must be ISO strings to match the DB format.

    const now = new Date();
    const isoMinusMin = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();

    const mockMessages = {
      turn1: [
        {
          id: 'msg-1',
          flowId: flowId,
          role: 'user',
          content: 'Add a JQ node after the input that filters only active users from the data',
          toolMeta: null,
          createdAt: isoMinusMin(1),
        },
      ],
      turn1Reply: [
        {
          id: 'msg-1',
          flowId: flowId,
          role: 'user',
          content: 'Add a JQ node after the input that filters only active users from the data',
          toolMeta: null,
          createdAt: isoMinusMin(4),
        },
        {
          id: 'msg-2',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'get_flow',
            args: { flowId: flowId },
            result: { success: true, data: { nodes: 3, edges: 2, name: 'Data Pipeline' } },
            status: 'done',
          },
          createdAt: isoMinusMin(3.5),
        },
        {
          id: 'msg-3',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'update_flow',
            args: {
              nodeType: 'core.jq',
              label: 'Filter Active',
              query: '.user_data | .users[] | select(.active)',
            },
            result: {
              success: true,
              data: { message: "Added JQ node 'Filter Active' and connected it after 'User Data'" },
            },
            status: 'done',
          },
          createdAt: isoMinusMin(3),
        },
        {
          id: 'msg-4',
          flowId: flowId,
          role: 'assistant',
          content:
            'I\'ve added a **JQ node** called "Filter Active" after the User Data input. It uses the query:\n\n```jq\n.user_data | .users[] | select(.active)\n```\n\nThis will filter the users array to only include entries where `active` is `true`. The node is connected between User Data and Transform.',
          toolMeta: null,
          createdAt: isoMinusMin(2.5),
        },
      ],
      multiTurn: [
        {
          id: 'msg-1',
          flowId: flowId,
          role: 'user',
          content: 'Add a JQ node after the input that filters only active users from the data',
          toolMeta: null,
          createdAt: isoMinusMin(10),
        },
        {
          id: 'msg-2',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'get_flow',
            args: { flowId: flowId },
            result: { success: true, data: { nodes: 3, edges: 2, name: 'Data Pipeline' } },
            status: 'done',
          },
          createdAt: isoMinusMin(9.5),
        },
        {
          id: 'msg-3',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'update_flow',
            args: {
              nodeType: 'core.jq',
              label: 'Filter Active',
              query: '.user_data | .users[] | select(.active)',
            },
            result: {
              success: true,
              data: { message: "Added JQ node 'Filter Active' and connected it after 'User Data'" },
            },
            status: 'done',
          },
          createdAt: isoMinusMin(9),
        },
        {
          id: 'msg-4',
          flowId: flowId,
          role: 'assistant',
          content:
            'Done! I\'ve added a **JQ node** called "Filter Active" that filters to only active users. It\'s connected between User Data and Transform.',
          toolMeta: null,
          createdAt: isoMinusMin(8.5),
        },
        {
          id: 'msg-5',
          flowId: flowId,
          role: 'user',
          content:
            'Now add an HTTP request node at the end that POSTs the results to https://api.example.com/users',
          toolMeta: null,
          createdAt: isoMinusMin(5),
        },
        {
          id: 'msg-6',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'get_flow',
            args: { flowId: flowId },
            result: { success: true, data: { nodes: 4, edges: 3, name: 'Data Pipeline' } },
            status: 'done',
          },
          createdAt: isoMinusMin(4.5),
        },
        {
          id: 'msg-7',
          flowId: flowId,
          role: 'assistant',
          content: '',
          toolMeta: {
            toolName: 'update_flow',
            args: {
              nodeType: 'http.request',
              label: 'POST Results',
              method: 'POST',
              url: 'https://api.example.com/users',
              body: '{{ results }}',
            },
            result: {
              success: true,
              data: { message: "Added HTTP Request node 'POST Results' after 'Results'" },
            },
            status: 'done',
          },
          createdAt: isoMinusMin(4),
        },
        {
          id: 'msg-8',
          flowId: flowId,
          role: 'assistant',
          content:
            'I\'ve added an **HTTP Request** node called "POST Results" at the end of the flow. It will:\n\n- **Method**: POST\n- **URL**: `https://api.example.com/users`\n- **Body**: The output from the Results node\n\nThe flow now runs: User Data → Filter Active → Transform → Results → POST Results.',
          toolMeta: null,
          createdAt: isoMinusMin(3.5),
        },
      ],
    };

    // Mock the chat messages endpoint to return our pre-built conversations.
    // The route is registered AFTER the general API rewrite interceptor,
    // so Playwright checks it first (LIFO order).
    const chatMsgUrl = `${VITE_BASE}/api/flowlib/chat/messages/${flowId}`;

    // ── 16: Single user message ───────────────────────────────────────────
    await page.route(chatMsgUrl, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockMessages.turn1),
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const chatToggle3 = page.locator('button', { hasText: 'Assistant' });
    if (await chatToggle3.isVisible().catch(() => false)) {
      await chatToggle3.click();
      await page.waitForTimeout(800);
    }
    await takeScreenshot(page, screensById['16-chat-user-message']!, `/flowlib/flow/${flowId}`);
    await page.unroute(chatMsgUrl);

    // ── 17: Assistant reply with tool calls ────────────────────────────────
    await page.route(chatMsgUrl, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockMessages.turn1Reply),
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const chatToggle4 = page.locator('button', { hasText: 'Assistant' });
    if (await chatToggle4.isVisible().catch(() => false)) {
      await chatToggle4.click();
      await page.waitForTimeout(800);
    }
    await takeScreenshot(page, screensById['17-chat-assistant-reply']!, `/flowlib/flow/${flowId}`);

    // ── 18: Tool call expanded ────────────────────────────────────────────
    // Click on the first tool call CollapsibleTrigger to expand it
    // Tool labels are "get flow", "update flow" (underscores → spaces, CSS capitalize for display)
    const toolCallTrigger = page
      .locator('button')
      .filter({ hasText: /get flow|update flow/i })
      .first();
    if (await toolCallTrigger.isVisible().catch(() => false)) {
      await toolCallTrigger.click();
      await page.waitForTimeout(400);
    }
    await takeScreenshot(page, screensById['18-chat-tool-expanded']!, `/flowlib/flow/${flowId}`);
    await page.unroute(chatMsgUrl);

    // ── 19: Multi-turn conversation ───────────────────────────────────────
    await page.route(chatMsgUrl, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockMessages.multiTurn),
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const chatToggle5 = page.locator('button', { hasText: 'Assistant' });
    if (await chatToggle5.isVisible().catch(() => false)) {
      await chatToggle5.click();
      await page.waitForTimeout(800);
    }
    await takeScreenshot(page, screensById['19-chat-multi-turn']!, `/flowlib/flow/${flowId}`);
    await page.unroute(chatMsgUrl);

    // ── 20: Dashboard dark mode ───────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib`);
    await waitForDashboard(page);
    await enableDarkMode(page);
    await takeScreenshot(page, screensById['20-dashboard-dark']!, '/flowlib');

    // ── 21: Editor dark mode ──────────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await takeScreenshot(page, screensById['21-editor-dark']!, `/flowlib/flow/${flowId}`);

    // Restore light mode
    await enableLightMode(page);

    // ── Agent Node & Tools Configuration ────────────────────────────────

    // ── 22: Agent node canvas — empty (no tools) ─────────────────────────
    const assistantFlowId =
      aiAssistantId ?? (await getFlowIdByName(apiBase, request, 'AI Assistant'));
    if (assistantFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${assistantFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      await takeScreenshot(
        page,
        screensById['22-agent-node-canvas-empty']!,
        `/flowlib/flow/${assistantFlowId}`,
      );
    }

    // ── 23: Agent node canvas — with tools ───────────────────────────────
    const withToolsFlowId =
      agentWithToolsFlowId ?? (await getFlowIdByName(apiBase, request, 'Agent With Tools'));
    if (withToolsFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${withToolsFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      await takeScreenshot(
        page,
        screensById['23-agent-node-canvas-with-tools']!,
        `/flowlib/flow/${withToolsFlowId}`,
      );
    }

    // ── 24: Agent config panel — empty state (bare agent node) ───────────
    const emptyAgentFlowId =
      agentEmptyFlowId ?? (await getFlowIdByName(apiBase, request, 'Empty Agent Flow'));
    if (emptyAgentFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${emptyAgentFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      const emptyAgentNode = page.locator('.react-flow__node').filter({ hasText: /AI Agent/i });
      if (await emptyAgentNode.isVisible().catch(() => false)) {
        await emptyAgentNode.dblclick();
        await page
          .getByRole('dialog')
          .waitFor({ state: 'visible', timeout: 5_000 })
          .catch(() => {});
        await page.waitForTimeout(500);
      }
      await takeScreenshot(
        page,
        screensById['24-agent-config-panel-empty']!,
        `/flowlib/flow/${emptyAgentFlowId}`,
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 25: Agent config panel — seeded (Research Agent) ─────────────────
    if (assistantFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${assistantFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      const researchAgentNode = page
        .locator('.react-flow__node')
        .filter({ hasText: /Research Agent/i });
      if (await researchAgentNode.isVisible().catch(() => false)) {
        await researchAgentNode.dblclick();
        await page
          .getByRole('dialog')
          .waitFor({ state: 'visible', timeout: 5_000 })
          .catch(() => {});
        await page.waitForTimeout(500);
      }
      await takeScreenshot(
        page,
        screensById['25-agent-config-panel-seeded']!,
        `/flowlib/flow/${assistantFlowId}`,
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ── 26: Agent actions sidebar — empty (no tools added yet) ───────────
    // Click "Add Tools" on the agent node with no tools to open the actions sidebar
    if (assistantFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${assistantFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      // Click the "Add Tools" dashed button inside the AgentToolsBox
      const addToolsBtn = page
        .locator('.react-flow__node')
        .filter({ hasText: /Research Agent/i })
        .getByText('Add Tools');
      if (await addToolsBtn.isVisible().catch(() => false)) {
        await addToolsBtn.click();
        await page.waitForTimeout(800);
      }
      await takeScreenshot(
        page,
        screensById['26-agent-actions-sidebar-empty']!,
        `/flowlib/flow/${assistantFlowId}`,
      );
    }

    // ── 27: Agent actions sidebar — seeded (tools already added) ─────────
    // Click "Configure" on the agent node that already has tools
    if (withToolsFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${withToolsFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      // Click the "Configure" button in the non-empty AgentToolsBox
      const configureBtn = page
        .locator('.react-flow__node')
        .filter({ hasText: /Data Agent/i })
        .getByText('Configure');
      if (await configureBtn.isVisible().catch(() => false)) {
        await configureBtn.click();
        await page.waitForTimeout(800);
      }
      await takeScreenshot(
        page,
        screensById['27-agent-actions-sidebar-seeded']!,
        `/flowlib/flow/${withToolsFlowId}`,
      );
    }

    // ── 28: Tool config panel ─────────────────────────────────────────────
    // Click on a tool tile in the AgentToolsBox to open the ToolConfigPanel
    if (withToolsFlowId) {
      await page.goto(`${VITE_BASE}/flowlib/flow/${withToolsFlowId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      // Click the first tool tile (HTTP Request) in the AgentToolsBox
      const toolTile = page
        .locator('.react-flow__node')
        .filter({ hasText: /Data Agent/i })
        .locator("[title='HTTP Request']")
        .first();
      const fallbackTile = page
        .locator('.react-flow__node')
        .filter({ hasText: /Data Agent/i })
        .locator("[title='Math Evaluate']")
        .first();
      const tileToClick = (await toolTile.isVisible().catch(() => false)) ? toolTile : fallbackTile;
      if (await tileToClick.isVisible().catch(() => false)) {
        await tileToClick.click();
        await page.waitForTimeout(600);
      }
      await takeScreenshot(
        page,
        screensById['28-tool-config-panel']!,
        `/flowlib/flow/${withToolsFlowId}`,
      );
    }

    // ── Plugin Pages ──────────────────────────────────────────────────────

    // The RbacProvider needs GET /plugins/auth/me to determine auth state.
    // Register this mock first so it's available for all plugin page navigations.
    const pluginApiBase = `${VITE_BASE}/api/flowlib`;

    const mockAuthMe = {
      identity: { id: 'test-user', name: 'Test User', role: 'admin', resolvedRole: 'admin' },
      permissions: ['admin:*', 'flow:read', 'flow:write', 'flow:delete'],
      isAuthenticated: true,
    };
    await page.route(`${pluginApiBase}/plugins/auth/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAuthMe),
      });
    });

    const mockUsers = [
      {
        id: 'u1',
        name: 'Admin User',
        email: 'admin@company.com',
        role: 'admin',
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      },
      {
        id: 'u2',
        name: 'Jane Developer',
        email: 'jane@company.com',
        role: 'editor',
        createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      },
      {
        id: 'u3',
        name: 'Bob Viewer',
        email: 'bob@company.com',
        role: 'viewer',
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      },
      {
        id: 'u4',
        name: 'Eve Operator',
        email: 'eve@company.com',
        role: 'operator',
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      },
    ];

    // ════════════════════════════════════════════════════════════════════════
    // WEBHOOKS PLUGIN FLOW
    // ════════════════════════════════════════════════════════════════════════

    // ── 29: Webhooks empty state ──────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib/webhooks`);
    await page.waitForTimeout(1500);
    await takeScreenshot(page, screensById['29-webhooks-empty']!, '/flowlib/webhooks');

    // ── 30: Create webhook modal (form) ───────────────────────────────────
    const newWebhookBtn = page.getByRole('button', { name: /new webhook/i });
    if (await newWebhookBtn.isVisible().catch(() => false)) {
      await newWebhookBtn.click();
      await page
        .getByRole('dialog')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(400);

      // Fill in some data so the form looks realistic
      const nameInput = page.locator('#wh-create-name');
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Partner API Events');
      }
      const descInput = page.locator('#wh-create-desc');
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill('Receives webhook events from partner integrations');
      }
      await page.waitForTimeout(300);
    }
    await takeScreenshot(page, screensById['30-webhook-create-form']!, '/flowlib/webhooks');

    // ── 31: Create webhook modal (success) ────────────────────────────────
    const createWhBtn = page.getByRole('button', { name: /create webhook/i });
    if (await createWhBtn.isVisible().catch(() => false)) {
      await createWhBtn.click();
      await page
        .getByText('Webhook is ready')
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['31-webhook-create-success']!, '/flowlib/webhooks');

    // Close the success modal
    const doneBtn = page.getByRole('button', { name: /done/i });
    if (await doneBtn.isVisible().catch(() => false)) {
      await doneBtn.click();
      await page.waitForTimeout(500);
    }

    // ── 32: Webhooks list (populated) ─────────────────────────────────────
    await page.waitForTimeout(1000);
    await takeScreenshot(page, screensById['32-webhooks-list']!, '/flowlib/webhooks');

    // ── 33: Webhook detail panel (overview tab) ──────────────────────────
    const webhookRow = page.locator('button.w-full.text-left').first();
    if (await webhookRow.isVisible().catch(() => false)) {
      await webhookRow.click();
      await page
        .getByRole('dialog')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
    }
    await takeScreenshot(page, screensById['33-webhook-detail-overview']!, '/flowlib/webhooks');

    // ── 34: Webhook detail panel (edit tab) ──────────────────────────────
    const editTab = page.getByRole('dialog').getByRole('button', { name: 'Edit' });
    if (await editTab.isVisible().catch(() => false)) {
      await editTab.click();
      await page.waitForTimeout(500);
    }
    await takeScreenshot(page, screensById['34-webhook-detail-edit']!, '/flowlib/webhooks');

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ════════════════════════════════════════════════════════════════════════
    // AUTH / USERS PLUGIN FLOW
    // ════════════════════════════════════════════════════════════════════════

    // Mock auth users endpoint for the Users page
    await page.route(`${pluginApiBase}/plugins/auth/users**`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ users: mockUsers }),
        });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              id: 'u-new',
              name: body.name || 'New User',
              email: body.email,
              role: body.role || 'viewer',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // ── 35: Users page with list ──────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib/users`);
    await page.waitForTimeout(1500);
    await takeScreenshot(page, screensById['35-users-list']!, '/flowlib/users');

    // ── 36: Create user form expanded ─────────────────────────────────────
    const createUserBtn = page.getByRole('button', { name: /create user/i });
    if (await createUserBtn.isVisible().catch(() => false)) {
      await createUserBtn.click();
      await page.waitForTimeout(400);

      // Fill in form fields for a realistic screenshot
      const nameField = page.getByPlaceholder('User name');
      if (await nameField.isVisible().catch(() => false)) {
        await nameField.fill('Sarah Engineer');
      }
      const emailField = page.getByPlaceholder('user@example.com');
      if (await emailField.isVisible().catch(() => false)) {
        await emailField.fill('sarah@company.com');
      }
      const pwField = page.getByPlaceholder('Min 8 characters');
      if (await pwField.isVisible().catch(() => false)) {
        await pwField.fill('securepass123');
      }
      await page.waitForTimeout(300);
    }
    await takeScreenshot(page, screensById['36-users-create-form']!, '/flowlib/users');

    // Close the create form
    const cancelCreateBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelCreateBtn.isVisible().catch(() => false)) {
      await cancelCreateBtn.click();
      await page.waitForTimeout(300);
    }

    await page.unroute(`${pluginApiBase}/plugins/auth/users**`);

    // ── 37: Profile page ──────────────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib/profile`);
    await page.waitForTimeout(1500);
    await takeScreenshot(page, screensById['37-user-profile']!, '/flowlib/profile');

    // ── 38: Sidebar user menu ─────────────────────────────────────────────
    await page.goto(`${VITE_BASE}/flowlib`);
    await waitForDashboard(page);
    await ensureSidebarExpanded(page);
    const userMenuLink = page
      .locator('.imp-sidebar-shell')
      .locator('a, button')
      .filter({ hasText: /Test User/i })
      .first();
    if (await userMenuLink.isVisible().catch(() => false)) {
      await page.waitForTimeout(300);
    }
    await takeScreenshot(page, screensById['38-sidebar-user-menu']!, '/flowlib');

    // ════════════════════════════════════════════════════════════════════════
    // RBAC / ACCESS CONTROL PLUGIN FLOW
    // ════════════════════════════════════════════════════════════════════════

    const now31 = new Date().toISOString();
    const mockTeams = [
      {
        id: 'team-eng',
        name: 'Engineering',
        description: 'Engineering team',
        parentId: null,
        createdBy: 'u1',
        createdAt: now31,
        updatedAt: now31,
      },
      {
        id: 'team-data',
        name: 'Data Science',
        description: 'Data team',
        parentId: 'team-eng',
        createdBy: 'u1',
        createdAt: now31,
        updatedAt: now31,
      },
    ];

    const mockScopeTree = {
      scopes: [
        {
          id: 'team-eng',
          name: 'Engineering',
          description: 'Engineering team',
          parentId: null,
          createdBy: 'u1',
          createdAt: now31,
          updatedAt: now31,
          children: [
            {
              id: 'team-data',
              name: 'Data Science',
              description: 'Data team',
              parentId: 'team-eng',
              createdBy: 'u1',
              createdAt: now31,
              updatedAt: now31,
              children: [],
              flows: dataPipelineId
                ? [{ id: dataPipelineId, name: 'Data Pipeline', scopeId: 'team-data' }]
                : [],
              directAccessCount: 2,
              memberCount: 3,
              teamPermission: 'editor',
            },
          ],
          flows: aiAssistantId
            ? [{ id: aiAssistantId, name: 'AI Assistant', scopeId: 'team-eng' }]
            : [],
          directAccessCount: 3,
          memberCount: 5,
          teamPermission: null,
        },
      ],
      unscopedFlows: [
        ...(agentEmptyFlowId
          ? [{ id: agentEmptyFlowId, name: 'Empty Agent Flow', scopeId: null }]
          : []),
        ...(agentWithToolsFlowId
          ? [{ id: agentWithToolsFlowId, name: 'Agent With Tools', scopeId: null }]
          : []),
      ],
    };

    // Register all RBAC mocks
    await page.route(`${pluginApiBase}/plugins/rbac/scopes/tree`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockScopeTree),
      });
    });

    await page.route(`${pluginApiBase}/plugins/rbac/teams`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ teams: mockTeams }),
        });
      } else {
        await route.fallback();
      }
    });

    // Mock team detail when a team is selected (ScopeDetailPanel)
    await page.route(`${pluginApiBase}/plugins/rbac/teams/team-eng`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...mockTeams[0],
            members: [
              { id: 'm1', teamId: 'team-eng', userId: 'u1', createdAt: now31 },
              { id: 'm2', teamId: 'team-eng', userId: 'u2', createdAt: now31 },
              { id: 'm3', teamId: 'team-eng', userId: 'u3', createdAt: now31 },
            ],
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Mock scope access for team-eng
    await page.route(`${pluginApiBase}/plugins/rbac/scopes/team-eng/access`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access: [
              {
                id: 'sa1',
                scopeId: 'team-eng',
                userId: 'u2',
                teamId: null,
                permission: 'editor',
                grantedBy: 'u1',
                grantedAt: now31,
              },
              {
                id: 'sa2',
                scopeId: 'team-eng',
                userId: null,
                teamId: 'team-data',
                permission: 'viewer',
                grantedBy: 'u1',
                grantedAt: now31,
              },
            ],
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Mock effective flow access for selected flows (FlowDetailPanel)
    await page.route(`${pluginApiBase}/plugins/rbac/flows/*/effective-access`, async (route) => {
      const url = route.request().url();
      const flowIdMatch = url.match(/\/flows\/([^/]+)\/effective-access/);
      const fId = flowIdMatch?.[1] ?? 'unknown';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flowId: fId,
          scopeId: 'team-eng',
          records: [
            {
              id: 'fa1',
              flowId: fId,
              userId: 'u1',
              teamId: null,
              permission: 'owner',
              source: 'direct',
              grantedBy: null,
              grantedAt: now31,
            },
            {
              id: 'fa2',
              flowId: fId,
              userId: 'u2',
              teamId: null,
              permission: 'editor',
              source: 'inherited',
              scopeId: 'team-eng',
              scopeName: 'Engineering',
              grantedBy: 'u1',
              grantedAt: now31,
            },
            {
              id: 'fa3',
              flowId: fId,
              userId: 'u3',
              teamId: null,
              permission: 'viewer',
              source: 'inherited',
              scopeId: 'team-data',
              scopeName: 'Data Science',
              grantedBy: 'u1',
              grantedAt: now31,
            },
          ],
        }),
      });
    });

    // Mock flow access for share dialog
    await page.route(`${pluginApiBase}/plugins/rbac/flows/*/access`, async (route) => {
      const url = route.request().url();
      const flowIdMatch = url.match(/\/flows\/([^/]+)\/access/);
      const fId = flowIdMatch?.[1] ?? 'unknown';
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access: [
              {
                id: 'da1',
                flowId: fId,
                userId: 'test-user',
                teamId: null,
                permission: 'owner',
                grantedBy: null,
                grantedAt: now31,
              },
              {
                id: 'da2',
                flowId: fId,
                userId: 'u2',
                teamId: null,
                permission: 'editor',
                grantedBy: 'test-user',
                grantedAt: now31,
              },
              {
                id: 'da3',
                flowId: fId,
                userId: 'u3',
                teamId: null,
                permission: 'viewer',
                grantedBy: 'test-user',
                grantedAt: now31,
              },
            ],
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Re-register auth users mock (needed by RBAC useUsers hook)
    await page.route(`${pluginApiBase}/plugins/auth/users**`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ users: mockUsers }),
        });
      } else {
        await route.fallback();
      }
    });

    // ── 39: Access Control page with tree (right pane empty) ──────────────
    await page.goto(`${VITE_BASE}/flowlib/access`);
    await expect(page.getByRole('heading', { name: 'Access Control' }))
      .toBeVisible({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    await takeScreenshot(page, screensById['39-access-control-tree']!, '/flowlib/access');

    // ── 40: Team selected — ScopeDetailPanel ─────────────────────────────
    const engTeam = page.getByText('Engineering').first();
    if (await engTeam.isVisible().catch(() => false)) {
      await engTeam.click();
      await page.waitForTimeout(1000);
    }
    await takeScreenshot(page, screensById['40-access-control-team-detail']!, '/flowlib/access');

    // ── 41: Flow selected — FlowDetailPanel ──────────────────────────────
    const flowInTree = page.getByText('AI Assistant').first();
    if (await flowInTree.isVisible().catch(() => false)) {
      await flowInTree.click();
      await page.waitForTimeout(1000);
    }
    await takeScreenshot(page, screensById['41-access-control-flow-detail']!, '/flowlib/access');

    // Clean up RBAC mocks
    await page.unroute(`${pluginApiBase}/plugins/rbac/scopes/tree`);
    await page.unroute(`${pluginApiBase}/plugins/rbac/teams`);
    await page.unroute(`${pluginApiBase}/plugins/rbac/teams/team-eng`);
    await page.unroute(`${pluginApiBase}/plugins/rbac/scopes/team-eng/access`);
    await page.unroute(`${pluginApiBase}/plugins/rbac/flows/*/effective-access`);
    await page.unroute(`${pluginApiBase}/plugins/rbac/flows/*/access`);
    await page.unroute(`${pluginApiBase}/plugins/auth/users**`);

    // ── 42: Share button in flow editor header ────────────────────────────
    if (dataPipelineId) {
      // Re-register flow access mock for the share dialog
      await page.route(`${pluginApiBase}/plugins/rbac/flows/*/access`, async (route) => {
        const url = route.request().url();
        const flowIdMatch = url.match(/\/flows\/([^/]+)\/access/);
        const fId = flowIdMatch?.[1] ?? 'unknown';
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              access: [
                {
                  id: 'da1',
                  flowId: fId,
                  userId: 'test-user',
                  teamId: null,
                  permission: 'owner',
                  grantedBy: null,
                  grantedAt: now31,
                },
                {
                  id: 'da2',
                  flowId: fId,
                  userId: 'u2',
                  teamId: null,
                  permission: 'editor',
                  grantedBy: 'test-user',
                  grantedAt: now31,
                },
                {
                  id: 'da3',
                  flowId: fId,
                  userId: 'u3',
                  teamId: null,
                  permission: 'viewer',
                  grantedBy: 'test-user',
                  grantedAt: now31,
                },
              ],
            }),
          });
        } else {
          await route.fallback();
        }
      });

      await page.goto(`${VITE_BASE}/flowlib/flow/${dataPipelineId}`);
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      await takeScreenshot(
        page,
        screensById['42-share-button-flow']!,
        `/flowlib/flow/${dataPipelineId}`,
      );

      // ── 43: Share flow modal ──────────────────────────────────────────
      const shareBtn = page.getByRole('button', { name: /share/i });
      if (await shareBtn.isVisible().catch(() => false)) {
        await shareBtn.click();
        await page.waitForTimeout(800);
      }
      await takeScreenshot(
        page,
        screensById['43-share-flow-modal']!,
        `/flowlib/flow/${dataPipelineId}`,
      );

      // Close the share modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.unroute(`${pluginApiBase}/plugins/rbac/flows/*/access`);
    }

    // Clean up auth/me mock
    await page.unroute(`${pluginApiBase}/plugins/auth/me`);
  });

  test.afterAll(async () => {
    // Write metadata JSON
    const metadataPath = path.join(OUTPUT_DIR, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(capturedMetadata, null, 2));
    console.log(`\n✅ Captured ${capturedMetadata.length} screenshots → ${SCREENSHOTS_DIR}`);
    console.log(`📄 Metadata → ${metadataPath}`);
  });
});
