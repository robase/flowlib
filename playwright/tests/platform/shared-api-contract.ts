/**
 * Shared API contract test helpers for cross-platform parity.
 *
 * All three framework adapters (Express, NestJS, Next.js) wrap the same
 * Flowlib core, so their REST API surface must be identical. These helpers
 * define the contract that each adapter is validated against.
 */
import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Run the full Flowlib API contract against the given base URL.
 * The caller is responsible for providing a `request` fixture and the
 * correct `apiBase` (e.g. "http://localhost:3000/flowlib").
 */
export async function runApiContract(request: APIRequestContext, apiBase: string) {
  // -------------------------------------------------------------------
  // 1. Flow CRUD
  // -------------------------------------------------------------------

  // 1a. List flows — GET /flows/list returns a paginated response with data array
  const listFlowsRes = await request.get(`${apiBase}/flows/list`);
  expect(listFlowsRes.ok()).toBeTruthy();
  const flowsResponse = await listFlowsRes.json();
  // listFlows returns PaginatedResponse<Flow> = { data: Flow[], total, page, limit }
  expect(flowsResponse).toHaveProperty('data');
  expect(Array.isArray(flowsResponse.data)).toBeTruthy();

  // 1b. Create a flow — POST /flows
  const createFlowRes = await request.post(`${apiBase}/flows`, {
    data: {
      name: 'Platform Parity Test Flow',
      description: 'Auto-created by cross-platform E2E test',
    },
  });
  expect(createFlowRes.ok()).toBeTruthy();
  const createdFlow = await createFlowRes.json();
  expect(createdFlow).toHaveProperty('id');
  expect(createdFlow.name).toContain('Platform Parity Test Flow');
  const flowId: string = createdFlow.id;

  // 1c. Get flow by ID — GET /flows/:id
  const getFlowRes = await request.get(`${apiBase}/flows/${flowId}`);
  expect(getFlowRes.ok()).toBeTruthy();
  const fetchedFlow = await getFlowRes.json();
  expect(fetchedFlow.id).toBe(flowId);

  // 1d. Get flow versions — POST /flows/:id/versions/list
  const listVersionsRes = await request.post(`${apiBase}/flows/${flowId}/versions/list`, {
    data: {},
  });
  expect(listVersionsRes.ok()).toBeTruthy();

  // 1e. Get React Flow representation — GET /flows/:id/react-flow
  const reactFlowRes = await request.get(`${apiBase}/flows/${flowId}/react-flow`);
  expect(reactFlowRes.ok()).toBeTruthy();
  const reactFlowData = await reactFlowRes.json();
  // Should contain nodes and edges arrays
  expect(reactFlowData).toHaveProperty('nodes');
  expect(reactFlowData).toHaveProperty('edges');

  // -------------------------------------------------------------------
  // 2. Credential CRUD
  // -------------------------------------------------------------------

  // 2a. List credentials — GET /credentials
  const listCredsRes = await request.get(`${apiBase}/credentials`);
  expect(listCredsRes.ok()).toBeTruthy();
  const credsBody = await listCredsRes.json();
  // May be paginated or flat array depending on adapter
  const credsList = Array.isArray(credsBody) ? credsBody : (credsBody.data ?? credsBody);
  expect(credsList).toBeDefined();

  // 2b. Create a credential — POST /credentials
  const createCredRes = await request.post(`${apiBase}/credentials`, {
    data: {
      name: 'Platform Test Credential',
      type: 'http-api',
      authType: 'bearer',
      config: { token: 'test-token-for-platform-parity' },
      description: 'Auto-created by cross-platform test',
    },
  });
  expect(createCredRes.ok()).toBeTruthy();
  const createdCred = await createCredRes.json();
  expect(createdCred).toHaveProperty('id');
  expect(createdCred.name).toBe('Platform Test Credential');
  const credId: string = createdCred.id;

  // 2c. Get credential by ID — GET /credentials/:id
  const getCredRes = await request.get(`${apiBase}/credentials/${credId}`);
  expect(getCredRes.ok()).toBeTruthy();
  const fetchedCred = await getCredRes.json();
  expect(fetchedCred.id).toBe(credId);
  expect(fetchedCred.name).toBe('Platform Test Credential');

  // 2d. Test credential — POST /credentials/:id/test
  const testCredRes = await request.post(`${apiBase}/credentials/${credId}/test`);
  expect(testCredRes.ok()).toBeTruthy();
  const testResult = await testCredRes.json();
  // testCredential returns { success: boolean, error?: string }
  expect(testResult).toHaveProperty('success');

  // 2e. Delete credential — DELETE /credentials/:id
  const deleteCredRes = await request.delete(`${apiBase}/credentials/${credId}`);
  expect(deleteCredRes.status()).toBeLessThan(300);

  // Verify credential is gone
  const verifyDeletedRes = await request.get(`${apiBase}/credentials/${credId}`);
  expect(verifyDeletedRes.ok()).toBeFalsy();

  // -------------------------------------------------------------------
  // 3. Agent tools — GET /agent/tools
  // -------------------------------------------------------------------
  const agentToolsRes = await request.get(`${apiBase}/agent/tools`);
  expect(agentToolsRes.ok()).toBeTruthy();
  const agentTools: unknown[] = await agentToolsRes.json();
  expect(Array.isArray(agentTools)).toBeTruthy();
  expect(agentTools.length).toBeGreaterThan(0);

  // Each tool should have the standard shape
  const firstTool = agentTools[0] as Record<string, unknown>;
  expect(firstTool).toHaveProperty('id');
  expect(firstTool).toHaveProperty('name');

  // -------------------------------------------------------------------
  // 4. Node data — GET /node-data/models
  // -------------------------------------------------------------------
  const modelsRes = await request.get(`${apiBase}/node-data/models`);
  expect(modelsRes.ok()).toBeTruthy();
  const models = await modelsRes.json();
  // Should return models list (may be empty if no AI keys configured)
  expect(models).toBeDefined();

  // -------------------------------------------------------------------
  // 5. Flow run management
  // -------------------------------------------------------------------

  // 5a. List flow runs — POST /flow-runs/list
  const listRunsRes = await request.post(`${apiBase}/flow-runs/list`, {
    data: {},
  });
  expect(listRunsRes.ok()).toBeTruthy();
  const flowRuns = await listRunsRes.json();
  // May be paginated or flat
  expect(flowRuns).toBeDefined();

  // -------------------------------------------------------------------
  // 6. Ephemeral runs + SSE event stream
  // -------------------------------------------------------------------
  await runEphemeralAndStreamContract(request, apiBase);

  // -------------------------------------------------------------------
  // 7. Cleanup: delete the test flow
  // -------------------------------------------------------------------
  const deleteFlowRes = await request.delete(`${apiBase}/flows/${flowId}`);
  expect(deleteFlowRes.status()).toBeLessThan(300);

  // Verify flow is gone
  const verifyFlowDeletedRes = await request.get(`${apiBase}/flows/${flowId}`);
  expect(verifyFlowDeletedRes.ok()).toBeFalsy();
}

