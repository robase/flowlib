// Demo / preview components for embedding Invect UI without a backend.
//
// These components are designed for documentation, marketing pages,
// and interactive previews where no Invect server is available.

export { DemoInvect, type DemoInvectProps } from './DemoInvect';
export { FlowViewer, type FlowViewerProps } from './FlowViewer';
export { createDemoApiClient, type DemoData } from './demo-api-client';
export {
  sampleNodeDefinitions,
  simpleFlowNodes,
  simpleFlowEdges,
  branchingFlowNodes,
  branchingFlowEdges,
  showcaseFlowNodes,
  showcaseFlowEdges,
  showcaseAgentTools,
  sampleDemoData,
} from './sample-data';

// Re-export types commonly needed when constructing demo data
export type { NodeDefinition } from '../types/node-definition.types';
export type {
  ReactFlowNodeData,
  ReactFlowNode,
  ReactFlowEdge,
  AgentToolDefinition,
} from '@flowlib/core/types';
