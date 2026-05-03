import type { NodeErrorDetails, NodeErrorCode } from '@flowlib/core/types';

/**
 * Small status pill that surfaces a classified node-execution failure.
 * Hovers expose provider status code, request ID, and attempt count when
 * available.
 */

interface Props {
  details: NodeErrorDetails;
  /** Optional label override; defaults to the pretty-printed code. */
  label?: string;
  className?: string;
}

const CODE_LABELS: Record<NodeErrorCode, string> = {
  RATE_LIMIT: 'Rate limit',
  AUTH: 'Auth',
  QUOTA: 'Quota',
  TIMEOUT: 'Timeout',
  CANCELLED: 'Cancelled',
  NETWORK: 'Network',
  UPSTREAM_5XX: 'Upstream 5xx',
  BAD_REQUEST: 'Bad request',
  NOT_FOUND: 'Not found',
  LENGTH_LIMIT: 'Length limit',
  CONTENT_FILTER: 'Content filter',
  SCHEMA_PARSE: 'Schema parse',
  VALIDATION: 'Validation',
  CREDENTIAL_MISSING: 'Credential missing',
  CREDENTIAL_REFRESH: 'Credential refresh',
  UNKNOWN: 'Error',
};

const CODE_COLORS: Record<NodeErrorCode, string> = {
  RATE_LIMIT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  AUTH: 'bg-red-500/15 text-red-400 border-red-500/30',
  QUOTA: 'bg-red-500/15 text-red-400 border-red-500/30',
  TIMEOUT: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  CANCELLED: 'bg-fl-muted text-fl-muted-foreground border-fl-border',
  NETWORK: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  UPSTREAM_5XX: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  BAD_REQUEST: 'bg-red-500/15 text-red-400 border-red-500/30',
  NOT_FOUND: 'bg-red-500/15 text-red-400 border-red-500/30',
  LENGTH_LIMIT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  CONTENT_FILTER: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  SCHEMA_PARSE: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  VALIDATION: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  CREDENTIAL_MISSING: 'bg-red-500/15 text-red-400 border-red-500/30',
  CREDENTIAL_REFRESH: 'bg-red-500/15 text-red-400 border-red-500/30',
  UNKNOWN: 'bg-fl-muted text-fl-muted-foreground border-fl-border',
};

export function NodeErrorBadge({ details, label, className }: Props) {
  const text = label ?? CODE_LABELS[details.code] ?? details.code;
  const color = CODE_COLORS[details.code] ?? CODE_COLORS.UNKNOWN;
  const tooltipLines: string[] = [details.message];
  if (details.providerStatusCode) {
    tooltipLines.push(`status ${details.providerStatusCode}`);
  }
  if (details.providerRequestId) {
    tooltipLines.push(`request ${details.providerRequestId}`);
  }
  if (typeof details.attempts === 'number' && details.attempts > 1) {
    tooltipLines.push(`${details.attempts} attempts`);
  }
  if (typeof details.retryAfterMs === 'number') {
    tooltipLines.push(`retry after ${Math.round(details.retryAfterMs / 1000)}s`);
  }

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        color,
        className ?? '',
      ].join(' ')}
      title={tooltipLines.join(' • ')}
    >
      {text}
    </span>
  );
}

export default NodeErrorBadge;
