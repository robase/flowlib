/**
 * Client-side InvectDefinition ⇄ ReactFlow converter.
 *
 * The hosted `<Invect>` app receives `ReactFlowData` from the backend's
 * `ReactFlowRendererService`. The headless `<FlowCanvas>` doesn't talk to a
 * backend, so we replicate the relevant parts of that transform in the
 * browser using the action metadata the caller provides.
 *
 * Only the structural bits the canvas needs are produced here — backend-only
 * fields (`executionStatus`, `inputs`, `outputs`, `width`/`height`
 * heuristics) can be added later without changing the contract.
 */

import type { Edge, Node } from '@xyflow/react';
import type { InvectDefinition, ReactFlowData } from '@flowlib/core/types';
import { NodeExecutionStatus } from '@flowlib/core/types';
import type { ReactFlowNodeData } from '@flowlib/core/types';
import type { ActionMetadata, NodeRunStatus } from './types';

const MAX_REFERENCE_ID_LENGTH = 22;

function humanize(input: string): string {
  return input.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildReferenceId(explicit: unknown, displayName: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit.slice(0, MAX_REFERENCE_ID_LENGTH);
  }
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return base.slice(0, MAX_REFERENCE_ID_LENGTH);
}

function mapRunStatus(status: NodeRunStatus | undefined): {
  status: ReactFlowNodeData['status'];
  executionStatus?: NodeExecutionStatus;
} {
  switch (status) {
    case 'running':
      return { status: 'running', executionStatus: NodeExecutionStatus.RUNNING };
    case 'success':
      return { status: 'completed', executionStatus: NodeExecutionStatus.SUCCESS };
    case 'failed':
      return { status: 'error', executionStatus: NodeExecutionStatus.FAILED };
    case 'skipped':
      return { status: 'skipped', executionStatus: NodeExecutionStatus.SKIPPED };
    case 'pending':
      return { status: 'idle', executionStatus: NodeExecutionStatus.PENDING };
    default:
      return { status: 'idle' };
  }
}

export interface FlowAdapterInput {
  flow: InvectDefinition;
  actions: ActionMetadata[];
  nodeRunStatus?: Record<string, NodeRunStatus>;
}

/**
 * Convert a raw `InvectDefinition` into the `ReactFlowData` shape the
 * editor store expects. The returned `version` field is a stable
 * synthetic value so React Query cache keys remain stable across re-renders
 * that don't actually change the flow.
 */
export function invectDefinitionToReactFlowData({
  flow,
  actions,
  nodeRunStatus,
}: FlowAdapterInput): ReactFlowData {
  const actionsById = new Map(actions.map((a) => [a.type, a]));

  const nodes = flow.nodes.map((node) => {
    const action = actionsById.get(node.type);
    const nodeRecord = node as typeof node & { label?: string; referenceId?: string };
    const displayName =
      (typeof nodeRecord.label === 'string' && nodeRecord.label.length > 0
        ? nodeRecord.label
        : action?.label) ?? humanize(node.type);
    const referenceId = buildReferenceId(nodeRecord.referenceId, displayName);
    const runStatus = nodeRunStatus?.[node.id];
    const mapped = mapRunStatus(runStatus);

    const data: ReactFlowNodeData = {
      id: node.id,
      type: node.type,
      display_name: displayName,
      reference_id: referenceId,
      description: action?.description,
      icon: action?.provider?.icon ?? action?.icon,
      status: mapped.status,
      executionStatus: mapped.executionStatus,
      params: (node.params ?? {}) as Record<string, unknown>,
      ...node.params,
    } as ReactFlowNodeData;

    return {
      id: node.id,
      type: node.type,
      position: node.position ?? { x: 0, y: 0 },
      data,
      width: 200,
      height: 60,
    };
  });

  const edges = flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  }));

  // Synthesise a minimal FlowVersion. The canvas only reads `flowId` +
  // `version` via React Query for cache-key stability; nothing else is
  // surfaced in the UI.
  const syntheticVersion = {
    flowId: '__flow-canvas__',
    version: 1,
    invectDefinition: flow,
    createdAt: new Date().toISOString(),
    createdBy: null,
  } as ReactFlowData['version'];

  return {
    nodes: nodes as ReactFlowData['nodes'],
    edges: edges as ReactFlowData['edges'],
    version: syntheticVersion,
    name: '',
    description: undefined,
    isActive: false,
  };
}

/**
 * Convert the Zustand store's internal working-copy nodes/edges back into
 * an `InvectDefinition`. Strips ReactFlow-internal state and flattens data
 * fields the same way `transformToInvectDefinition` does in `flowTransformations.ts`.
 *
 * This is re-implemented here (rather than re-used) so the flow-canvas
 * entry does not drag in the whole `~/utils/flowTransformations` module.
 */
export function reactFlowToInvectDefinition(nodes: Node[], edges: Edge[]): InvectDefinition {
  const transformedNodes = nodes.map((node) => {
    const data = (node.data || {}) as Record<string, unknown>;
    const params =
      data.params && typeof data.params === 'object'
        ? (data.params as Record<string, unknown>)
        : {};
    const display =
      typeof data.display_name === 'string' && data.display_name.trim().length > 0
        ? data.display_name.trim()
        : undefined;
    const reference =
      typeof data.reference_id === 'string' && data.reference_id.trim().length > 0
        ? data.reference_id.trim()
        : undefined;

    const nodeType = (node.type as string) || (data.type as string) || 'core.template_string';

    const out: Record<string, unknown> = {
      id: node.id,
      type: nodeType,
      position: node.position ?? { x: 0, y: 0 },
      params,
    };
    if (display) {
      out.label = display;
    }
    if (reference) {
      out.referenceId = reference;
    }
    return out;
  });

  const transformedEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
  }));

  return {
    nodes: transformedNodes,
    edges: transformedEdges,
  } as InvectDefinition;
}
