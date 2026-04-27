// Common Zod validation schemas for Flowlib API
// Shared across all framework adapters (Express, NestJS, etc.)

import { z } from 'zod/v4';

/**
 * Common validation schemas
 */

// UUID validation
export const uuidSchema = z.string().uuid('Invalid UUID format');

// Version number validation (positive integer)
export const versionSchema = z
  .number()
  .int('Version must be an integer')
  .positive('Version must be a positive integer');

// Tags array validation
export const tagsSchema = z
  .array(z.string().trim().min(1, 'Tag cannot be empty'))
  .optional()
  .default([]);

// Priority validation
export const prioritySchema = z.enum(['low', 'normal', 'high']).default('normal');

// Timeout validation (1 second to 1 hour)
export const timeoutSchema = z
  .number()
  .min(1000, 'Timeout must be at least 1 second (1000ms)')
  .max(3600000, 'Timeout cannot exceed 1 hour (3600000ms)')
  .optional();

// Retry count validation
export const retryCountSchema = z
  .number()
  .min(0, 'Retry count cannot be negative')
  .max(10, 'Retry count cannot exceed 10')
  .default(0);

// Search and filter schemas
export const searchSchema = z
  .string()
  .max(255, 'Search query cannot exceed 255 characters')
  .optional();

export const statusFilterSchema = z.enum(['active', 'inactive']).optional();

export const tagsFilterSchema = z.union([z.string().trim(), z.array(z.string().trim())]).optional();

// // Query parameters schema
// export const queryParamsSchema = paginatedResponseSchema.extend({
//   search: searchSchema,
//   status: statusFilterSchema,
//   tags: tagsFilterSchema
// });

// ID parameter validation
export const flowIdParamSchema = z.object({
  id: z.string().min(1, 'Flow ID is required'),
});

export const executionIdParamSchema = z.object({
  executionId: z.string().min(1, 'Execution ID is required'),
});

export const versionIdParamSchema = z.object({
  versionId: z.string().min(1, 'Version ID is required'),
});

// Response wrapper schemas
export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    timestamp: z.string().datetime(),
  });

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(
        z.object({
          field: z.string().optional(),
          message: z.string(),
          value: z.unknown().optional(),
        }),
      )
      .optional(),
  }),
  timestamp: z.string().datetime(),
});
