// Flowlib API Validation Schemas
// Centralized Zod schemas for type-safe API validation across all frameworks

// Common validation utilities
export * from './common.schemas';

// Flow-related validation schemas
export * from './flow.schemas';

/**
 * Validation utilities for framework adapters
 */
import { z } from 'zod/v4';

/**
 * Generic validation result type
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

export interface ValidationError {
  field?: string;
  message: string;
  value?: unknown;
}

/**
 * Validate data against a Zod schema and return structured result
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
    value:
      issue.path.length > 0
        ? getNestedValue(
            data,
            issue.path.filter((p) => typeof p === 'string' || typeof p === 'number'),
          )
        : data,
  }));

  return {
    success: false,
    errors,
  };
}

/**
 * Get nested value from object by path
 */
function getNestedValue(obj: unknown, path: (string | number)[]): unknown {
  return path.reduce((current: unknown, key: string | number) => {
    return current && typeof current === 'object'
      ? (current as Record<string | number, unknown>)[key]
      : undefined;
  }, obj);
}

/**
 * Create a validation middleware factory for any framework
 */
export function createValidationFactory() {
  return {
    body: <T>(schema: z.ZodSchema<T>) => ({
      schema,
      validate: (data: unknown) => validateData(schema, data),
    }),

    params: <T>(schema: z.ZodSchema<T>) => ({
      schema,
      validate: (data: unknown) => validateData(schema, data),
    }),

    query: <T>(schema: z.ZodSchema<T>) => ({
      schema,
      validate: (data: unknown) => validateData(schema, data),
    }),
  };
}

export const validation = createValidationFactory();
