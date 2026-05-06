import { z } from 'zod/v4';
import { PaginationQuerySchema } from '../pagination-sort-filter'; // adjust import path as needed

/**
 * Flow ID parameter schema
 */
export const FlowIdParamsSchema = z.object({
  flowId: z.string().min(1, 'Flow ID is required and cannot be empty'),
});

/**
 * Flow executions specific query parameters
 */
export const FlowExecutionsFilterSchema = z.object({
  status: z
    .enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PAUSED', 'CANCELLED', 'PAUSED_FOR_BATCH'])
    .optional(),
  sortBy: z
    .enum(['startedAt', 'endedAt', 'status', 'inputData', 'outputData', 'error'])
    .default('startedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Get flow executions query schema
 * Combines pagination with flow-specific filters
 */
export const GetFlowExecutionsQuerySchema = PaginationQuerySchema.merge(FlowExecutionsFilterSchema);

/**
 * Flow inputs — arbitrary user-supplied data passed to a flow run. The shape
 * is intentionally open because flow authors define their own input contract;
 * Zod just enforces "object whose values are JSON-compatible" at the boundary.
 */
export const FlowInputsSchema = z.record(z.string(), z.unknown());

/**
 * Options for `runs.start` / `runs.startAsync` / `runs.executeToNode`.
 */
export const ExecuteFlowOptionsSchema = z.object({
  version: z.union([z.number().int().positive(), z.literal('latest')]).optional(),
  initiatedBy: z.string().optional(),
  useBatchProcessing: z.boolean().optional(),
});

/**
 * Body for `POST /flows/:flowId/run` and `POST /flows/:flowId/run-to-node/:nodeId`.
 */
export const RunFlowBodySchema = z.object({
  inputs: FlowInputsSchema.optional(),
  options: ExecuteFlowOptionsSchema.optional(),
});

// Type exports
export type FlowIdParams = z.infer<typeof FlowIdParamsSchema>;
export type FlowExecutionsFilter = z.infer<typeof FlowExecutionsFilterSchema>;
export type GetFlowExecutionsQuery = z.infer<typeof GetFlowExecutionsQuerySchema>;
export type RunFlowBody = z.infer<typeof RunFlowBodySchema>;
