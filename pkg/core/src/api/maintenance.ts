/**
 * Maintenance API — single-tick entry points for the lifecycle loops that
 * `@flowlib/core` would otherwise drive with in-process `setInterval`s.
 *
 * Edge runtimes can't run timers between requests, so each periodic loop is
 * exposed here as an idempotent method that performs exactly one tick. A
 * Cloudflare Cron Trigger / Vercel Cron Job invokes these from its own
 * scheduler:
 *
 *   await flowlib.maintenance.detectStaleRuns();          // every 1–5 min
 *   await flowlib.maintenance.pollBatchJobs();            // every 1 min
 *   await flowlib.maintenance.pollPendingBatches();       // every 1 min
 *   await flowlib.maintenance.evictExpiredChatSessions(); // every 5 min
 *   await flowlib.maintenance.cleanupExpiredOAuthStates();// every 5 min
 *
 * Long-lived Node processes don't need to call any of these — the existing
 * `start*Polling` lifecycle methods continue to drive them via timers. When
 * a host wires a `BatchPollerAdapter` override into `FlowlibConfig.services`,
 * the in-process timers in `FlowOrchestrationService` are skipped
 * automatically and these methods become the only way maintenance work runs.
 */

import type { ServiceFactory } from '../services/service-factory';
import type { MaintenanceAPI } from './types';

export function createMaintenanceAPI(sf: ServiceFactory): MaintenanceAPI {
  return {
    detectStaleRuns() {
      return sf.getOrchestrationService().detectStaleRuns();
    },

    pollBatchJobs() {
      return sf.getOrchestrationService().pollBatchJobs();
    },

    pollPendingBatches() {
      return sf.getBaseAIClient().pollPendingBatches();
    },

    async evictExpiredChatSessions() {
      // ChatStreamService holds the only ActiveChatSessions instance;
      // delegate to it. Returns a promise so the API is uniform across
      // sync/async backing implementations (a future ChatSessionStore
      // override would be inherently async).
      return sf.getChatStreamService().evictExpiredSessions();
    },

    async cleanupExpiredOAuthStates() {
      return sf.getCredentialsService().getOAuth2Service().cleanupExpiredStates();
    },
  };
}