/**
 * Build the smallest valid FlowlibDefinition we can run end-to-end:
 * one input → one output. Uses the canonical action IDs ("core.input",
 * "core.output") so it works against any backend that ships the default
 * action catalogue.
 */
function buildTrivialFlowlibDefinition(): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
} {
  return {
    nodes: [
      {
        id: 'node_input',
        type: 'core.input',
        referenceId: 'event',
        label: 'Input',
        params: { variableName: 'hello', defaultValue: 'world' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node_output',
        type: 'core.output',
        referenceId: 'result',
        label: 'Output',
        params: { outputValue: '{{ event }}', outputName: 'result' },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: 'edge_input_output',
        source: 'node_input',
        target: 'node_output',
      },
    ],
  };
}

/**
 * Read a Server-Sent-Events stream and return parsed events until a
 * predicate fires or the stream closes / times out. Adapter-agnostic — works
 * against the same wire format Express, NestJS, and Next.js all emit.
 */
async function readSseEvents(
  request: APIRequestContext,
  url: string,
  options: {
    until: (evt: { type: string; data: unknown }) => boolean;
    timeoutMs: number;
  },
): Promise<Array<{ type: string; data: unknown }>> {
  const res = await request.get(url, {
    headers: { Accept: 'text/event-stream' },
    timeout: options.timeoutMs + 5_000,
  });
  expect(res.ok()).toBeTruthy();

  const collected: Array<{ type: string; data: unknown }> = [];
  let buffer = '';
  const decoder = new TextDecoder();
  const start = Date.now();

  const body = await res.body();
  // Playwright buffers the body of a streaming response into a single
  // chunk by the time `body()` resolves — fine for our trivial flow which
  // completes in well under a second. For longer-running flows we'd need
  // a lower-level streaming consumer.
  buffer += decoder.decode(body);

  const frames = buffer.split('\n\n');
  for (const frame of frames) {
    if (!frame.trim()) {
      continue;
    }
    let type = 'message';
    let data: string | undefined;
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) {
        type = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        data = (data ?? '') + line.slice(6);
      }
    }
    if (data === undefined) {
      continue;
    }
    let parsed: unknown = data;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Leave as string
    }
    const event = { type, data: parsed };
    collected.push(event);
    if (options.until(event)) {
      break;
    }
  }

  if (Date.now() - start > options.timeoutMs) {
    throw new Error(`SSE stream timed out after ${options.timeoutMs}ms`);
  }

  return collected;
}

