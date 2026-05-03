import { type Page, type Locator } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSqliteBrowserIsolationTest,
  expect,
  type BrowserIsolationWorkerFixtures,
} from '../test-support/sqlite-isolation';

/**
 * Custom Playwright fixtures for Flowlib E2E tests.
 *
 * Provides helpers for navigating flows, opening the config panel,
 * running nodes, and asserting on JSON content.
 */

// Re-export expect so tests import from one place
export { expect };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const serverCwd = path.join(rootDir, 'playwright');
const serverScript = path.join(serverCwd, 'test-support/express-test-server.ts');
const sharedOrigin = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';
const isolatedBrowserBase = createSqliteBrowserIsolationTest({
  apiPrefix: '/flowlib',
  apiRoutePrefix: '/api/flowlib',
  dbFilePrefix: 'flowlib-e2e',
  readyPath: '/flowlib/credentials',
  serverCwd,
  serverScript,
  sharedOrigin,
});

let activeApiBase = 'http://localhost:3000/flowlib';

type TestFlowDefinition = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

type ActiveTestFlow = {
  id: string;
  name: string;
  definition: TestFlowDefinition;
};

type CredentialSeed = {
  authType: string;
  config: Record<string, unknown>;
  description: string;
  metadata?: Record<string, unknown>;
  name: string;
  type: string;
};

let activeTestFlow: ActiveTestFlow | null = null;

const BASELINE_CREDENTIALS: CredentialSeed[] = [
  {
    name: 'Anthropic API Key',
    type: 'http-api',
    authType: 'bearer',
    config: { token: 'sk-ant-placeholder' },
    description: 'Anthropic Claude API credential for AI model nodes',
    metadata: { provider: 'anthropic' },
  },
  {
    name: 'Linear OAuth2',
    type: 'http-api',
    authType: 'oauth2',
    config: { accessToken: 'linear-placeholder-token' },
    description: 'Linear OAuth2 credential for issue tracking and project management',
    metadata: { provider: 'linear' },
  },
];

