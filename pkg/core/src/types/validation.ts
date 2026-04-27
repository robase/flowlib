// Flow validation types shared between frontend and backend
import type {
  FlowNodeDefinitions,
  FlowlibDefinition,
  FlowEdge,
} from '../services/flow-versions/schemas-fresh';

interface ValidationOutput {
  message: string;

  // Optional fields for frontend highlighting
  nodeId?: string;
  edgeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceNodeType?: string;
  targetNodeType?: string;
  additionalContext?: Record<string, unknown>;
}

// Internal validation types for the validation engine
export interface ValidationIssue extends ValidationOutput {
  severity: 'error' | 'warning';
  type: string;
}

export interface GraphAnalysis {
  nodeMap: Map<string, FlowNodeDefinitions>;
  edgeMap: Map<string, FlowEdge>;
  incomingEdges: Map<string, FlowEdge[]>;
  outgoingEdges: Map<string, FlowEdge[]>;
}

export interface FlowValidationError extends ValidationOutput {
  severity: 'error';
  type: keyof (typeof FLOW_VALIDATION_ERROR_TYPES)['ERROR'];
}

export interface FlowValidationWarning extends ValidationOutput {
  severity: 'warning';
  type: keyof (typeof FLOW_VALIDATION_ERROR_TYPES)['WARNING'];
}

export type FlowValidationResult =
  | {
      isValid: false;
      errors: FlowValidationError[];
      warnings: FlowValidationWarning[];
    }
  | {
      isValid: true;
      warnings?: FlowValidationWarning[];
    };

// ─── Error / Warning type constants ──────────────────────────────────────────
//
// Errors  = will cause execution to crash or throw (the flow cannot run).
// Warnings = probably unintended but the flow will still execute.

export const FLOW_VALIDATION_ERROR_TYPES = {
  ERROR: {
    INVALID_EDGE_REFERENCE: 'INVALID_EDGE_REFERENCE',
    SELF_REFERENCING_EDGE: 'SELF_REFERENCING_EDGE',
    CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',
    MULTIPLE_MANUAL_TRIGGERS: 'MULTIPLE_MANUAL_TRIGGERS',
    VALIDATION_SYSTEM_ERROR: 'VALIDATION_SYSTEM_ERROR',
  },
  WARNING: {
    EMPTY_FLOW: 'EMPTY_FLOW',
    ENTRY_NODE_HAS_INCOMING_EDGES: 'ENTRY_NODE_HAS_INCOMING_EDGES',
    DISCONNECTED_NODE: 'DISCONNECTED_NODE',
    DUPLICATE_EDGE: 'DUPLICATE_EDGE',
  },
} as const;

// ─── Validation context ──────────────────────────────────────────────────────

export class ValidationContext {
  public readonly definition: FlowlibDefinition;
  public readonly analysis: GraphAnalysis;
  public readonly issues: ValidationIssue[] = [];

  constructor(definition: FlowlibDefinition, analysis: GraphAnalysis) {
    this.definition = definition;
    this.analysis = analysis;
  }

  addError(type: string, message: string, context?: Partial<ValidationIssue>): void {
    this.issues.push({ severity: 'error', type, message, ...context });
  }

  addWarning(type: string, message: string, context?: Partial<ValidationIssue>): void {
    this.issues.push({ severity: 'warning', type, message, ...context });
  }

  hasErrors(): boolean {
    return this.issues.some((issue) => issue.severity === 'error');
  }
}
