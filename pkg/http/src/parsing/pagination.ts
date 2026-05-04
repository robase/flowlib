/**
 * Pagination + sort parsing for the core `QueryOptions` shape.
 *
 * The core API accepts:
 *   `{ pagination?: { page; limit }, sort?: { sortBy; sortOrder } }`
 *
 * Each adapter previously inlined the same parsing logic against its own
 * query shape. This helper accepts a flat string-map (Express `req.query`
 * after `qs` parsing, or a `URLSearchParams` projected via the helpers
 * below) and applies the same defaults / clamps.
 */

export interface ParsedPagination {
  pagination?: { page: number; limit: number };
  sort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
}

export interface ParsePaginationOptions {
  /** Default page-size when only `page` is provided. Default `20`. */
  defaultLimit?: number;
  /** Cap on `limit`. Default `100`. */
  maxLimit?: number;
  /** Sort order to use when `sortBy` is set but `sortOrder` is not. Default `'desc'`. */
  defaultSortOrder?: 'asc' | 'desc';
}

/**
 * Parse pagination + sort from a flat query-record. Ignores keys that
 * aren't strings, applies sensible defaults, clamps `limit` to `maxLimit`.
 *
 * Returns an object with `pagination` and/or `sort` only when at least one
 * relevant key was present — callers can spread it into a wider
 * `QueryOptions` shape without overwriting unrelated fields.
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: ParsePaginationOptions = {},
): ParsedPagination {
  const { defaultLimit = 20, maxLimit = 100, defaultSortOrder = 'desc' } = options;

  const result: ParsedPagination = {};

  const pageRaw = query.page;
  const limitRaw = query.limit;
  const page = typeof pageRaw === 'string' ? parseInt(pageRaw, 10) : undefined;
  const limit = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : undefined;
  if (page || limit) {
    result.pagination = {
      page: page && page >= 1 ? page : 1,
      limit: limit && limit >= 1 ? Math.min(limit, maxLimit) : defaultLimit,
    };
  }

  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : undefined;
  const sortOrder =
    query.sortOrder === 'asc' || query.sortOrder === 'desc' ? query.sortOrder : undefined;
  if (sortBy) {
    result.sort = { sortBy, sortOrder: sortOrder ?? defaultSortOrder };
  }

  return result;
}

/**
 * Parse pagination + sort from a `URLSearchParams` instance (Next.js
 * app-router `request.nextUrl.searchParams`). Thin shim over
 * `parsePagination` for adapters that don't already have a flat object.
 */
export function parsePaginationFromSearchParams(
  searchParams: URLSearchParams,
  options: ParsePaginationOptions = {},
): ParsedPagination {
  return parsePagination(
    {
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
    },
    options,
  );
}

/**
 * Pick whichever query source is populated and parse it. Prefers
 * `rawQuery` (the host's already-parsed object — Express / Nest) over
 * `searchParams` (Next.js's URL-derived view) since the rawQuery preserves
 * any `qs`-specific decoding (arrays, nested objects).
 *
 * Endpoint definitions inside `@flowlib/http/endpoints` should use this
 * rather than the per-source variants — the endpoint is generic over the
 * host adapter, so the parsing helper has to be too.
 */
export function parsePaginationFromRequest(
  rawQuery: unknown,
  searchParams: URLSearchParams,
  options: ParsePaginationOptions = {},
): ParsedPagination {
  if (rawQuery && typeof rawQuery === 'object') {
    return parsePagination(rawQuery as Record<string, unknown>, options);
  }
  return parsePaginationFromSearchParams(searchParams, options);
}