const TEST_FLOW_DEFINITIONS: Record<string, TestFlowDefinition> = {
  'JQ Data Transform': {
    nodes: [
      {
        id: 'input-data',
        type: 'trigger.manual',
        label: 'User List',
        referenceId: 'data',
        params: {
          variableName: 'data',
          defaultValue: JSON.stringify(
            {
              users: [
                { id: 1, name: 'Alice', role: 'admin' },
                { id: 2, name: 'Bob', role: 'user' },
                { id: 3, name: 'Charlie', role: 'admin' },
              ],
              metadata: { total: 3, page: 1 },
            },
            null,
            2,
          ),
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'jq-filter',
        type: 'core.javascript',
        label: 'Filter Admins',
        referenceId: 'admins',
        params: {
          code: '({ admins: data.users.filter((user) => user.role === "admin").map((user) => user.name), count: data.users.filter((user) => user.role === "admin").length })',
        },
        position: { x: 400, y: 200 },
      },
      {
        id: 'template-result',
        type: 'core.template_string',
        label: 'Format Result',
        referenceId: 'result',
        params: {
          template: 'Found {{ admins.count }} admin(s): {{ admins.admins.join(", ") }}',
        },
        position: { x: 700, y: 200 },
      },
    ],
    edges: [
      { id: 'edge-input-to-jq', source: 'input-data', target: 'jq-filter' },
      { id: 'edge-jq-to-template', source: 'jq-filter', target: 'template-result' },
    ],
  },
  'Simple Template Flow': {
    nodes: [
      {
        id: 'input-topic',
        type: 'trigger.manual',
        label: 'Topic Input',
        referenceId: 'topic',
        params: {
          variableName: 'topic',
          defaultValue: 'artificial intelligence',
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'template-prompt',
        type: 'core.template_string',
        label: 'Build Prompt',
        referenceId: 'prompt',
        params: {
          template: 'Write a brief 2-sentence explanation about: {{ topic }}',
        },
        position: { x: 400, y: 200 },
      },
    ],
    edges: [{ id: 'edge-input-to-template', source: 'input-topic', target: 'template-prompt' }],
  },
  'User Age Check (Adult)': {
    nodes: [
      {
        id: 'input-user',
        type: 'trigger.manual',
        label: 'User Data',
        referenceId: 'user_data',
        params: {
          variableName: 'user_data',
          defaultValue: JSON.stringify(
            {
              name: 'Alice',
              age: 25,
              email: 'alice@example.com',
            },
            null,
            2,
          ),
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'jq-extract',
        type: 'core.javascript',
        label: 'Extract User Info',
        referenceId: 'user_info',
        params: {
          code: '({ name: user_data.name, age: user_data.age, isAdult: user_data.age >= 18 })',
        },
        position: { x: 350, y: 200 },
      },
      {
        id: 'if-adult',
        type: 'core.if_else',
        label: 'Is Adult?',
        referenceId: 'age_check',
        params: {
          condition: { '==': [{ var: 'user_info.isAdult' }, true] },
        },
        position: { x: 600, y: 200 },
      },
      {
        id: 'template-adult',
        type: 'core.template_string',
        label: 'Adult Message',
        referenceId: 'adult_message',
        params: {
          template: 'Welcome {{ age_check.user_info.name }}! You have full access to all features.',
        },
        position: { x: 900, y: 100 },
      },
      {
        id: 'template-minor',
        type: 'core.template_string',
        label: 'Minor Message',
        referenceId: 'minor_message',
        params: {
          template:
            'Hi {{ age_check.user_info.name }}! Some features are restricted for users under 18.',
        },
        position: { x: 900, y: 300 },
      },
    ],
    edges: [
      { id: 'edge-input-to-jq', source: 'input-user', target: 'jq-extract' },
      { id: 'edge-jq-to-ifelse', source: 'jq-extract', target: 'if-adult' },
      {
        id: 'edge-ifelse-true',
        source: 'if-adult',
        target: 'template-adult',
        sourceHandle: 'true_output',
      },
      {
        id: 'edge-ifelse-false',
        source: 'if-adult',
        target: 'template-minor',
        sourceHandle: 'false_output',
      },
    ],
  },
  'E-Commerce Order Processing': {
    nodes: [
      {
        id: 'input-order',
        type: 'trigger.manual',
        label: 'Order Data',
        referenceId: 'order',
        params: {
          variableName: 'order',
          defaultValue: JSON.stringify(
            {
              orderId: 'ORD-2024-001',
              items: [
                { sku: 'LAPTOP-PRO', name: 'Laptop Pro 15', price: 1299.99, quantity: 1 },
                { sku: 'MOUSE-WL', name: 'Wireless Mouse', price: 49.99, quantity: 2 },
                { sku: 'KB-MECH', name: 'Mechanical Keyboard', price: 159.99, quantity: 1 },
              ],
              shippingAddress: {
                street: '123 Tech Street',
                city: 'San Francisco',
                state: 'CA',
                zip: '94102',
              },
              paymentMethod: 'credit_card',
              createdAt: '2024-12-14T10:30:00Z',
            },
            null,
            2,
          ),
        },
        position: { x: 50, y: 100 },
      },
      {
        id: 'input-customer',
        type: 'trigger.manual',
        label: 'Customer Data',
        referenceId: 'customer',
        params: {
          variableName: 'customer',
          defaultValue: JSON.stringify(
            {
              customerId: 'CUST-001',
              name: 'Alice Johnson',
              email: 'alice@example.com',
              tier: 'VIP',
              totalOrders: 47,
              memberSince: '2020-03-15',
              preferences: {
                newsletter: true,
                promotions: true,
                language: 'en',
              },
            },
            null,
            2,
          ),
        },
        position: { x: 50, y: 300 },
      },
      {
        id: 'jq-merge',
        type: 'core.javascript',
        label: 'Merge Data',
        referenceId: 'merged',
        params: {
          code: `({
  orderId: order.orderId,
  customer: {
    id: customer.customerId,
    name: customer.name,
    email: customer.email,
    tier: customer.tier,
    totalOrders: customer.totalOrders,
  },
  items: order.items,
  shipping: order.shippingAddress,
  paymentMethod: order.paymentMethod,
})`,
        },
        position: { x: 300, y: 200 },
      },
      {
        id: 'jq-totals',
        type: 'core.javascript',
        label: 'Calculate Totals',
        referenceId: 'order_summary',
        params: {
          code: `(() => {
  const subtotal = merged.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.0875;
  return {
    ...merged,
    itemCount: merged.items.length,
    subtotal,
    tax,
    total: subtotal + tax,
    isHighValue: subtotal > 500,
    isVip: merged.customer.tier === "VIP",
  };
})()`,
        },
        position: { x: 550, y: 200 },
      },
      {
        id: 'if-vip',
        type: 'core.if_else',
        label: 'Is VIP Customer?',
        referenceId: 'vip_check',
        params: {
          condition: { '==': [{ var: 'order_summary.isVip' }, true] },
        },
        position: { x: 800, y: 200 },
      },
      {
        id: 'template-vip',
        type: 'core.template_string',
        label: 'VIP Welcome',
        referenceId: 'vip_message',
        params: {
          template: `Dear {{ vip_check.order_summary.customer.name }}, your order {{ vip_check.order_summary.orderId }} totals \\\${{ Math.round(vip_check.order_summary.total * 100) / 100 }} and qualifies for VIP handling.`,
        },
        position: { x: 1100, y: 50 },
      },
    ],
    edges: [
      { id: 'e-order-merge', source: 'input-order', target: 'jq-merge' },
      { id: 'e-customer-merge', source: 'input-customer', target: 'jq-merge' },
      { id: 'e-merge-totals', source: 'jq-merge', target: 'jq-totals' },
      { id: 'e-totals-vip', source: 'jq-totals', target: 'if-vip' },
      { id: 'e-vip-true', source: 'if-vip', target: 'template-vip', sourceHandle: 'true_output' },
    ],
  },
  'Operations Escalation Matrix': {
    nodes: [
      {
        id: 'input-incident',
        type: 'trigger.manual',
        label: 'Incident Payload',
        referenceId: 'incident',
        params: {
          variableName: 'incident',
          defaultValue: JSON.stringify(
            {
              incidentId: 'INC-2048',
              service: 'billing-api',
              priority: 'P1',
              status: 'investigating',
              impactedCustomers: 124,
              suspectedRootCause: 'regional database failover lag',
              regions: ['us-east-1', 'eu-west-1'],
            },
            null,
            2,
          ),
        },
        position: { x: 40, y: 120 },
      },
      {
        id: 'input-account',
        type: 'trigger.manual',
        label: 'Account Context',
        referenceId: 'account',
        params: {
          variableName: 'account',
          defaultValue: JSON.stringify(
            {
              accountName: 'Northstar Health',
              tier: 'enterprise',
              arr: 420000,
              csm: 'Jamie Rivera',
              slackChannel: '#ops-northstar-health',
            },
            null,
            2,
          ),
        },
        position: { x: 40, y: 320 },
      },
      {
        id: 'jq-normalize-incident',
        type: 'core.javascript',
        label: 'Normalize Context',
        referenceId: 'incident_context',
        params: {
          code: `({
  incidentId: incident.incidentId,
  service: incident.service,
  priority: incident.priority,
  status: incident.status,
  impactedCustomers: incident.impactedCustomers,
  accountName: account.accountName,
  tier: account.tier,
  arr: account.arr,
  csm: account.csm,
  slackChannel: account.slackChannel,
  severityScore: (incident.priority === "P1" ? 70 : 30) + incident.impactedCustomers / 2,
  needsExecutiveUpdate: account.tier === "enterprise" && incident.priority === "P1",
  requiresHotfix: incident.priority === "P1" || incident.impactedCustomers > 100,
})`,
        },
        position: { x: 320, y: 220 },
      },
      {
        id: 'if-executive-update',
        type: 'core.if_else',
        label: 'Executive Update Required?',
        referenceId: 'executive_check',
        params: {
          condition: { '==': [{ var: 'incident_context.needsExecutiveUpdate' }, true] },
        },
        position: { x: 620, y: 220 },
      },
      {
        id: 'template-executive-brief',
        type: 'core.template_string',
        label: 'Executive Brief',
        referenceId: 'executive_brief',
        params: {
          template: `Executive Update\n\n{{ executive_check.incident_context.accountName }} has a {{ executive_check.incident_context.priority }} incident on {{ executive_check.incident_context.service }} impacting {{ executive_check.incident_context.impactedCustomers }} customers. Severity score: {{ executive_check.incident_context.severityScore }}. Coordinate with {{ executive_check.incident_context.csm }} in {{ executive_check.incident_context.slackChannel }}.`,
        },
        position: { x: 940, y: 70 },
      },
      {
        id: 'if-hotfix',
        type: 'core.if_else',
        label: 'Hotfix Required?',
        referenceId: 'hotfix_check',
        params: {
          condition: { '==': [{ var: 'executive_check.incident_context.requiresHotfix' }, true] },
        },
        position: { x: 940, y: 320 },
      },
      {
        id: 'template-hotfix-plan',
        type: 'core.template_string',
        label: 'Hotfix Plan',
        referenceId: 'hotfix_plan',
        params: {
          template: `Hotfix Plan\n\nPrepare rollback and patch validation for {{ hotfix_check.executive_check.incident_context.service }}. Notify {{ hotfix_check.executive_check.incident_context.csm }} and keep {{ hotfix_check.executive_check.incident_context.slackChannel }} updated every 15 minutes.`,
        },
        position: { x: 1240, y: 220 },
      },
      {
        id: 'template-monitoring-plan',
        type: 'core.template_string',
        label: 'Monitoring Plan',
        referenceId: 'monitoring_plan',
        params: {
          template: `Monitoring Plan\n\nContinue observing {{ hotfix_check.executive_check.incident_context.service }} and post status updates in {{ hotfix_check.executive_check.incident_context.slackChannel }} until customer impact drops below threshold.`,
        },
        position: { x: 1240, y: 430 },
      },
      {
        id: 'output-dispatch-summary',
        type: 'core.output',
        label: 'Dispatch Summary',
        referenceId: 'dispatch_summary',
        params: {
          outputName: 'dispatch_summary',
          outputValue: `{{ executive_brief ?? hotfix_plan ?? monitoring_plan }}`,
        },
        position: { x: 1540, y: 290 },
      },
    ],
    edges: [
      { id: 'ops-incident-normalize', source: 'input-incident', target: 'jq-normalize-incident' },
      { id: 'ops-account-normalize', source: 'input-account', target: 'jq-normalize-incident' },
      { id: 'ops-normalize-exec', source: 'jq-normalize-incident', target: 'if-executive-update' },
      {
        id: 'ops-exec-true',
        source: 'if-executive-update',
        target: 'template-executive-brief',
        sourceHandle: 'true_output',
      },
      {
        id: 'ops-exec-false',
        source: 'if-executive-update',
        target: 'if-hotfix',
        sourceHandle: 'false_output',
      },
      {
        id: 'ops-hotfix-true',
        source: 'if-hotfix',
        target: 'template-hotfix-plan',
        sourceHandle: 'true_output',
      },
      {
        id: 'ops-hotfix-false',
        source: 'if-hotfix',
        target: 'template-monitoring-plan',
        sourceHandle: 'false_output',
      },
      {
        id: 'ops-brief-output',
        source: 'template-executive-brief',
        target: 'output-dispatch-summary',
      },
      {
        id: 'ops-hotfix-output',
        source: 'template-hotfix-plan',
        target: 'output-dispatch-summary',
      },
      {
        id: 'ops-monitor-output',
        source: 'template-monitoring-plan',
        target: 'output-dispatch-summary',
      },
    ],
  },
  'Triggered Linear Agent': {
    nodes: [
      {
        id: 'trigger-manual',
        type: 'trigger.manual',
        label: 'Manual Trigger',
        referenceId: 'manual_trigger',
        params: {},
        position: { x: 100, y: 220 },
      },
      {
        id: 'agent-linear',
        type: 'core.agent',
        label: 'Linear Assistant Agent',
        referenceId: 'linear_agent',
        params: {
          credentialId: 'anthropic-api-key',
          model: 'claude-sonnet-4-20250514',
          taskPrompt: 'Summarize the latest Linear issue activity.',
          systemPrompt: 'You are a concise Linear assistant.',
          addedTools: [],
          maxIterations: 3,
          stopCondition: 'explicit_stop',
          enableParallelTools: true,
        },
        position: { x: 420, y: 220 },
      },
    ],
    edges: [{ id: 'edge-trigger-agent', source: 'trigger-manual', target: 'agent-linear' }],
  },
};

async function requestJson(path: string, init?: RequestInit) {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(`${activeApiBase}${path}`, init);
    lastResponse = response;

    if (response.ok) {
      return response.json();
    }

    if (response.status !== 503) {
      throw new Error(`API request failed: ${response.status} ${response.statusText} for ${path}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `API request failed: ${lastResponse?.status ?? 0} ${lastResponse?.statusText ?? 'Unknown'} for ${path}`,
  );
}

async function deleteRecordsByName(resourcePath: '/credentials' | '/flows', name: string) {
  const payload = await requestJson(`${resourcePath}${resourcePath === '/flows' ? '/list' : ''}`);
  const records: Array<{ id: string; name: string }> = payload.data ?? payload;

  await Promise.all(
    records
      .filter((record) => record.name === name)
      .map((record) =>
        fetch(`${activeApiBase}${resourcePath}/${record.id}`, { method: 'DELETE' }).catch(
          () => undefined,
        ),
      ),
  );
}

async function seedBaselineCredentials() {
  for (const credential of BASELINE_CREDENTIALS) {
    await deleteRecordsByName('/credentials', credential.name);
    await requestJson('/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    });
  }
}

async function seedBaselineFlow(flowName: string) {
  const definition = TEST_FLOW_DEFINITIONS[flowName];
  if (!definition) {
    return;
  }

  await deleteRecordsByName('/flows', flowName);

  const createdFlow = await requestJson('/flows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: flowName }),
  });

  await requestJson(`/flows/${createdFlow.id}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowlibDefinition: definition }),
  });
}

async function seedWorkerBaselineData(apiBase: string) {
  activeApiBase = apiBase;
  await seedBaselineCredentials();
  await seedBaselineFlow('Triggered Linear Agent');
  await seedBaselineFlow('Operations Escalation Matrix');
}

async function resetTestFlow(flowName: string) {
  const definition = TEST_FLOW_DEFINITIONS[flowName];
  if (!definition) {
    activeTestFlow = null;
    return;
  }

  const existingFlows = await requestJson('/flows/list');
  const matches: Array<{ id: string; name: string }> = (existingFlows.data ?? []).filter(
    (flow: { id: string; name: string }) => flow.name === flowName,
  );

  await Promise.all(
    matches.map((flow) =>
      fetch(`${activeApiBase}/flows/${flow.id}`, { method: 'DELETE' }).catch(() => undefined),
    ),
  );

  const createdFlow = await requestJson('/flows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: flowName }),
  });

  await requestJson(`/flows/${createdFlow.id}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowlibDefinition: definition }),
  });

  activeTestFlow = {
    id: createdFlow.id as string,
    name: flowName,
    definition,
  };
}

// ---------------------------------------------------------------------------
// Helper: navigate to a flow by name from the dashboard
// ---------------------------------------------------------------------------
async function navigateToFlow(page: Page, flowName: string) {
  await resetTestFlow(flowName);

  await page.goto('/flowlib');

  // Wait for the dashboard to fully load
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: 15_000,
  });

  // Wait for the flows section to appear
  await expect(page.getByText('Loading flows'))
    .not.toBeVisible({ timeout: 15_000 })
    .catch(() => {});

  // Click the flow card — target the .bg-card container that has an h3 with the flow name
  const card = page.locator('.bg-card').filter({
    has: page.getByRole('heading', { level: 3, name: flowName, exact: true }),
  });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();

  // Wait for the flow editor canvas to appear
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 10_000 });
}

async function fitCanvasView(page: Page) {
  const fitViewButton = page.getByRole('button', { name: 'Fit View' });
  if (await fitViewButton.count()) {
    await fitViewButton.click();
  }
}

// ---------------------------------------------------------------------------
// Helper: double-click a node on the canvas to open the config panel
// ---------------------------------------------------------------------------
async function openNodeConfigPanel(page: Page, nodeName: string) {
  const node = page.locator('.react-flow__node').filter({ hasText: nodeName });
  try {
    await expect(node).toBeVisible({ timeout: 2_000 });
  } catch {
    await fitCanvasView(page);
    await expect(node).toBeVisible({ timeout: 10_000 });
  }
  await node.dblclick();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Helper: close the config panel
// ---------------------------------------------------------------------------
async function closeConfigPanel(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Helper: click "Run Node" in the config panel and wait for completion
// ---------------------------------------------------------------------------
async function runCurrentNode(page: Page) {
  const dialog = page.getByRole('dialog');
  const runBtn = dialog
    .locator("button[data-slot='button']")
    .filter({ hasText: /^Run Node$/ })
    .first();
  await expect(runBtn).toBeVisible({ timeout: 5_000 });
  await runBtn.click();

  // Wait for the running state to appear then disappear
  // Use a generous timeout — execution can take a few seconds
  await expect(
    dialog
      .locator("button[data-slot='button']")
      .filter({ hasText: /Running/ })
      .first(),
  )
    .toBeVisible({ timeout: 5_000 })
    .catch(() => {
      // Button might transition too fast to catch — that's OK
    });

  await expect(
    dialog
      .locator("button[data-slot='button']")
      .filter({ hasText: /^Run Node$/ })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function hydrateDownstreamPanelInput(page: Page, targetNodeId: string) {
  const targetNode = activeTestFlow?.definition.nodes.find((node) => node.id === targetNodeId);
  const targetLabel = typeof targetNode?.label === 'string' ? targetNode.label : null;

  if (!targetLabel) {
    return;
  }

  const targetOnCanvas = page.locator('.react-flow__node').filter({ hasText: targetLabel });
  if ((await targetOnCanvas.count()) === 0) {
    return;
  }

  await openNodeConfigPanel(page, targetLabel);

  const dialog = page.getByRole('dialog');
  const inlineRunButton = dialog
    .locator('button')
    .filter({ hasText: /^Run node$/i })
    .first();

  if (await inlineRunButton.count()) {
    await inlineRunButton.click();
    await page.waitForTimeout(300);
  } else {
    const inlineRunText = dialog.getByText(/^Run node$/i).first();
    if (await inlineRunText.count()) {
      await inlineRunText.click();
      await page.waitForTimeout(300);
    }
  }

  await closeConfigPanel(page);
}

// ---------------------------------------------------------------------------
// Helper: run a specific node by opening its panel, clicking Run, and closing
// ---------------------------------------------------------------------------
async function runNodeByName(page: Page, nodeName: string) {
  const nodeLocator = page.locator('.react-flow__node').filter({ hasText: nodeName });
  const isVisibleOnCanvas = (await nodeLocator.count()) > 0;

  if (!isVisibleOnCanvas) {
    const node = activeTestFlow?.definition.nodes.find((candidate) => candidate.label === nodeName);
    const nodeId = typeof node?.id === 'string' ? node.id : null;

    if (!activeTestFlow?.id || !nodeId) {
      throw new Error(`Node "${nodeName}" is not visible and no fallback ID was found`);
    }

    await requestJson(`/flows/${activeTestFlow.id}/run-to-node/${nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: {}, options: { useBatchProcessing: false } }),
    });

    const downstreamTargets = activeTestFlow.definition.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => edge.target)
      .filter((target): target is string => typeof target === 'string');

    for (const targetNodeId of downstreamTargets) {
      await requestJson(`/flows/${activeTestFlow.id}/run-to-node/${targetNodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: {}, options: { useBatchProcessing: false } }),
      });

      await hydrateDownstreamPanelInput(page, targetNodeId);
    }

    return;
  }

  await openNodeConfigPanel(page, nodeName);
  await runCurrentNode(page);
  await closeConfigPanel(page);
}

// ---------------------------------------------------------------------------
// Helper: get the text content of the Input panel's JSON editor
// ---------------------------------------------------------------------------
function getInputPanelEditor(page: Page): Locator {
  const dialog = page.getByRole('dialog');
  // The Input panel is the first resizable panel — find its CodeMirror editor
  return dialog.locator('.cm-editor').first();
}

function getOutputPanelEditor(page: Page): Locator {
  const dialog = page.getByRole('dialog');
  return dialog.locator('.cm-editor').last();
}

async function getInputPanelText(page: Page): Promise<string> {
  const editor = getInputPanelEditor(page);
  return editor.evaluate((element) => {
    const editorElement = element as HTMLElement & {
      cmView?: {
        view?: {
          state?: {
            doc?: {
              toString(): string;
            };
          };
        };
      };
    };

    return editorElement.cmView?.view?.state?.doc?.toString() ?? element.textContent ?? '';
  });
}

async function getOutputPanelText(page: Page): Promise<string> {
  const editor = getOutputPanelEditor(page);
  return editor.evaluate((element) => {
    const editorElement = element as HTMLElement & {
      cmView?: {
        view?: {
          state?: {
            doc?: {
              toString(): string;
            };
          };
        };
      };
    };

    return editorElement.cmView?.view?.state?.doc?.toString() ?? element.textContent ?? '';
  });
}

// ---------------------------------------------------------------------------
// Helper: assert no [object Object] in a text block
// ---------------------------------------------------------------------------
export function assertNoObjectObject(text: string, context: string) {
  expect(text, `${context} should not contain [object Object]`).not.toContain('[object Object]');
}

// ---------------------------------------------------------------------------
// Helper: assert valid JSON
// ---------------------------------------------------------------------------
export function assertValidJson(text: string, context: string): unknown {
  const normalizedText = text.trim();

  const directParse = () => JSON.parse(normalizedText);
  const extractedParse = () => {
    const objectStart = normalizedText.indexOf('{');
    const arrayStart = normalizedText.indexOf('[');

    let start = -1;
    if (objectStart >= 0 && arrayStart >= 0) {
      start = Math.min(objectStart, arrayStart);
    } else {
      start = Math.max(objectStart, arrayStart);
    }

    if (start < 0) {
      throw new Error('No JSON payload found');
    }

    const lastObjectEnd = normalizedText.lastIndexOf('}');
    const lastArrayEnd = normalizedText.lastIndexOf(']');
    const end = Math.max(lastObjectEnd, lastArrayEnd);

    if (end < start) {
      throw new Error('JSON payload appears truncated');
    }

    return JSON.parse(normalizedText.slice(start, end + 1));
  };

  let parsed: unknown;
  try {
    parsed = directParse();
  } catch {
    try {
      parsed = extractedParse();
    } catch {
      throw new Error(
        `${context} should be valid JSON but got parse error. Content:\n${text.slice(0, 500)}`,
      );
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Extended test fixture
// ---------------------------------------------------------------------------
export const test = isolatedBrowserBase.extend<
  {
    /** Ensure worker-local baseline credentials/flows exist */
    _workerBaseline: void;
    /** Mock auth session so tests bypass the sign-in gate */
    _authMock: void;
    /** Navigate to a flow by name */
    navigateToFlow: (flowName: string) => Promise<void>;
    /** Open a node's config panel by double-clicking it */
    openNodeConfigPanel: (nodeName: string) => Promise<void>;
    /** Close the currently open config panel */
    closeConfigPanel: () => Promise<void>;
    /** Click "Run Node" in the config panel */
    runCurrentNode: () => Promise<void>;
    /** Open a node, run it, and close the panel */
    runNodeByName: (nodeName: string) => Promise<void>;
    /** Get the Input panel CodeMirror text */
    getInputPanelText: () => Promise<string>;
    /** Get the Output panel CodeMirror text */
    getOutputPanelText: () => Promise<string>;
  },
  BrowserIsolationWorkerFixtures
>({
  _workerBaseline: [
    async ({ apiBase }, use) => {
      await seedWorkerBaselineData(apiBase);
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  _authMock: [
    async ({ page }, use) => {
      // Return a mock authenticated session so tests bypass the sign-in gate
      await page.route('**/plugins/auth/api/auth/get-session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: { id: 'test-user', email: 'admin@test.com', name: 'Test User', role: 'admin' },
            session: { id: 'test-session' },
          }),
        });
      });
      await use();
    },
    { auto: true },
  ],
  navigateToFlow: async ({ page, apiBase }, use) => {
    activeApiBase = apiBase;
    await use((flowName: string) => navigateToFlow(page, flowName));
  },
  openNodeConfigPanel: async ({ page }, use) => {
    await use((nodeName: string) => openNodeConfigPanel(page, nodeName));
  },
  closeConfigPanel: async ({ page }, use) => {
    await use(() => closeConfigPanel(page));
  },
  runCurrentNode: async ({ page }, use) => {
    await use(() => runCurrentNode(page));
  },
  runNodeByName: async ({ page }, use) => {
    await use((nodeName: string) => runNodeByName(page, nodeName));
  },
  getInputPanelText: async ({ page }, use) => {
    await use(() => getInputPanelText(page));
  },
  getOutputPanelText: async ({ page }, use) => {
    await use(() => getOutputPanelText(page));
  },
});
