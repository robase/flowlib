import type { FlowRunResult } from '../../src';
import type { InvectInstance } from '../../src/api/types';

export interface StructuredNodeOutput {
  data?: {
    variables?: Record<string, { value?: unknown }>;
  };
}

export interface AgentToolResultLike {
  toolId?: string;
  toolName?: string;
  success?: boolean;
  output?: unknown;
}

export interface AgentOutputLike {
  finalResponse?: string;
  finishReason?: string;
  iterations?: number;
  toolResults?: AgentToolResultLike[];
}

export function getOutputVariable(output: unknown, variableName = 'output'): unknown {
  const structuredOutput = output as StructuredNodeOutput | undefined;
  return structuredOutput?.data?.variables?.[variableName]?.value;
}

export interface FlowExample {
  /**
   * Human-friendly name displayed in the E2E runner output.
   */
  name: string;
  /**
   * Short description of what the example covers.
   */
  description: string;
  /**
   * Create the flow, execute it, and return the resulting FlowRun payload.
   */
  execute(flowlib: InvectInstance): Promise<FlowRunResult>;
  /**
   * Perform assertions against the execution result. Throw to signal failure.
   */
  expected(result: FlowRunResult): void | Promise<void>;
}
