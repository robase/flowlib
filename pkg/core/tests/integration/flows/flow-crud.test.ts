/**
 * Integration tests: Flow CRUD operations
 *
 * Tests creating, reading, updating, listing, and deleting flows
 * through the real Invect core with an in-memory SQLite database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { InvectInstance } from '../../../src/api/types';
import { createTestInvect } from '../helpers/test-flowlib';

describe('Flow CRUD', () => {
  let flowlib: InvectInstance;

  beforeAll(async () => {
    flowlib = await createTestInvect();
  });

  afterAll(async () => {
    await flowlib.shutdown();
  });

  it('should create a flow', async () => {
    const flow = await flowlib.flows.create({ name: 'Test Flow' });

    expect(flow).toBeDefined();
    expect(flow.id).toBeTruthy();
    expect(flow.name).toBe('Test Flow');
  });

  it('should get a flow by id', async () => {
    const created = await flowlib.flows.create({ name: 'Fetch Me' });
    const fetched = await flowlib.flows.get(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Fetch Me');
  });

  it('should list flows', async () => {
    const name = `List-Test-${Date.now()}`;
    await flowlib.flows.create({ name });

    const result = await flowlib.flows.list();

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data.some((f) => f.name === name)).toBe(true);
  });

  it('should update a flow', async () => {
    const flow = await flowlib.flows.create({ name: 'Before Update' });
    const updated = await flowlib.flows.update(flow.id, { name: 'After Update' });

    expect(updated.name).toBe('After Update');

    const fetched = await flowlib.flows.get(flow.id);
    expect(fetched.name).toBe('After Update');
  });

  it('should delete a flow', async () => {
    const flow = await flowlib.flows.create({ name: 'Delete Me' });
    await flowlib.flows.delete(flow.id);

    await expect(flowlib.flows.get(flow.id)).rejects.toThrow();
  });

  describe('Flow Versioning', () => {
    it('should create and retrieve a flow version', async () => {
      const flow = await flowlib.flows.create({ name: 'Versioned Flow' });

      const version = await flowlib.versions.create(flow.id, {
        invectDefinition: {
          nodes: [
            {
              id: 'input-1',
              type: 'core.input',
              label: 'Input',
              referenceId: 'data',
              params: { variableName: 'x', defaultValue: '42' },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });

      expect(version).toBeDefined();
      // createFlow auto-creates version 1 (empty), so first explicit version is 2
      expect(version.version).toBe(2);
    });

    it('should get the latest version', async () => {
      const flow = await flowlib.flows.create({ name: 'Latest Version Flow' });

      await flowlib.versions.create(flow.id, {
        invectDefinition: {
          nodes: [
            {
              id: 'n1',
              type: 'core.input',
              label: 'V1',
              referenceId: 'v1',
              params: { variableName: 'x', defaultValue: '1' },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });

      await flowlib.versions.create(flow.id, {
        invectDefinition: {
          nodes: [
            {
              id: 'n2',
              type: 'core.input',
              label: 'V2',
              referenceId: 'v2',
              params: { variableName: 'x', defaultValue: '2' },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });

      const latest = await flowlib.versions.get(flow.id, 'latest');
      expect(latest).toBeDefined();
      // createFlow auto-creates v1, two createFlowVersion calls make v2 and v3
      expect(latest!.version).toBe(3);
    });

    it('should list versions for a flow', async () => {
      const flow = await flowlib.flows.create({ name: 'Multi Version Flow' });

      await flowlib.versions.create(flow.id, {
        invectDefinition: { nodes: [], edges: [] },
      });
      await flowlib.versions.create(flow.id, {
        invectDefinition: { nodes: [], edges: [] },
      });

      const result = await flowlib.versions.list(flow.id);
      // createFlow auto-creates v1, plus two explicit versions = 3 total
      expect(result.data.length).toBe(3);
    });
  });
});
