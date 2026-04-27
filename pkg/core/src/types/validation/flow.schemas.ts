// Flow-related Zod validation schemas for Flowlib API
// Shared across all framework adapters (Express, NestJS, etc.)

import { z } from 'zod/v4';
import { successResponseSchema, tagsSchema } from './common.schemas';
import { flowlibDefinitionSchema } from 'src/services/flow-versions/schemas-fresh';
import { PaginatedResponseSchema } from 'src/schemas/pagination-sort-filter';

/**
 * Flow creation schema
 */
export const createFlowSchema = z.object({
  name: z
    .string()
    .min(1, 'Flow name is required')
    .max(255, 'Flow name cannot exceed 255 characters')
    .trim(),
  isActive: z.boolean().optional(),
});

/**
 * Flow update schema (all fields optional except constraints)
 */
export const updateFlowSchema = z.object({
  name: z
    .string()
    .min(1, 'Flow name cannot be empty')
    .max(255, 'Flow name cannot exceed 255 characters')
    .trim()
    .optional(),

  description: z.string().max(1000, 'Description cannot exceed 1000 characters').trim().optional(),

  tags: tagsSchema.optional(),

  isActive: z.boolean().optional(),
});

/**
 * Flow response schemas
 */
export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const flowVersionSchema = z.object({
  id: z.string(),
  flowId: z.string(),
  flowlibDefinition: flowlibDefinitionSchema,
  isDraft: z.boolean().default(true),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});

/**
 * API response schemas
 */
export const flowResponseSchema = successResponseSchema(flowSchema);
export const flowsResponseSchema = PaginatedResponseSchema(flowSchema);
export const flowVersionResponseSchema = successResponseSchema(flowVersionSchema);
export const flowVersionsResponseSchema = PaginatedResponseSchema(flowVersionSchema);

/**
 * Type inference helpers
 */
export type FlowlibDefinitionSchema = z.infer<typeof flowlibDefinitionSchema>;
export type CreateFlowSchema = z.infer<typeof createFlowSchema>;
export type UpdateFlowSchema = z.infer<typeof updateFlowSchema>;
export type FlowSchema = z.infer<typeof flowSchema>;
export type FlowVersionSchema = z.infer<typeof flowVersionSchema>;
export type FlowResponseSchema = z.infer<typeof flowResponseSchema>;
export type FlowsResponseSchema = z.infer<typeof flowsResponseSchema>;
export type FlowVersionResponseSchema = z.infer<typeof flowVersionResponseSchema>;
export type FlowVersionsResponseSchema = z.infer<typeof flowVersionsResponseSchema>;

// Schema-derived node and edge types (recommended for new code)
export type SchemaFlowNode = z.infer<typeof flowlibDefinitionSchema>['nodes'][0];
export type SchemaFlowEdge = z.infer<typeof flowlibDefinitionSchema>['edges'][0];
export type SchemaFlowlibDefinition = z.infer<typeof flowlibDefinitionSchema>;
