import type { FlowVersion } from '@flowlib/db';
import { FlowRun } from './flow-runs/flow-runs.model';
import { NodeExecution } from './node-executions/node-executions.model';
import { FlowRunStatus, NodeExecutionStatus } from '../types/base';
import { Logger } from '../schemas';
import { DatabaseError } from '../types/common/errors.types';
import { FlowEdge, FlowNodeDefinitions } from './flow-versions/schemas-fresh';
import type { NodeOutput, NodeInputData } from '../types/node-io-types';
import { getGlobalActionRegistry } from '@flowlib/actions/registry';
import { applyElkLayout } from '@flowlib/layouts';
import { FlowsService } from './flows/flows.service';
import { FlowVersionsService } from './flow-versions/flow-versions.service';
import { FlowRunsService } from './flow-runs/flow-runs.service';
import { NodeExecutionService } from './node-executions/node-execution.service';
import * as Schemas from '../schemas';

// Position interface matching existing schema
export interface Position {
  x: number;
  y: number;
}

// Node visual status for React Flow rendering
export type NodeVisualStatus = 'idle' | 'running' | 'completed' | 'error' | 'skipped';

// Layout will be handled on the frontend

// Node execution status for rendering
export interface NodeExecutionStatusInfo {
  status: NodeExecutionStatus;
  error?: string;
  output?: NodeOutput;
}

// Base React Flow node data interface
export interface ReactFlowNodeData extends Record<string, unknown> {
  id: string;
  type: string;
  display_name: string;
  reference_id: string; // snake_case unique identifier for input mapping
  description?: string;
  icon?: string;
  status: NodeVisualStatus;
  executionStatus?: NodeExecutionStatus;
  executionError?: string;
  executionOutput?: NodeOutput;
  // Node configuration parameters (dynamic based on node definition)
  params?: Record<string, unknown>;
  // Runtime inputs (what the node receives during execution)
  inputs?: NodeInputData;
  // Runtime outputs (what the node produces during execution)
  outputs?: NodeOutput['data'];
}

// React Flow compatible node interface with strong typing
export interface ReactFlowNode<T extends string = string> {
  id: string;
  type: T;
  position: Position;
  data: ReactFlowNodeData;
  width?: number;
  height?: number;
  measured?: { width: number; height: number };
  dragHandle?: string;
}

// React Flow compatible edge interface
export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  animated?: boolean;
  data?: {
    type: 'default' | 'skipped';
    animated: boolean;
    highlighted: boolean;
    selected: boolean;
    sourceNodeStatus?: NodeExecutionStatus;
    targetNodeStatus?: NodeExecutionStatus;
  };
}

// Complete React Flow data response
export interface ReactFlowData {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  version: FlowVersion;
  name: string;
  description?: string;
  isActive: boolean;
  executionStatus?: Map<string, NodeExecutionStatusInfo>;
}

// Strongly typed React Flow data for specific node types
export interface TypedReactFlowData<T extends string = string> {
  nodes: ReactFlowNode<T>[];
  edges: ReactFlowEdge[];
  version: FlowVersion;
  name: string;
  description?: string;
  executionStatus?: Map<string, NodeExecutionStatusInfo>;
}

/**
 * Service for rendering flow data in React Flow compatible format
 * Transforms Flowlib flow definitions into React Flow compatible nodes and edges
 */
export class ReactFlowRendererService {
  private initialized = false;

