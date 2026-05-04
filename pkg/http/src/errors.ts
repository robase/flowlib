/**
 * HTTP error classification.
 *
 * Adapters previously each implemented their own switch on error name + zod
 * detection. This helper centralises the mapping so all three return the
 * same JSON body and status code for the same input error.
 *
 * Adapter responsibilities still kept on the framework side:
 *   - actually writing the response (Express's `res.status().json()`,
 *     Web `Response.json()`, NestJS `HttpException`)
 *   - logging unexpected (5xx) errors however the host wants
 *
 * Recognised inputs:
 *   - `ZodError` from `zod` → 400 with per-issue details
 *   - any error with `name === 'ValidationError'` → 400
 *   - any error with `name === 'DatabaseError'` → 500
 *   - any error with a numeric `statusCode` (the `FlowlibError` shape) → that status
 *   - anything else → 500 generic
 */

import { ZodError } from 'zod';

export interface ClassifiedHttpError {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Map an arbitrary thrown value to a typed `{ status, body }` pair.
 *
 * Never throws — invalid inputs collapse to a generic 500.
 */
export function classifyHttpError(error: unknown): ClassifiedHttpError {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'Validation Error',
        message: 'Invalid request data',
        details: error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        })),
      },
    };
  }

  if (error && typeof error === 'object' && 'name' in error) {
    const e = error as Error & {
      field?: string;
      context?: Record<string, unknown>;
      details?: Record<string, unknown>;
    };

    if (e.name === 'ValidationError') {
      return {
        status: 400,
        body: {
          error: 'Validation Error',
          message: e.message || 'Validation failed',
          ...(e.field !== undefined ? { field: e.field } : {}),
          ...(e.context !== undefined ? { details: e.context } : {}),
        },
      };
    }

    if (e.name === 'DatabaseError') {
      return {
        status: 500,
        body: {
          error: 'Database Error',
          message: e.message || 'A database error occurred',
        },
      };
    }
  }

  // Errors that carry their own statusCode (FlowlibError subclasses).
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  ) {
    const statusCode = (error as { statusCode: number }).statusCode;
    const message = error instanceof Error ? error.message : 'An error occurred';
    const code =
      'code' in error && typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    return {
      status: statusCode,
      body: {
        error: statusCode < 500 ? 'Bad Request' : 'Internal Server Error',
        message,
        ...(code ? { code } : {}),
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    },
  };
}