/**
 * Validate the new VSCode-extension-facing endpoints:
 *  - POST /flow-runs/ephemeral (and /runs/ephemeral alias)
 *  - GET  /flow-runs/:flowRunId/stream and /runs/:flowRunId/events alias
 *
 * Asserted invariants:
 *  - Ephemeral runs return `{ flowRunId, flowId, status, eventsPath }`
 *  - The events stream emits at least a `snapshot` and an `end` event
 *  - Invalid definitions return 400 with a structured error body
 *  - Both alias paths behave identically to the canonical ones
 */
async function runEphemeralAndStreamContract(
  request: APIRequestContext,
  apiBase: string,
): Promise<void> {
  // 6a. Happy path — ephemeral run + SSE stream
  const ephemeralRes = await request.post(`${apiBase}/flow-runs/ephemeral`, {
    data: {
      definition: buildTrivialFlowlibDefinition(),
      inputs: { hello: 'world' },
    },
  });
  expect(ephemeralRes.ok()).toBeTruthy();
  const ephemeral = await ephemeralRes.json();
  expect(ephemeral).toHaveProperty('flowRunId');
  expect(ephemeral).toHaveProperty('flowId');
  expect(ephemeral).toHaveProperty('status');
  expect(ephemeral).toHaveProperty('eventsPath');
  expect(typeof ephemeral.flowRunId).toBe('string');
  expect(typeof ephemeral.flowId).toBe('string');

  // 6b. SSE stream — canonical path
  const eventsCanonical = await readSseEvents(
    request,
    `${apiBase}/flow-runs/${ephemeral.flowRunId}/stream`,
    {
      until: (evt) => evt.type === 'end',
      timeoutMs: 15_000,
    },
  );
  expect(eventsCanonical.length).toBeGreaterThan(0);
  // Must include the initial snapshot and a terminal event (end + flow_run.updated)
  expect(eventsCanonical.some((e) => e.type === 'snapshot')).toBeTruthy();
  expect(
    eventsCanonical.some((e) => e.type === 'end' || e.type === 'flow_run.updated'),
  ).toBeTruthy();

  // 6c. SSE stream — /runs/:id/events alias against the same flow run
  // (run is already terminal, so the stream sends snapshot + end immediately)
  const eventsAlias = await readSseEvents(
    request,
    `${apiBase}/runs/${ephemeral.flowRunId}/events`,
    {
      until: (evt) => evt.type === 'end',
      timeoutMs: 15_000,
    },
  );
  expect(eventsAlias.some((e) => e.type === 'snapshot')).toBeTruthy();

  // 6d. Ephemeral alias path /runs/ephemeral
  const aliasRes = await request.post(`${apiBase}/runs/ephemeral`, {
    data: {
      definition: buildTrivialFlowlibDefinition(),
      inputs: { hello: 'alias' },
    },
  });
  expect(aliasRes.ok()).toBeTruthy();
  const aliasBody = await aliasRes.json();
  expect(aliasBody).toHaveProperty('flowRunId');

  // 6e. Invalid definition → 400
  const invalidRes = await request.post(`${apiBase}/flow-runs/ephemeral`, {
    data: {
      definition: {
        nodes: [
          {
            id: 'a',
            type: 'core.input',
            referenceId: 'a',
            label: 'A',
            params: {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [
          // Edge references a non-existent node — FlowValidator should reject
          { id: 'edge_bad', source: 'a', target: 'does-not-exist' },
        ],
      },
      inputs: {},
    },
  });
  expect(invalidRes.status()).toBe(400);

  // 6f. Missing definition → 400
  const noBodyRes = await request.post(`${apiBase}/flow-runs/ephemeral`, {
    data: { inputs: {} },
  });
  expect(noBodyRes.status()).toBe(400);
}

/**
 * Cleanup helper — remove any leftover test data by name.
 * Safe to call even if no matching data exists.
 */
export async function cleanupTestData(request: APIRequestContext, apiBase: string) {
  // Clean up test flows
  try {
    const flowsRes = await request.get(`${apiBase}/flows/list`);
    if (flowsRes.ok()) {
      const body = await flowsRes.json();
      // Handle paginated response: { data: [...] }
      const flows: Array<{ id: string; name: string }> = Array.isArray(body)
        ? body
        : (body.data ?? []);
      for (const f of flows) {
        if (
          f.name &&
          (f.name.includes('Platform Parity Test') || f.name.startsWith('__ephemeral_'))
        ) {
          await request.delete(`${apiBase}/flows/${f.id}`);
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  // Clean up test credentials
  try {
    const credsRes = await request.get(`${apiBase}/credentials`);
    if (credsRes.ok()) {
      const body = await credsRes.json();
      const creds: Array<{ id: string; name: string }> = Array.isArray(body)
        ? body
        : (body.data ?? []);
      for (const c of creds) {
        if (c.name === 'Platform Test Credential') {
          await request.delete(`${apiBase}/credentials/${c.id}`);
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
