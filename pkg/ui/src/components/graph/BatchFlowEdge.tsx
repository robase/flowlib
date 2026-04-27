import React, { memo, useMemo } from 'react';
import {
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  MarkerType,
} from '@xyflow/react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { X, Zap, AlertTriangle, SkipForward } from 'lucide-react';

// Enhanced edge data interface
export interface BatchFlowEdgeData extends Record<string, unknown> {
  label?: string;
  type?: 'default' | 'data' | 'conditional' | 'error' | 'skipped';
  animated?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  sourceHandle?: string;
  targetHandle?: string;
  /** NodeExecutionStatus of the source node (when viewing a flow run). */
  sourceNodeStatus?: string;
  /** NodeExecutionStatus of the target node (when viewing a flow run). */
  targetNodeStatus?: string;
  validation?: {
    valid: boolean;
    message?: string;
  };
}

/**
 * Derive a visual execution state for the edge from the source/target node
 * statuses. This is what drives the per-edge color + animation in flow-run
 * views. Returns `null` when no status info is available (editor mode).
 */
type EdgeExecutionState = 'failed' | 'success' | 'active' | 'pending' | null;

function deriveEdgeExecutionState(data?: BatchFlowEdgeData): EdgeExecutionState {
  const src = data?.sourceNodeStatus;
  const tgt = data?.targetNodeStatus;
  if (!src && !tgt) {
    return null;
  }

  // Either endpoint skipped → fall through so the existing `type: 'skipped'`
  // styling (gray dashed) wins over execution-state coloring.
  if (src === 'SKIPPED' || tgt === 'SKIPPED') {
    return null;
  }

  // Source failed → the edge will never deliver — render red regardless of
  // the (probably absent) target status.
  if (src === 'FAILED') {
    return 'failed';
  }

  if (src === 'SUCCESS') {
    // Target running: data is being consumed right now.
    if (tgt === 'RUNNING') {
      return 'active';
    }
    // Target queued or waiting on batch: dim, slow.
    if (tgt === 'PENDING' || tgt === 'BATCH_SUBMITTED') {
      return 'pending';
    }
    // Edge delivered into a node that then failed — render red so the failed
    // path is visible end-to-end, not just on the failed node's outgoing edges.
    if (tgt === 'FAILED') {
      return 'failed';
    }
    // Both finished successfully — stable green.
    if (tgt === 'SUCCESS') {
      return 'success';
    }
    // No target trace yet — pre-terminal-flow case (mid-run).
    return 'success';
  }

  // Source still running/pending → upstream not done; edge has nothing to
  // carry yet. Fall back to the default neutral style.
  return null;
}

// Edge styles based on type and state - Updated to match Flowlib's edge styling
const getEdgeStyles = (
  data: BatchFlowEdgeData | undefined,
  selected: boolean | undefined,
  execState: EdgeExecutionState,
) => {
  const baseStyle = {
    strokeWidth: 2,
    stroke: 'var(--muted-foreground)', // Theme-aware default edge color
    fill: 'none', // Explicitly set fill to none for SVG paths
  };

  // Execution state takes precedence over selection visuals so the user can
  // still read the run outcome at a glance even when an edge is selected.
  if (execState === 'failed') {
    return { ...baseStyle, stroke: 'var(--destructive, #ef4444)', strokeWidth: 2.5 };
  }
  if (execState === 'success') {
    return { ...baseStyle, stroke: 'var(--success, #16a34a)', strokeWidth: 2.5 };
  }
  // 'active' and 'pending' use a CSS class for the marching-ants animation —
  // stroke / dasharray are set there, not in the inline style.
  if (execState === 'active' || execState === 'pending') {
    return { ...baseStyle, strokeWidth: 2.5, stroke: undefined as unknown as string };
  }

  if (selected) {
    return {
      ...baseStyle,
      stroke: 'var(--edge-selected-stroke, #3b82f6)', // Blue for selected, uses CSS variable for theme awareness
      strokeWidth: 3,
    };
  }

  if (data?.highlighted) {
    return {
      ...baseStyle,
      stroke: '#3b82f6', // Blue for highlighted
      strokeWidth: 2.5,
    };
  }

  switch (data?.type) {
    case 'data':
      return {
        ...baseStyle,
        stroke: '#3b82f6', // Blue-500 equivalent
        strokeWidth: 2,
      };
    case 'conditional':
      return {
        ...baseStyle,
        stroke: '#f59e0b', // Amber-500 equivalent
        strokeWidth: 2,
        strokeDasharray: '5,5',
      };
    case 'error':
      return {
        ...baseStyle,
        stroke: '#ef4444', // Red-500
        strokeWidth: 2,
      };
    case 'skipped':
      return {
        ...baseStyle,
        stroke: '#6b7280', // Gray-500 for skipped edges
        strokeWidth: 1.5,
        strokeDasharray: '8,4', // Longer dashes for skipped appearance
        opacity: 0.5, // Make it more transparent
      };
    default:
      return baseStyle;
  }
};

