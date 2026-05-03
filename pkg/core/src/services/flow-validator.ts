import {
  FlowValidationResult,
  ValidationContext,
  GraphAnalysis,
  FlowValidationError,
  FlowValidationWarning,
} from '../types/validation';
import { FlowlibDefinition, FlowNodeDefinitions, FlowEdge } from './flow-versions/schemas-fresh';
import { GraphService } from './graph.service';

/**
 * Checks whether a node type is an entry point (receives external data, not flow data).
 * Entry points: trigger actions.
 */
function isEntryPointNode(nodeType: string): boolean {
  return nodeType.startsWith('trigger.');
}

/**
 * Static flow validator.
 *
 * Designed to help an agent (or user) verify that a flow definition will
 * execute correctly. This does NOT prevent saving — it only reports issues.
 *
 * Errors  = the flow WILL fail at execution time (topological sort throws, etc.)
 * Warnings = the flow will run but something looks unintentional.
 */
export class FlowValidator {
  static validateFlowDefinition(flowDefinition: FlowlibDefinition): FlowValidationResult {
    try {
      const context = new ValidationContext(
        flowDefinition,
        this.analyzeGraph(flowDefinition.nodes, flowDefinition.edges),
      );

      // Phase 1: Empty flow
      this.validateNotEmpty(context);

      // Phase 2: Edge integrity — edges must reference existing nodes
      this.validateEdgeReferences(context);

      // Phase 3: Self-referencing edges (source === target)
      this.validateNoSelfReferences(context);

      // Phase 4: Duplicate edges (same source→target on same handles)
      this.validateNoDuplicateEdges(context);

      // Phase 5: Cycle detection — cycles make topological sort throw
      this.validateNoCycles(context);

      // Phase 6: Entry-point nodes should not have incoming edges
      this.validateEntryPoints(context);

      // Phase 7: Completely disconnected nodes (zero edges)
      this.validateNoDisconnectedNodes(context);

      // Phase 8: Single manual trigger per flow
      this.validateSingleManualTrigger(context);

      return this.buildResult(context);
    } catch (error) {
      return {
        isValid: false,
        errors: [
          {
            severity: 'error' as const,
            type: 'VALIDATION_SYSTEM_ERROR',
            message: `Validation system error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        warnings: [],
      };
    }
  }

  // ─── Graph analysis ──────────────────────────────────────────────────────────

  private static analyzeGraph(
    nodes: readonly FlowNodeDefinitions[],
    edges: readonly FlowEdge[],
  ): GraphAnalysis {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const incomingEdges = new Map<string, FlowEdge[]>();
    const outgoingEdges = new Map<string, FlowEdge[]>();

    for (const node of nodes) {
      incomingEdges.set(node.id, GraphService.getIncomingEdges(node.id, edges));
      outgoingEdges.set(node.id, GraphService.getOutgoingEdges(node.id, edges));
    }

    return { nodeMap, edgeMap, incomingEdges, outgoingEdges };
  }

  // ─── Phase 1: Empty flow ────────────────────────────────────────────────────

  private static validateNotEmpty(context: ValidationContext): void {
    if (context.definition.nodes.length === 0) {
      context.addWarning('EMPTY_FLOW', 'Flow has no nodes');
    }
  }

  // ─── Phase 2: Edge references ───────────────────────────────────────────────

  private static validateEdgeReferences(context: ValidationContext): void {
    const { nodeMap } = context.analysis;

    for (const edge of context.definition.edges) {
      if (!nodeMap.has(edge.source)) {
        context.addError('INVALID_EDGE_REFERENCE', 'Edge references non-existent source node', {
          edgeId: edge.id,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
        });
      }
      if (!nodeMap.has(edge.target)) {
        context.addError('INVALID_EDGE_REFERENCE', 'Edge references non-existent target node', {
          edgeId: edge.id,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
        });
      }
    }
  }

  // ─── Phase 3: Self-referencing edges ────────────────────────────────────────

  private static validateNoSelfReferences(context: ValidationContext): void {
    for (const edge of context.definition.edges) {
      if (edge.source === edge.target) {
        context.addError('SELF_REFERENCING_EDGE', 'Edge connects a node to itself', {
          edgeId: edge.id,
          nodeId: edge.source,
        });
      }
    }
  }

  // ─── Phase 4: Duplicate edges ───────────────────────────────────────────────

  private static validateNoDuplicateEdges(context: ValidationContext): void {
    const seen = new Set<string>();

    for (const edge of context.definition.edges) {
      // Include handles so parallel edges on different output ports are allowed
      const key = `${edge.source}:${edge.sourceHandle ?? ''}→${edge.target}:${edge.targetHandle ?? ''}`;
      if (seen.has(key)) {
        context.addWarning('DUPLICATE_EDGE', 'Duplicate connection between the same nodes', {
          edgeId: edge.id,
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
        });
      }
      seen.add(key);
    }
  }

  // ─── Phase 5: Cycle detection ───────────────────────────────────────────────

  private static validateNoCycles(context: ValidationContext): void {
    const { nodes, edges } = context.definition;
    const result = GraphService.hasCycleDetection(nodes, edges);

    if (result.hasCycle && result.cyclePath) {
      context.addError('CIRCULAR_DEPENDENCY', 'Flow contains a cycle and cannot be executed', {
        additionalContext: {
          cyclePath: result.cyclePath,
          involvedNodeIds: result.cyclePath.slice(0, -1),
        },
      });
    }
  }

  // ─── Phase 6: Entry-point nodes ─────────────────────────────────────────────

  private static validateEntryPoints(context: ValidationContext): void {
    const { incomingEdges } = context.analysis;

    for (const node of context.definition.nodes) {
      if (!isEntryPointNode(node.type)) {
        continue;
      }

      const incoming = incomingEdges.get(node.id) || [];
      if (incoming.length > 0) {
        context.addWarning(
          'ENTRY_NODE_HAS_INCOMING_EDGES',
          `${node.label || node.type} is an entry-point node and should not have incoming connections`,
          {
            nodeId: node.id,
            sourceNodeType: node.type,
            additionalContext: {
              incomingEdgeCount: incoming.length,
            },
          },
        );
      }
    }
  }

  // ─── Phase 7: Disconnected nodes ────────────────────────────────────────────

  private static validateNoDisconnectedNodes(context: ValidationContext): void {
    const { incomingEdges, outgoingEdges } = context.analysis;

    // Only meaningful when there are at least 2 nodes
    if (context.definition.nodes.length < 2) {
      return;
    }

    for (const node of context.definition.nodes) {
      const incoming = incomingEdges.get(node.id) || [];
      const outgoing = outgoingEdges.get(node.id) || [];

      if (incoming.length === 0 && outgoing.length === 0) {
        context.addWarning('DISCONNECTED_NODE', 'Node has no connections to other nodes', {
          nodeId: node.id,
          sourceNodeType: node.type,
        });
      }
    }
  }

  // ─── Phase 8: Single manual trigger ─────────────────────────────────────────

  private static validateSingleManualTrigger(context: ValidationContext): void {
    const manualTriggers = context.definition.nodes.filter((n) => n.type === 'trigger.manual');

    if (manualTriggers.length > 1) {
      context.addError(
        'MULTIPLE_MANUAL_TRIGGERS',
        `Only one Manual Trigger is allowed per flow, but ${manualTriggers.length} were found`,
        {
          additionalContext: {
            triggerNodeIds: manualTriggers.map((n) => n.id),
          },
        },
      );
    }
  }

  // ─── Result builder ─────────────────────────────────────────────────────────

  private static buildResult(context: ValidationContext): FlowValidationResult {
    const warnings = context.issues.filter(
      (i) => i.severity === 'warning',
    ) as FlowValidationWarning[];

    if (context.hasErrors()) {
      return {
        isValid: false,
        errors: context.issues.filter((i) => i.severity === 'error') as FlowValidationError[],
        warnings,
      };
    }

    return {
      isValid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
