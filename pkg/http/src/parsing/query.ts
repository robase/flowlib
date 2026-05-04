/**
 * Transport-neutral query parsing helpers.
 *
 * These exist because Express, NestJS, and Next.js all surface query strings
 * differently:
 *   - Express's `req.query` is a `Record<string, string | string[] | ParsedQs>`
 *     where repeated keys arrive as arrays.
 *   - NestJS sits on top of Express, same shape.
 *   - Next.js app-router handlers receive `URLSearchParams` (single string per
 *     `.get(key)` call by default; `.getAll(key)` for arrays).
 *
 * We don't try to unify those at the transport level — the helpers here accept
 * any of those shapes and produce typed JS values.
 */

/**
 * Decode a `params=<json>`-style query parameter into an object.
 *
 * Handles the three shapes adapters surface:
 *   - `string` (Next.js `searchParams.get('params')`, single Express value)
 *   - `string[]` (Express repeated key — last entry wins)
 *   - `Record<string, unknown>` (Express's `qs`-parsed nested object form)
 *
 * Returns `{}` when the value is missing or unparseable. Never throws.
 */
export function parseJsonQueryParam(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === '') {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    if (typeof last === 'string') {
      try {
        const parsed = JSON.parse(last);
        return isPlainObject(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  if (isPlainObject(value)) {
    // Express's `qs` parser produces nested objects; flatten array-valued
    // entries to their last element so per-call semantics match the string
    // path above.
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = Array.isArray(entry) ? entry[entry.length - 1] : entry;
      return acc;
    }, {});
  }

  return {};
}

/**
 * Coerce a possibly-array query value to a single value (last entry wins) or
 * `undefined` when missing. Mirrors how Express's `qs` parser handles
 * repeated keys.
 */
export function coerceSingleQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value ?? undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
