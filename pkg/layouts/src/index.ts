/**
 * @flowlib/layouts
 *
 * Shared layout utilities for Flowlib graph positioning.
 * Framework-agnostic layout algorithms used by both core services and frontend.
 *
 * These utilities work with generic node/edge interfaces to maintain framework independence.
 */

// Re-export types
export type { LayoutNode, LayoutEdge, LayoutHandle, ElkLayoutNode, ElkLayoutEdge } from './types';

// Re-export Dagre layout
export {
  applyDagreLayout,
  applyRowWrapping,
  detectSkipEdges,
  applyVerticalOffsetForSkipEdges,
  applyMultiOutputBranchOffsets,
  applyIfElseBranchOffsets,
  type DagreLayoutOptions,
} from './dagre';

// Re-export ElkJS layout
export { applyElkLayout, enrichNodesWithHandles, type ElkJsLayoutOptions } from './elk';

// Re-export Flowlib-specific layout
export { applyFlowlibLayout, type FlowlibLayoutOptions } from './flowlib';
