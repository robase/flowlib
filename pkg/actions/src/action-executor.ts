/**
 * Universal Action Executor
 *
 * Bridges the `ActionDefinition` system with the flow + agent execution paths.
 * Provides two entry points:
 *
 * - `executeActionAsNode()`  — called by the flow-run coordinator
 * - `executeActionAsTool()`  — called by the agent executor loop
 *
 * Both ultimately call the same `action.execute(params, context)` function.
 * The executor consumes the structural `NodeExecutionContext` exported by
 * `@flowlib/action-kit`, so it has no dependency on `@flowlib/core`.
 */

import {
  DEFAULT_RETRYABLE_ERROR_CODES,
  NodeExecutionStatus,
  classifyError,
  type ActionCredential,
  type ActionDefinition,
  type ActionExecutionContext,
  type ActionResult,
  type ActionRetryConfig,
  type AgentToolExecutionContext,
  type AgentToolResult,
  type NodeErrorDetails,
  type NodeExecutionContext,
  type NodeExecutionFailedResult,
  type NodeExecutionPendingResult,
  type NodeExecutionResult,
} from '@flowlib/action-kit';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Coerce JSON-encoded string params into real objects/arrays.
 *
 * The UI config panel stores JSON-type fields (like `defaultInputs`) as
 * stringified JSON from the code editor textarea.  Before Zod validation we
 * attempt to parse any string value that looks like a JSON array or object so
 * that the schema receives the expected types.
 *
 * Template expressions (containing `{{`) are left as-is.
 */
