/**
 * DirectClient — wraps FlowlibInstance for plugin mode (zero HTTP overhead).
 */

import type { FlowlibInstance } from '@flowlib/core';
import { emitSdkSource, SdkEmitError } from '@flowlib/sdk';
import type {
  FlowlibClient,
  CredentialSummary,
  FlowSdkSourceResult,
  GetFlowSdkSourceOptions,
} from './types';

function toCredentialSummary(c: Record<string, unknown>): CredentialSummary {
  const metadata = (c.metadata ?? undefined) as Record<string, unknown> | undefined;
  const providerFromTop = typeof c.provider === 'string' ? c.provider : undefined;
  const providerFromMeta = typeof metadata?.provider === 'string' ? metadata.provider : undefined;
  return {
    id: String(c.id),
    name: String(c.name),
    type: String(c.type),
    provider: providerFromTop ?? providerFromMeta,
    lastUsedAt: c.lastUsedAt ? String(c.lastUsedAt) : undefined,
    createdAt: c.createdAt ? String(c.createdAt) : undefined,
    expiresAt: c.expiresAt ? String(c.expiresAt) : undefined,
  };
}

export class DirectClient implements FlowlibClient {
  constructor(private readonly flowlib: FlowlibInstance) {}

  // ===== Flows =====

  async listFlows() {
    return await this.flowlib.flows.list();
  }

  async getFlow(flowId: string) {
    return await this.flowlib.flows.get(flowId);
  }

  async getFlowDefinition(flowId: string) {
    return await this.flowlib.versions.get(flowId, 'latest');
  }

  async getFlowSdkSource(
    flowId: string,
    options: GetFlowSdkSourceOptions = {},
  ): Promise<FlowSdkSourceResult> {
    const requestedVersion = options.version ?? 'latest';
    const version = await this.flowlib.versions.get(flowId, requestedVersion);
    if (!version) {
      throw new Error(`Flow ${flowId} has no version "${requestedVersion}"`);
    }
    const def = (version as { flowlibDefinition?: unknown }).flowlibDefinition;
    if (!def) {
      throw new Error(`Version "${requestedVersion}" of flow ${flowId} has no flowlibDefinition`);
    }
    try {
      const result = emitSdkSource(def as Parameters<typeof emitSdkSource>[0], {
        flowName: options.flowName,
        sdkImport: options.sdkImport,
      });
      return {
        code: result.code,
        importedBuilders: result.sdkImports,
        flowName: options.flowName ?? 'myFlow',
        version: (version as { version: string | number }).version,
      };
    } catch (err) {
      if (err instanceof SdkEmitError) {
        throw new Error(
          err.nodeId
            ? `Cannot emit SDK source (node ${err.nodeId}): ${err.message}`
            : `Cannot emit SDK source: ${err.message}`,
        );
      }
      throw err;
    }
  }

  async createFlow(data: { name: string; description?: string }) {
    return await this.flowlib.flows.create(data);
  }

  async updateFlow(flowId: string, data: { name?: string; description?: string }) {
    return await this.flowlib.flows.update(flowId, data);
  }

  async deleteFlow(flowId: string) {
    await this.flowlib.flows.delete(flowId);
  }

  async validateFlow(flowId: string, definition: unknown) {
    try {
      const result = await this.flowlib.flows.validate(flowId, definition);
      if (result.isValid) {
        return { valid: true };
      }
      return {
        valid: false,
        errors: result.errors.map((e) => e.message),
      };
    } catch (err) {
      const issues = extractZodIssueMessages(err);
      if (issues) {
        return { valid: false, errors: issues };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, errors: [message] };
    }
  }

  // ===== Versions =====

  async listVersions(flowId: string) {
    return await this.flowlib.versions.list(flowId);
  }

  async getVersion(flowId: string, version: string | number | 'latest') {
    return await this.flowlib.versions.get(flowId, version);
  }

  async publishVersion(flowId: string, data: unknown) {
    return await this.flowlib.versions.create(
      flowId,
      data as Parameters<FlowlibInstance['versions']['create']>[1],
    );
  }

  // ===== Runs =====

  async startRun(flowId: string, inputs?: Record<string, unknown>) {
    return await this.flowlib.runs.start(flowId, inputs);
  }

  async startRunAsync(flowId: string, inputs?: Record<string, unknown>) {
    return await this.flowlib.runs.startAsync(flowId, inputs);
  }

  async runToNode(flowId: string, nodeId: string, inputs?: Record<string, unknown>) {
    return await this.flowlib.runs.executeToNode(flowId, nodeId, inputs);
  }

