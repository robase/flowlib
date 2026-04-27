/**
 * Unit tests: FlowOrchestrationService — PR 5/14 maintenance methods.
 *
 * The new `detectStaleRuns()` and `pollBatchJobs()` methods are the
 * single-tick external-scheduler entry points that wrap the existing
 * `runStaleRunSweep()` and `runBatchResumptionSweep()` logic but expose
 * a uniform `{ count }` shape on `flowlib.maintenance.*`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestrationService } from 'src/services/flow-orchestration.service';
import type { FlowRunsService } from 'src/services/flow-runs/flow-runs.service';
import type { Logger } from 'src/schemas';

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Build an orchestration service with the minimum dependencies needed to
 * exercise stale-run detection. Most collaborators are stubbed because
 * `detectStaleRuns()` only delegates to `flowRunsService.failStaleRuns()`.
 */
function makeService(failStaleRunsImpl: () => Promise<number>): FlowOrchestrationService {
  const flowRunsService = {
    failStaleRuns: vi.fn(failStaleRunsImpl),
  } as unknown as FlowRunsService;

  const baseAIClient = {
    // Required-by-constructor sentinel; never invoked by these tests.
    pollPendingBatches: vi.fn(),
  } as unknown as ConstructorParameters<typeof FlowOrchestrationService>[8];

  return new FlowOrchestrationService(
    mockLogger(),
    flowRunsService,
    {} as never, // nodeExecutionService
    {} as never, // flowsService
    {} as never, // nodeDataService
    {} as never, // graphService
    {} as never, // batchJobsService
    undefined, // credentialsService
    baseAIClient,
    undefined, // nodeExecutionServiceForTools
    {
      flowTimeoutMs: 60_000,
      // externalScheduler ensures we don't fire real setInterval timers
      // during the test (no in-process maintenance loops are started here
      // because `initialize()` isn't called either, but this also documents
      // the intent).
      externalScheduler: true,
    },
  );
}

describe('FlowOrchestrationService.detectStaleRuns() (PR 5/14)', () => {
  let service: FlowOrchestrationService;

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns the count of stale runs marked FAILED by the underlying sweep', async () => {
    service = makeService(async () => 3);
    const result = await service.detectStaleRuns();
    expect(result).toEqual({ count: 3 });
  });

  it('returns { count: 0 } when no runs are stale', async () => {
    service = makeService(async () => 0);
    const result = await service.detectStaleRuns();
    expect(result).toEqual({ count: 0 });
  });

  it('propagates errors from failStaleRuns()', async () => {
    service = makeService(async () => {
      throw new Error('database down');
    });
    await expect(service.detectStaleRuns()).rejects.toThrow('database down');
  });
});
