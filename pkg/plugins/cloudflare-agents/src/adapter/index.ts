import type { DurabilityAdapter, StepOptions } from '@flowlib/primitives';
import { WaitTimeoutError } from '@flowlib/primitives';

// Cloudflare Workflows step interface (matches WorkflowStep from cloudflare:workers)
interface CFWorkflowStep {
  do<T>(name: string, fn: () => Promise<T>, options?: CFStepOptions): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;
  waitForEvent<T>(name: string, options?: { timeout?: string }): Promise<T>;
}

interface CFStepOptions {
  retries?: {
    limit: number;
    delay?: string | number;
    backoff?: 'constant' | 'linear' | 'exponential';
  };
  timeout?: string | number;
}

export class CloudflareAdapter implements DurabilityAdapter {
  private readonly cfStep: CFWorkflowStep;

  constructor(cfStep: CFWorkflowStep) {
    this.cfStep = cfStep;
  }

  async step<T>(name: string, fn: () => Promise<T>, options?: StepOptions): Promise<T> {
    const cfOptions: CFStepOptions = {};

    if (options?.retries) {
      cfOptions.retries = {
        limit: options.retries.maxAttempts,
        backoff: options.retries.backoff === 'exponential' ? 'exponential' : 'constant',
      };
    }

    if (options?.timeout) {
      cfOptions.timeout = options.timeout;
    }

    return this.cfStep.do(name, fn, Object.keys(cfOptions).length > 0 ? cfOptions : undefined);
  }

  async sleep(duration: string | number): Promise<void> {
    await this.cfStep.sleep(`sleep:${duration}`, duration);
  }

  async waitForEvent<T>(name: string, options?: { timeout?: string }): Promise<T> {
    try {
      return await this.cfStep.waitForEvent<T>(name, options);
    } catch (err) {
      // Translate CF WorkflowTimeoutError → WaitTimeoutError
      if (
        err instanceof Error &&
        (err.constructor.name === 'WorkflowTimeoutError' || err.message.includes('timed out'))
      ) {
        throw new WaitTimeoutError(name);
      }
      throw err;
    }
  }

  subscribe<T>(name: string): AsyncIterable<T> {
    throw new Error(
      `CloudflareAdapter.subscribe("${name}") is not supported. ` +
        `CF Workflows does not natively support multi-event subscriptions. ` +
        `Use waitForEvent() in a loop or model this as multiple nodes.`,
    );
  }
}

export { WaitTimeoutError };