  async listRuns(flowId: string) {
    return await this.flowlib.runs.listByFlowId(flowId);
  }

  async getRun(flowRunId: string) {
    return await this.flowlib.runs.get(flowRunId);
  }

  async cancelRun(flowRunId: string) {
    return await this.flowlib.runs.cancel(flowRunId);
  }

  async pauseRun(flowRunId: string) {
    return await this.flowlib.runs.pause(flowRunId);
  }

  async resumeRun(flowRunId: string) {
    return await this.flowlib.runs.resume(flowRunId);
  }

  // ===== Debug =====

  async getNodeExecutions(flowRunId: string) {
    const result = await this.flowlib.runs.getNodeExecutions(flowRunId);
    return result.data;
  }

  async listNodeExecutions() {
    const result = await this.flowlib.runs.listNodeExecutions();
    return result.data;
  }

  async getToolExecutions(nodeExecutionId: string) {
    return await this.flowlib.runs.getToolExecutionsByNodeExecutionId(nodeExecutionId);
  }

  async testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData?: Record<string, unknown>,
  ) {
    return await this.flowlib.testing.testNode(nodeType, params, inputData);
  }

  async testJsExpression(expression: string, context: Record<string, unknown>) {
    return await this.flowlib.testing.testJsExpression({ expression, context });
  }

  async testMapper(expression: string, incomingData: Record<string, unknown>) {
    return await this.flowlib.testing.testMapper({ expression, incomingData });
  }

  // ===== Credentials =====

  async listCredentials(): Promise<CredentialSummary[]> {
    const creds = await this.flowlib.credentials.list();
    return creds.map((c) => toCredentialSummary(c as unknown as Record<string, unknown>));
  }

  async testCredential(credentialId: string) {
    return await this.flowlib.credentials.test(credentialId);
  }

  async listOAuth2Providers() {
    return this.flowlib.credentials.getOAuth2Providers();
  }

  // ===== Triggers =====

  async listTriggers(flowId: string) {
    return await this.flowlib.triggers.list(flowId);
  }

  async getTrigger(triggerId: string) {
    const trigger = await this.flowlib.triggers.get(triggerId);
    if (trigger === null) {
      throw new Error(`Trigger ${triggerId} not found`);
    }
    return trigger;
  }

  async createTrigger(input: unknown) {
    return await this.flowlib.triggers.create(
      input as Parameters<FlowlibInstance['triggers']['create']>[0],
    );
  }

  async updateTrigger(triggerId: string, input: unknown) {
    return await this.flowlib.triggers.update(
      triggerId,
      input as Parameters<FlowlibInstance['triggers']['update']>[1],
    );
  }

  async deleteTrigger(triggerId: string) {
    await this.flowlib.triggers.delete(triggerId);
  }

  async syncTriggers(flowId: string, definition: unknown) {
    return await this.flowlib.triggers.sync(
      flowId,
      definition as Parameters<FlowlibInstance['triggers']['sync']>[1],
    );
  }

  async executeCronTrigger(triggerId: string) {
    return await this.flowlib.triggers.executeCron(triggerId);
  }

  async listEnabledCronTriggers() {
    return await this.flowlib.triggers.getEnabledCron();
  }

  // ===== Node Reference =====

  async listProviders() {
    return this.flowlib.actions.getProviders();
  }

  async listAvailableNodes() {
    return this.flowlib.actions.getAvailableNodes();
  }

  async listNodesForProvider(providerId: string) {
    return this.flowlib.actions.getForProvider(providerId);
  }

  async resolveFieldOptions(actionId: string, fieldName: string, deps: Record<string, unknown>) {
    return await this.flowlib.actions.resolveFieldOptions(actionId, fieldName, deps);
  }

  // ===== Agent =====

  async listAgentTools() {
    return this.flowlib.agent.getTools();
  }
}

function extractZodIssueMessages(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') {
    return null;
  }
  const anyErr = err as Record<string, unknown>;
  const issues = anyErr.issues;
  if (!Array.isArray(issues)) {
    return null;
  }
  return issues.map((i) => {
    if (typeof i !== 'object' || i === null) {
      return String(i);
    }
    const rec = i as Record<string, unknown>;
    const path = Array.isArray(rec.path) ? rec.path.join('.') : '';
    const message = typeof rec.message === 'string' ? rec.message : 'invalid';
    return path ? `${path}: ${message}` : message;
  });
}