export function coerceJsonStringParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && !value.includes('{{')) {
      const trimmed = value.trim();
      if (trimmed === '') {
        result[key] = undefined;
        continue;
      }
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          result[key] = JSON.parse(trimmed);
          continue;
        } catch {
          // Not valid JSON — keep as string
        }
      }
    }
    result[key] = value;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// RETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function computeBackoff(
  cfg: ActionRetryConfig,
  attempt: number,
  retryAfterMs: number | undefined,
): number {
  const base = cfg.initialDelayMs ?? 500;
  const multiplier = cfg.backoffMultiplier ?? 2;
  const cap = cfg.maxDelayMs ?? 30_000;
  let delay = Math.min(base * Math.pow(multiplier, attempt - 1), cap);
  if (cfg.jitter !== false) {
    const jitter = delay * 0.25;
    delay = delay + (Math.random() * 2 - 1) * jitter;
  }
  // Honour a server-side Retry-After floor when the classifier captured one.
  if (typeof retryAfterMs === 'number' && retryAfterMs > delay) {
    delay = retryAfterMs;
  }
  return Math.max(0, Math.round(delay));
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw new Error('aborted');
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute an action as a flow node.
 *
 * Resolves credential, builds the shared context, runs `action.execute()`,
 * then wraps the ActionResult into a NodeExecutionResult.
 */
export async function executeActionAsNode(
  action: ActionDefinition,
  params: Record<string, unknown>,
  nodeContext: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const logger = nodeContext.logger;

  // Try the params as-is first — this preserves JSON-encoded strings for
  // actions whose schema expects a string (e.g. core.input.defaultValue).
  // Only fall back to JSON coercion when the raw shape fails validation,
  // which is what UI-stored JSON fields (e.g. triggers.manual.defaultInputs)
  // need.
  let parseResult = action.params.schema.safeParse(params);
  if (!parseResult.success) {
    const coercedParams = coerceJsonStringParams(params);
    const coercedResult = action.params.schema.safeParse(coercedParams);
    if (coercedResult.success) {
      parseResult = coercedResult;
    } else {
      const { prettifyError } = await import('zod/v4');

      const fieldErrors: Record<string, string> = {};
      for (const issue of coercedResult.error.issues) {
        if (issue.path && issue.path.length > 0) {
          const fieldName = String(issue.path[0]);
          fieldErrors[fieldName] = issue.message;
        }
      }

      const prettyMessage = prettifyError(coercedResult.error);
      return {
        state: NodeExecutionStatus.FAILED,
        errors: [prettyMessage],
        ...(Object.keys(fieldErrors).length > 0 && { fieldErrors }),
        errorDetails: {
          code: 'VALIDATION',
          message: prettyMessage,
          retryable: false,
          ...(Object.keys(fieldErrors).length > 0 && { fieldErrors }),
        },
      } satisfies NodeExecutionFailedResult;
    }
  }

  let credential: ActionCredential | null = null;
  const credentialId = params.credentialId as string | undefined;
  if (credentialId && nodeContext.functions.getCredential) {
    try {
      credential = await nodeContext.functions.getCredential(credentialId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to fetch credential for action', {
        actionId: action.id,
        credentialId,
        error: err,
      });
      const isRefresh =
        msg.toLowerCase().includes('refresh') || msg.toLowerCase().includes('token');
      return {
        state: NodeExecutionStatus.FAILED,
        errors: [`Failed to fetch credential: ${msg}`],
        errorDetails: {
          code: isRefresh ? 'CREDENTIAL_REFRESH' : 'AUTH',
          message: msg,
          retryable: false,
        },
      } satisfies NodeExecutionFailedResult;
    }
  }

  const context: ActionExecutionContext = {
    logger,
    credential,
    incomingData: nodeContext.incomingData,
    flowInputs: nodeContext.flowInputs as Record<string, unknown> | undefined,
    flowContext: {
      flowId: nodeContext.flowId,
      flowRunId: nodeContext.flowRunId,
      nodeId: nodeContext.nodeId,
      traceId: nodeContext.traceId,
    },
    functions: nodeContext.functions,
    flowRunState: {
      edges: nodeContext.edges,
      nodes: nodeContext.nodes,
      skippedNodeIds: nodeContext.skippedNodeIds,
      flowParams: nodeContext.flowParams,
      globalConfig: nodeContext.globalConfig,
    },
    abortSignal: nodeContext.abortSignal,
  };

  // ── Retry loop ─────────────────────────────────────────────────────────
  // Attempts >1 only apply when action.retry.maxAttempts > 1 and the failure
  // is classified as retryable. Batch submissions are skipped (they have
  // their own failure path; retrying risks duplicate batch jobs).
  const isBatchRequest = (params as { useBatchProcessing?: boolean }).useBatchProcessing === true;
  const retryCfg = isBatchRequest ? { maxAttempts: 1 } : (action.retry ?? {});
  const maxAttempts = clamp(retryCfg.maxAttempts ?? 1, 1, 5);
  const retryOn = retryCfg.retryOn ?? DEFAULT_RETRYABLE_ERROR_CODES;

  let result: ActionResult | undefined;
  let lastDetails: NodeErrorDetails | undefined;
  let lastThrownError: unknown;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    let thrown: unknown;
    try {
      result = await action.execute(parseResult.data, context);
      if (result.success) {
        break;
      }
      lastDetails =
        (result.metadata?.__errorDetails as NodeErrorDetails | undefined) ??
        classifyError(new Error(result.error ?? 'Action failed'));
    } catch (err) {
      thrown = err;
      lastThrownError = err;
      lastDetails = classifyError(err);
    }

    const shouldRetry =
      attempt < maxAttempts &&
      lastDetails?.retryable === true &&
      retryOn.includes(lastDetails.code) &&
      context.abortSignal?.aborted !== true;

    if (!shouldRetry) {
      if (thrown) {
        const msg = thrown instanceof Error ? thrown.message : String(thrown);
        logger.error('Action execution threw', { actionId: action.id, error: msg, attempts });
        return {
          state: NodeExecutionStatus.FAILED,
          errors: [msg],
          errorDetails: { ...(lastDetails ?? classifyError(thrown)), attempts },
        } satisfies NodeExecutionFailedResult;
      }
      if (result && !result.success) {
        return {
          state: NodeExecutionStatus.FAILED,
          errors: [result.error ?? 'Action failed without error message'],
          metadata: result.metadata,
          errorDetails: { ...(lastDetails as NodeErrorDetails), attempts },
        } satisfies NodeExecutionFailedResult;
      }
      break;
    }

    // Sleep before next attempt, honouring abort.
    const delay = computeBackoff(retryCfg, attempt, lastDetails?.retryAfterMs);
    logger.debug('Retrying action after classified failure', {
      actionId: action.id,
      attempt,
      maxAttempts,
      code: lastDetails?.code,
      delayMs: delay,
    });
    try {
      await abortableSleep(delay, context.abortSignal);
    } catch {
      // Aborted during backoff — bail out.
      return {
        state: NodeExecutionStatus.FAILED,
        errors: [lastDetails?.message ?? 'Cancelled during retry backoff'],
        errorDetails: {
          code: 'CANCELLED',
          message: 'Cancelled during retry backoff',
          retryable: false,
          attempts,
        },
      } satisfies NodeExecutionFailedResult;
    }

    // Increment the persisted retry count so the UI / metrics see progress.
    if (nodeContext.traceId) {
      try {
        await nodeContext.functions.incrementRetryCount?.(nodeContext.traceId);
      } catch (bumpErr) {
        logger.debug('Failed to increment retry count (non-fatal)', {
          traceId: nodeContext.traceId,
          error: bumpErr instanceof Error ? bumpErr.message : String(bumpErr),
        });
      }
    }
  }

  if (!result) {
    // The throw path short-circuits above; defensive fallback.
    const details = lastDetails ?? classifyError(lastThrownError);
    return {
      state: NodeExecutionStatus.FAILED,
      errors: [details.message],
      errorDetails: { ...details, attempts },
    } satisfies NodeExecutionFailedResult;
  }

  if (!result.success) {
    // Retries exhausted without success.
    const details: NodeErrorDetails =
      (result.metadata?.__errorDetails as NodeErrorDetails | undefined) ??
      lastDetails ??
      classifyError(new Error(result.error ?? 'Action failed'));
    return {
      state: NodeExecutionStatus.FAILED,
      errors: [result.error ?? 'Action failed without error message'],
      metadata: result.metadata,
      errorDetails: { ...details, attempts },
    } satisfies NodeExecutionFailedResult;
  }

  if (attempts > 1) {
    // Annotate success with attempt count for observability.
    result.metadata = { ...result.metadata, __attempts: attempts };
  }

  if (result.metadata?.__batchSubmitted === true) {
    return {
      state: NodeExecutionStatus.PENDING,
      type: 'batch_submitted' as const,
      batchJobId: String(result.metadata.batchJobId ?? ''),
      nodeId: String(result.metadata.nodeId ?? nodeContext.nodeId),
      executionId: String(result.metadata.flowRunId ?? nodeContext.flowRunId),
    } satisfies NodeExecutionPendingResult;
  }

  const variables = result.outputVariables
    ? result.outputVariables
    : {
        output: {
          value: result.output,
          type: (result.output !== null &&
          result.output !== undefined &&
          typeof result.output === 'object'
            ? 'object'
            : 'string') as 'string' | 'object',
        },
      };

  return {
    state: NodeExecutionStatus.SUCCESS,
    type: 'output' as const,
    output: {
      nodeType: action.id,
      data: {
        variables,
        metadata: result.metadata,
      },
    },
  } satisfies NodeExecutionResult;
}