// Main Flowlib Edge Component
export const BatchFlowEdge = memo(function BatchFlowEdge(props: EdgeProps) {
  const {
    id: _id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
    selected,
    markerEnd,
  } = props;

  const batchflowData = data as BatchFlowEdgeData;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25, // Add curvature for smooth bezier curves
  });

  const execState = useMemo(
    () => deriveEdgeExecutionState(batchflowData),
    [batchflowData?.sourceNodeStatus, batchflowData?.targetNodeStatus],
  );

  const edgeStyle = useMemo(
    () => ({
      ...getEdgeStyles(batchflowData, selected, execState),
      ...style,
    }),
    [
      batchflowData?.type,
      batchflowData?.highlighted,
      batchflowData?.validation?.valid,
      selected,
      style,
      execState,
    ],
  );

  const edgeClassName = cn(
    execState === 'active' && 'edge-active',
    execState === 'pending' && 'edge-pending',
  );

  const showLabel = batchflowData?.label || batchflowData?.validation?.message;
  const isError =
    batchflowData?.type === 'error' ||
    (batchflowData?.validation && !batchflowData.validation.valid);

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
        interactionWidth={20}
        className={edgeClassName || undefined}
      />

      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 12,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            {batchflowData?.label && (
              <div
                className={cn(
                  'bg-background/95 backdrop-blur-sm border border-border/50 rounded-lg px-3 py-1.5 shadow-lg text-xs font-medium',
                  'transition-all duration-200 hover:shadow-xl hover:scale-105',
                  'max-w-[200px] truncate',
                  selected && 'ring-2 ring-primary/50 ring-offset-1',
                  isError && 'border-destructive/70 bg-destructive/10 text-destructive',
                )}
              >
                <div className="flex items-center gap-1.5">
                  {batchflowData.type === 'conditional' && (
                    <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  {batchflowData.type === 'skipped' && (
                    <SkipForward className="w-3 h-3 text-muted-foreground shrink-0" />
                  )}
                  {isError && <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />}
                  <span
                    className={cn(
                      'text-foreground truncate',
                      isError && 'text-destructive',
                      batchflowData.type === 'skipped' && 'text-muted-foreground',
                    )}
                  >
                    {batchflowData.label}
                  </span>
                </div>
                {batchflowData?.validation?.message && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {batchflowData.validation.message}
                  </div>
                )}
              </div>
            )}

            {selected && (
              <Button
                variant="destructive"
                size="icon"
                className="w-6 h-6 ml-2 opacity-80 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  // Edge deletion handled by parent component via onEdgesDelete
                }}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

BatchFlowEdge.displayName = 'BatchFlowEdge';

// Predefined edge types matching Flowlib's patterns
const _edgeTypes = {
  // flowlib: BatchFlowEdge,
  default: BatchFlowEdge,
};

// Edge creation utilities

// Default edge styles for different connection types
export const defaultEdgeOptions = {
  type: 'default',
  animated: false,
  style: {
    strokeWidth: 2,
    stroke: 'var(--muted-foreground)', // Theme-aware default edge color
    fill: 'none',
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: 'var(--muted-foreground)', // Theme-aware marker color
  },
};
