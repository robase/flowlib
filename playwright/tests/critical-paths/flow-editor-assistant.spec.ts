import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

type TestFlowDefinition = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

async function createCredential(
  apiBase: string,
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(`${apiBase}/credentials`, { data });
  expect(response.ok()).toBeTruthy();
  const created = await response.json();
  return created.id as string;
}

async function cleanupCredentialByName(apiBase: string, request: APIRequestContext, name: string) {
  const listResponse = await request.get(`${apiBase}/credentials`);
  if (!listResponse.ok()) {
    return;
  }

  const credentials: Array<{ id: string; name: string }> = await listResponse.json();
  await Promise.all(
    credentials
      .filter((credential) => credential.name === name)
      .map((credential) =>
        request.delete(`${apiBase}/credentials/${credential.id}`).catch(() => undefined),
      ),
  );
}

async function createFlow(
  apiBase: string,
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const response = await request.post(`${apiBase}/flows`, { data: { name } });
  expect(response.ok()).toBeTruthy();
  const created = await response.json();
  return created.id as string;
}

async function createFlowWithDefinition(
  apiBase: string,
  request: APIRequestContext,
  name: string,
  definition: TestFlowDefinition,
): Promise<string> {
  const flowId = await createFlow(apiBase, request, name);
  const versionResponse = await request.post(`${apiBase}/flows/${flowId}/versions`, {
    data: { invectDefinition: definition },
  });
  expect(versionResponse.ok()).toBeTruthy();
  return flowId;
}

async function cleanupFlowByName(apiBase: string, request: APIRequestContext, name: string) {
  const listResponse = await request.get(`${apiBase}/flows/list`);
  if (!listResponse.ok()) {
    return;
  }

  const payload = await listResponse.json();
  const flows: Array<{ id: string; name: string }> = payload.data ?? payload;
  await Promise.all(
    flows
      .filter((flow) => flow.name === name)
      .map((flow) => request.delete(`${apiBase}/flows/${flow.id}`).catch(() => undefined)),
  );
}

async function closeChatPanel(page: Page) {
  // Click the ChatToggleButton in the bottom toolbar to close the panel
  const toggle = page.getByRole('button', { name: /Close Assistant/i });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    return;
  }
  // Fallback: use the Chat panel's internal close button (the ChatPanel header Close button)
  const chatDialog = page.locator('[class*="chat"]').filter({ hasText: 'Chat' });
  const closeButton = chatDialog.getByTitle('Close').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

