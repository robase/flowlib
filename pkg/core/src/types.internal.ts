import { z } from 'zod/v4';
import type { NodeExecutionResult } from './types/node-execution.types';
import type { NodeOutput } from './types/node-io-types';
import type { Logger } from './schemas/flowlib-config';
import type { FlowEdge, FlowNodeDefinitions } from './services/flow-versions/schemas-fresh';
import type { AgentPromptResult } from './types/agent-tool.types';
import type { JsExpressionEvaluator } from '@flowlib/action-kit';

export type {
  SubmitPromptRequest,
  SubmitAgentPromptRequest,
  SubmitPromptResult,
  RecordToolExecutionInput,
} from '@flowlib/action-kit';
import type {
  SubmitPromptRequest,
  SubmitAgentPromptRequest,
  SubmitPromptResult,
  RecordToolExecutionInput,
} from '@flowlib/action-kit';

/**
 * Context of an individual run of a flow
 */
export interface FlowRunContext {
  flowId: string;
  flowVersion: number;
  flowRunId: string;

  globalConfig: Record<string, string | number | boolean | null>;
  // Optional overrides from the default global Flowlib config for this specific flow
  flowParams: Record<string, unknown>; // TODO: useBatchProcessing: boolean; should existi

  // inputs values provided to this flow (includes trigger data when triggered by webhook/cron)
  flowInputs: Record<string, unknown>;

  /**
   * Incoming data from upstream nodes, keyed by reference ID.
   * Used by nodes that do their own template processing (e.g., Template String).
   * Structure: { ref_id: { output: value, ... }, ... }
   */
  incomingData?: Record<string, unknown>;

  /** All edges in the flow graph */
  edges: readonly FlowEdge[];
  /** All nodes in the flow graph */
  nodes: readonly FlowNodeDefinitions[];

  nodeExecutionResults: Map<string, NodeExecutionResult>;

  /** All collected outputs by nodeId */
  allNodeOutputs: Map<string, NodeOutput>;

  /** All collected inputs by nodeId */
  allNodeInputs: Map<string, unknown>;

  /** Skipped node tracking */
  skippedNodeIds: Set<string>;

  logger: Logger;

  error?: string;
  startedAt: Date | string;
  completedAt?: Date | string;
  durationMs?: number;
  initiatedBy?: string;

  functions: {
    // Template rendering ({{ expression }} syntax)
    runTemplateReplacement: (
      template: string,
      variables: {
        [key: string]: unknown;
      },
    ) => Promise<string>;

    // Flow control - mark downstream nodes as skipped
    markDownstreamNodesAsSkipped?: (
      nodeId: string,
      edges: readonly FlowEdge[],
      skippedNodes: Set<string>,
      isFromIfElse?: boolean,
    ) => void;

    // Credential retrieval for node authentication
    getCredential?: (credentialId: string) => Promise<{
      id: string;
      name: string;
      type: string;
      authType: string;
      config: Record<string, unknown>;
    } | null>;

    // Model prompt submission - has flow implications (batch processing)
    submitPrompt?: (request: SubmitPromptRequest) => Promise<SubmitPromptResult>;

    // Agent prompt submission - supports batch processing on first iteration
    submitAgentPrompt?: (
      request: SubmitAgentPromptRequest,
    ) => Promise<
      | AgentPromptResult
      | { type: 'batch_submitted'; batchJobId: string; nodeId: string; flowRunId: string }
    >;

    // Record tool execution for agent nodes
    recordToolExecution?: (input: RecordToolExecutionInput) => Promise<{ id: string } | null>;

    // Increment retryCount on the current trace (used by the retry loop
    // inside executeActionAsNode so the UI / metrics see per-attempt progress).
    incrementRetryCount?: (traceId: string) => Promise<void>;

    // JS expression evaluator (QuickJS-backed on Node, direct on edge runtimes).
    // Used by core.javascript, core.if_else, core.switch.
    evaluator?: JsExpressionEvaluator;
  };
}

// Node and execution types (expanded stubs)
export interface NodeExecutionContext extends FlowRunContext {
  nodeId: string;
  traceId?: string;
  /**
   * Per-run abort signal cascaded from the FlowRunCoordinator's controller.
   * Actions making long-running calls (model, agent, http) should respect
   * this and propagate to the SDK / fetch they invoke.
   */
  abortSignal?: AbortSignal;
}

export const metadataSchema = z.record(z.string(), z.unknown()).optional();

export type MetaData = z.infer<typeof metadataSchema>;