  constructor(
    private readonly logger: Logger,
    private readonly flowsService: FlowsService,
    private readonly flowVersionsService: FlowVersionsService,
    private readonly flowRunsService: FlowRunsService,
    private readonly nodeExecutionsService: NodeExecutionService,
  ) {}

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('React Flow renderer service already initialized');
      return;
    }

    try {
      this.initialized = true;
      this.logger.info('React Flow renderer service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize React Flow renderer service', { error });
      throw new DatabaseError('Failed to initialize React Flow renderer service', { error });
    }
  }

  /**
   * Transform flow version and execution data to React Flow format
   */
  async renderToReactFlow(
    flowId: string,
    options?: { version?: string | number | 'latest'; flowRunId?: string },
  ): Promise<ReactFlowData> {
    this.logger.debug(
      'renderToReactFlow called with arguments:',
      JSON.stringify({ flowId, options }, null, 2),
    );

    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });

    // Get flow version
    const flowVersion = await this.flowVersionsService.getFlowVersion(
      validatedParams.flowId,
      options?.version || 'latest',
    );

    if (!flowVersion) {
      throw new DatabaseError(`Flow version not found for flow ${flowId}`);
    }

    // Get flow details for name/description
    const flow = await this.flowsService.getFlowById(validatedParams.flowId);

    // Get execution data if flowRunId provided
    let flowRun: FlowRun | undefined;
    let nodeExecutions: NodeExecution[] | undefined;

    if (options?.flowRunId) {
      flowRun = await this.flowRunsService.getRunById(options.flowRunId);
      nodeExecutions = await this.nodeExecutionsService.listNodeExecutionsByFlowRunId(
        options.flowRunId,
      );
    }

    return this.transformToReactFlowData(
      flowVersion,
      flow.name,
      flow.description,
      flow.isActive,
      flowRun,
      nodeExecutions,
    );
  }

  /**
   * Internal method to transform data to React Flow format
   */
  private async transformToReactFlowData(
    flowVersion: FlowVersion,
    flowName: string,
    flowDescription?: string,
    isActive: boolean = true,
    flowRun?: FlowRun,
    nodeExecutions?: NodeExecution[],
  ): Promise<ReactFlowData> {
    this.logger.debug('Rendering flow to React Flow format', {
      flowId: flowVersion.flowId,
      flowVersion: flowVersion.version,
      flowRunId: flowRun?.id,
      nodeExecutionsCount: nodeExecutions?.length || 0,
    });

    // Create execution status map
    const executionStatusMap = this.createExecutionStatusMap(nodeExecutions);

    // When the flow run is in a terminal state, any node that never got a
    // trace (never entered the scheduler's ready set after failure/cancellation)
    // should render as SKIPPED. Same for nodes still in PENDING / RUNNING —
    // those are stale traces from a process that died mid-flight. This makes
    // the UI match reality: no lingering animated borders after the run ends,
    // and edges into unstarted nodes render as skipped (gray-dashed).
    if (flowRun && this.isTerminalFlowRunStatus(flowRun.status)) {
      this.coerceUnfinishedNodesToSkipped(flowVersion, executionStatusMap);
    }

    // Transform nodes and edges
    let nodes = this.transformNodes(flowVersion, executionStatusMap);
    const edges = this.transformEdges(flowVersion, executionStatusMap);

    // Only auto-layout when no node has a saved position (e.g. a freshly
    // created flow). Otherwise respect the positions the user has saved —
    // layout should only run on an explicit user action from the editor.
    const hasSavedPositions =
      flowVersion.flowlibDefinition?.nodes?.some(
        (n: FlowNodeDefinitions) => n.position !== undefined,
      ) ?? false;
    if (!hasSavedPositions) {
      nodes = await this.applyElkLayoutToNodes(nodes, edges);
    }

    return {
      nodes,
      edges,
      version: flowVersion,
      name: flowName,
      description: flowDescription,
      isActive,
      executionStatus: executionStatusMap,
    };
  }

  /**
   * Create execution status map from node executions
   */
  private createExecutionStatusMap(
    nodeExecutions?: NodeExecution[],
  ): Map<string, NodeExecutionStatusInfo> {
    const statusMap = new Map<string, NodeExecutionStatusInfo>();

    if (nodeExecutions) {
      nodeExecutions.forEach((execution) => {
        statusMap.set(execution.nodeId, {
          status: execution.status,
          error: execution.error,
          output: execution.outputs,
        });
      });
    }

    return statusMap;
  }

  private isTerminalFlowRunStatus(status: FlowRunStatus): boolean {
    return (
      status === FlowRunStatus.SUCCESS ||
      status === FlowRunStatus.FAILED ||
      status === FlowRunStatus.CANCELLED
    );
  }

  /**
   * After a terminal flow run, any node without a completed trace is treated
   * as SKIPPED for display:
   *  - No trace at all → synthesize a SKIPPED entry so the node renders as
   *    dimmed/dashed and its outgoing edges get the skipped styling.
   *  - Trace in PENDING / RUNNING / BATCH_SUBMITTED → the run ended before it
   *    finished (cancel, crash, stale-run reaper). Coerce to SKIPPED for the
   *    same visual; the underlying DB row is untouched.
   */
  private coerceUnfinishedNodesToSkipped(
    flowVersion: FlowVersion,
    statusMap: Map<string, NodeExecutionStatusInfo>,
  ): void {
    const nodes = flowVersion.flowlibDefinition?.nodes;
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      const existing = statusMap.get(node.id);
      if (!existing) {
        statusMap.set(node.id, { status: NodeExecutionStatus.SKIPPED });
        continue;
      }
      if (
        existing.status === NodeExecutionStatus.PENDING ||
        existing.status === NodeExecutionStatus.RUNNING ||
        existing.status === NodeExecutionStatus.BATCH_SUBMITTED
      ) {
        statusMap.set(node.id, { ...existing, status: NodeExecutionStatus.SKIPPED });
      }
    }
  }

  /**
   * Transform flow nodes to React Flow format
   */
  private transformNodes(
    flowVersion: FlowVersion,
    executionStatusMap: Map<string, NodeExecutionStatusInfo>,
  ): ReactFlowNode[] {
    const nodes: ReactFlowNode[] = [];

    const definition = flowVersion.flowlibDefinition;
    if (!definition?.nodes) {
      return nodes;
    }

    const actionRegistry = getGlobalActionRegistry();

    definition.nodes.forEach((node: FlowNodeDefinitions) => {
      const executionStatus = executionStatusMap.get(node.id);
      const action = actionRegistry.get(node.type);

      const displayName = this.getDisplayName(node, action);
      const referenceId = this.getReferenceId(
        node as FlowNodeDefinitions & { referenceId?: string },
        displayName,
      );

      // Create strongly typed node data
      const nodeData: ReactFlowNodeData = {
        id: node.id,
        type: node.type,
        display_name: displayName,
        reference_id: referenceId,
        description: action?.description,
        icon: action?.provider.icon,
        status: this.mapExecutionStatusToNodeStatus(executionStatus?.status),
        executionStatus: executionStatus?.status,
        executionError: executionStatus?.error,
        executionOutput: executionStatus?.output,
        params: node.params,
        // Runtime data will be populated during execution
        inputs: undefined, // Could be populated from execution context if available
        outputs: executionStatus?.output?.data,
        // Flatten params to top level for component access
        ...node.params,
        // Data mapper config (top-level node field)
        ...(node.mapper ? { mapper: node.mapper } : {}),
      };

      // Compute per-node height: switch nodes grow taller with more outputs
      let nodeHeight = 60;
      // Matches both DB-origin `core.switch` and SDK-origin `primitives.switch`.
      // See `@flowlib/primitives`' SWITCH_TYPES for the canonical alias set.
      if (
        (node.type === 'core.switch' || node.type === 'primitives.switch') &&
        node.params &&
        Array.isArray((node.params as Record<string, unknown>).cases)
      ) {
        const outputCount =
          ((node.params as Record<string, unknown>).cases as unknown[]).length + 1; // cases + default
        if (outputCount > 2) {
          nodeHeight = 32 + (outputCount - 1) * 24;
        }
      }

      const transformedNode: ReactFlowNode = {
        id: node.id,
        type: node.type,
        position: node.position || { x: 0, y: 0 },
        data: nodeData,
        width: 200,
        height: nodeHeight,
      };

      nodes.push(transformedNode);
    });

    return nodes;
  }

  /**
   * Get display name for a node, with fallbacks
   */
  private getDisplayName(node: FlowNodeDefinitions, action: { name: string } | undefined): string {
    // First priority: user-defined label on the node itself
    if (node.label && typeof node.label === 'string') {
      return node.label;
    }

    // Second priority: action registry name
    if (action?.name) {
      return action.name;
    }

    // Fallback: humanise the node type string (e.g. "core.javascript" → "Core Javascript")
    return node.type.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private static readonly MAX_REFERENCE_ID_LENGTH = 22;

  /**
   * Get or generate a reference_id for a node (snake_case, alphanumeric only)
   * Truncates to MAX_REFERENCE_ID_LENGTH while preserving any increment suffix
   */
  private getReferenceId(
    node: FlowNodeDefinitions & { referenceId?: string },
    displayName: string,
  ): string {
    // Use existing referenceId if present (already truncated when saved)
    if (node.referenceId && typeof node.referenceId === 'string') {
      return node.referenceId;
    }

    // Generate from display name: lowercase, alphanumeric + underscores only
    const baseId = displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric chars except spaces
      .trim()
      .replace(/\s+/g, '_'); // Replace spaces with underscores

    // Truncate to max length
    return this.truncateReferenceId(baseId);
  }

  /**
   * Truncate a reference ID to max length while preserving any numeric suffix
   */
  private truncateReferenceId(refId: string, suffix?: string): string {
    const maxLen = ReactFlowRendererService.MAX_REFERENCE_ID_LENGTH;

    if (refId.length <= maxLen) {
      return refId;
    }

    if (suffix) {
      const suffixWithUnderscore = `_${suffix}`;
      const availableForBase = maxLen - suffixWithUnderscore.length;
      if (availableForBase <= 0) {
        return refId.substring(0, maxLen);
      }
      return refId.substring(0, availableForBase) + suffixWithUnderscore;
    }

    return refId.substring(0, maxLen);
  }

  /**
   * Transform flow edges to React Flow format
   */
  private transformEdges(
    flowVersion: FlowVersion,
    executionStatusMap: Map<string, NodeExecutionStatusInfo>,
  ): ReactFlowEdge[] {
    const edges: ReactFlowEdge[] = [];

    const definition = flowVersion.flowlibDefinition;
    if (!definition?.edges || !definition?.nodes) {
      return edges;
    }

    // Create a map of node IDs to their types for handle validation
    const nodeTypeMap = new Map<string, string>();
    definition.nodes.forEach((node: FlowNodeDefinitions) => {
      nodeTypeMap.set(node.id, node.type);
    });

    definition.edges.forEach((edge: FlowEdge & { animated?: boolean }) => {
      const sourceNodeStatus = executionStatusMap.get(edge.source);
      const targetNodeStatus = executionStatusMap.get(edge.target);

      // Check if either node is skipped
      const isConnectedToSkippedNode =
        sourceNodeStatus?.status === NodeExecutionStatus.SKIPPED ||
        targetNodeStatus?.status === NodeExecutionStatus.SKIPPED;

      // Pass through source/target handles from the stored edge definition
      // These are needed by React Flow to connect edges to the correct handles
      // Default to "output"/"input" if not specified (standard single-handle nodes)
      const transformedEdge: ReactFlowEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || 'output',
        targetHandle: edge.targetHandle || 'input',
        animated: edge.animated || false,
        data: {
          type: isConnectedToSkippedNode ? 'skipped' : 'default',
          animated: edge.animated || false,
          highlighted: false,
          selected: false,
          sourceNodeStatus: sourceNodeStatus?.status,
          targetNodeStatus: targetNodeStatus?.status,
        },
      };

      edges.push(transformedEdge);
    });

    return edges;
  }

  /**
   * Map execution status to node visual status
   */
  private mapExecutionStatusToNodeStatus(executionStatus?: NodeExecutionStatus): NodeVisualStatus {
    if (!executionStatus) {
      return 'idle';
    }

    switch (executionStatus) {
      case NodeExecutionStatus.PENDING:
      case NodeExecutionStatus.RUNNING:
        return 'running';
      case NodeExecutionStatus.SUCCESS:
        return 'completed';
      case NodeExecutionStatus.FAILED:
        return 'error';
      case NodeExecutionStatus.SKIPPED:
        return 'skipped';
      case NodeExecutionStatus.BATCH_SUBMITTED:
        return 'running'; // Treat batch submitted as running
      default:
        return 'idle';
    }
  }

  /**
   * Apply ELK left-to-right layout to nodes
   * Uses elkjs layered algorithm for better edge crossing minimization
   *
   * Note: ELK is async because elkjs uses web workers internally
   */
  private async applyElkLayoutToNodes(
    nodes: ReactFlowNode[],
    edges: ReactFlowEdge[],
  ): Promise<ReactFlowNode[]> {
    const laidOut = await applyElkLayout(nodes, edges);
    return laidOut.map((node) => ({
      ...node,
      position: {
        x: Math.round(node.position.x * 100) / 100,
        y: Math.round(node.position.y * 100) / 100,
      },
    }));
  }
}