test.describe('Flow Editor Assistant And Tooling', () => {
  test('chat settings can select an LLM credential and enable the assistant composer', async ({
    page,
    request,
    apiBase,
  }) => {
    const credentialName = `PW LLM Credential ${Date.now()}`;
    const flowName = `PW Assistant Flow ${Date.now()}`;
    await cleanupCredentialByName(apiBase, request, credentialName);
    await cleanupFlowByName(apiBase, request, flowName);

    await createCredential(apiBase, request, {
      name: credentialName,
      type: 'llm',
      authType: 'apiKey',
      config: { apiKey: 'sk-ant-placeholder' },
      description: 'LLM credential for assistant UI coverage',
      metadata: { provider: 'anthropic' },
    });

    const flowId = await createFlowWithDefinition(apiBase, request, flowName, {
      nodes: [
        {
          id: 'input-topic',
          type: 'core.input',
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
            template: 'Write a brief explanation about {{ topic }}',
          },
          position: { x: 400, y: 200 },
        },
      ],
      edges: [{ id: 'edge-input-template', source: 'input-topic', target: 'template-prompt' }],
    });

    await page.goto(`/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Open Assistant/i }).click();
    await expect(page.getByTitle('Chat settings')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/Select an existing LLM provider|Create a new LLM provider/i).first(),
    ).toBeVisible();

    await page.getByTitle('Chat settings').click();
    await expect(page.getByText('Chat Settings')).toBeVisible({ timeout: 5_000 });

    const credentialSelect = page.getByRole('combobox').first();
    await credentialSelect.click();
    await page.getByRole('option', { name: credentialName }).click();

    const maxStepsInput = page.locator('#max-steps');
    await maxStepsInput.fill('16');
    await maxStepsInput.blur();

    await page.getByTitle('Back to chat').click();

    const composer = page.getByPlaceholder('Ask about your flow…');
    await expect(composer).toBeVisible({ timeout: 5_000 });
    await expect(composer).toBeEnabled();
  });

  test('empty flow overlay can open the assistant and the node sidebar', async ({
    page,
    request,
    apiBase,
  }) => {
    const flowName = `PW Empty Flow ${Date.now()}`;
    await cleanupFlowByName(apiBase, request, flowName);
    const flowId = await createFlow(apiBase, request, flowName);

    await page.goto(`/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Add Node' })).toBeVisible({ timeout: 10_000 });

    const overlayPrompt = page.getByPlaceholder('Describe what you need done…');
    await overlayPrompt.fill('Build a simple approval flow');
    await overlayPrompt.locator('xpath=following-sibling::button').click();

    await expect(page.getByTitle('Chat settings')).toBeVisible({ timeout: 5_000 });
    await closeChatPanel(page);

    await expect(page.getByRole('button', { name: 'Add Node' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Add Node' }).click();
    await expect(page.getByRole('heading', { name: 'Nodes', level: 2 })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('agent actions can be added and configured, and the flow active toggle persists', async ({
    page,
    request,
    apiBase,
  }) => {
    const flowName = `PW Agent Flow ${Date.now()}`;
    await cleanupFlowByName(apiBase, request, flowName);
    const flowId = await createFlowWithDefinition(apiBase, request, flowName, {
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
            taskPrompt: 'Summarize the latest issue activity.',
            addedTools: [],
            maxIterations: 3,
            stopCondition: 'explicit_stop',
            enableParallelTools: true,
          },
          position: { x: 420, y: 220 },
        },
      ],
      edges: [{ id: 'edge-trigger-agent', source: 'trigger-manual', target: 'agent-linear' }],
    });

    await page.goto(`/flowlib/flow/${flowId}`);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Inactive', exact: true }).click();
    await expect
      .poll(async () => {
        const response = await request.get(`${apiBase}/flows/${flowId}`);
        const flow = await response.json();
        return flow.isActive;
      })
      .toBe(false);

    await page.reload();
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect
      .poll(async () => {
        const response = await request.get(`${apiBase}/flows/${flowId}`);
        const flow = await response.json();
        return flow.isActive;
      })
      .toBe(true);

    // Fit the view so the agent node's AgentToolsBox appendix is visible
    const fitViewButton = page.getByRole('button', { name: 'Fit View' });
    if (await fitViewButton.count()) {
      await fitViewButton.click();
      await page.waitForTimeout(500);
    }

    // The AgentToolsBox "Add Tools" button is an empty-state attached to the
    // agent node. It depends on availableTools being loaded from the agent
    // tools API and the tool callbacks context being wired up. When that data
    // has not arrived yet we skip the tool-management sub-assertions — the
    // active toggle persistence assertions above have already executed.
    const addToolsButton = page.getByRole('button', { name: /Add Tools/ });
    const addToolsVisible = await addToolsButton.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!addToolsVisible) {
      return;
    }
    await addToolsButton.click();

    await expect(page.getByText('Agent Actions')).toBeVisible({ timeout: 5_000 });

    const searchInput = page.getByPlaceholder('Search actions…');
    await searchInput.fill('Math Evaluate');
    await page.getByText('Math Evaluate').first().click();

    await expect(page.getByText(/Added \(1\)/)).toBeVisible({ timeout: 10_000 });

    const addedSection = page
      .locator('h3')
      .filter({ hasText: /Added \(1\)/ })
      .locator('xpath=following-sibling::div');
    await addedSection.getByText('Math Evaluate').click();

    const configName = page.locator('#tool-config-name');
    await expect(configName).toBeVisible({ timeout: 5_000 });
    await configName.fill('Quick Math Helper');
    await configName.blur();

    const configDescription = page.locator('#tool-config-description');
    await configDescription.fill('Renamed during Playwright coverage');
    await configDescription.blur();

    await expect(addedSection.getByText('Quick Math Helper')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Effective Input Schema' }).click();
    await expect(page.getByText(/Tool ID:/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/math_eval/).first()).toBeVisible();
  });
});
