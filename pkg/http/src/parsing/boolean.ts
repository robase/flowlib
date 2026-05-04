/**
 * Boolean query-parameter parser.
 *
 * `?flag=true` → `true`
 * `?flag=false` → `false`
 * missing / unparseable → `undefined`
 *
 * Accepts the same shapes as `coerceSingleQueryValue` (string, string array,
 * `URLSearchParams.get` return value).
 */
export function parseBooleanQueryParam(value: unknown): boolean | undefined {
  const normalized = Array.isArray(value) ? value[value.length - 1] : value;
  if (normalized === null || normalized === undefined) {
    return undefined;
  }
  if (typeof normalized !== 'string') {
    return undefined;
  }
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return undefined;
}