/**
 * Execute an action as an AI-agent tool.
 *
 * Called by the agent executor loop. Merges static params with AI-provided
 * input, resolves credential, builds the shared context, runs
 * `action.execute()`, then returns an `AgentToolResult`.
 */
export async function executeActionAsTool(
  action: ActionDefinition,
  input: Record<string, unknown>,
  toolContext: AgentToolExecutionContext<NodeExecutionContext>,
): Promise<AgentToolResult> {
  const logger = toolContext.logger;

  const mergedParams = {
    ...input,
    ...toolContext.staticParams,
  };

  const parseResult = action.params.schema.safeParse(mergedParams);
  if (!parseResult.success) {
    const { prettifyError } = await import('zod/v4');
    return {
      success: false,
      error: `Invalid params: ${prettifyError(parseResult.error)}`,
    };
  }

  let credential: ActionCredential | null = null;
  const credentialId =
    (toolContext.staticParams?.credentialId as string | undefined) ??
    (input.credentialId as string | undefined);

  if (credentialId && toolContext.nodeContext.functions.getCredential) {
    try {
      credential = await toolContext.nodeContext.functions.getCredential(credentialId);
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch credential: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const context: ActionExecutionContext = {
    logger,
    credential,
    incomingData: toolContext.nodeContext.incomingData,
    flowContext: {
      flowId: toolContext.nodeContext.flowId,
      flowRunId: toolContext.nodeContext.flowRunId,
      nodeId: toolContext.nodeContext.nodeId,
      traceId: toolContext.nodeContext.traceId,
    },
    abortSignal: toolContext.abortSignal,
  };

  try {
    const result = await action.execute(parseResult.data, context);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Action tool execution threw', { actionId: action.id, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Create an `AgentToolExecutor` function for a given action.
 */
export function createToolExecutorForAction(
  action: ActionDefinition,
): (
  input: Record<string, unknown>,
  context: AgentToolExecutionContext<NodeExecutionContext>,
) => Promise<AgentToolResult> {
  return (input, context) => executeActionAsTool(action, input, context);
}
