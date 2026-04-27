/**
 * `@flowlib/actions` — built-in integration provider actions for Flowlib.
 *
 * Exports per-provider action bundles plus a convenience `allProviderActions`
 * array for bulk registration. Includes integration providers (Gmail, Slack,
 * GitHub, …) plus the runtime primitive bundles (`http`, `triggers`).
 * Core primitive actions (`core/`) live alongside in this package; they
 * stay decoupled from `@flowlib/core` via the structural seams in
 * `@flowlib/action-kit`.
 */

import type { ActionDefinition, LazyActionDefinition } from '@flowlib/action-kit';

// ── Shared ──────────────────────────────────────────────────────────────

export * from './providers';
export {
  ActionRegistry,
  getGlobalActionRegistry,
  initializeGlobalActionRegistry,
  setGlobalActionRegistry,
  resetGlobalActionRegistry,
  actionToNodeDefinition,
} from './registry';

export {
  executeActionAsNode,
  executeActionAsTool,
  createToolExecutorForAction,
  coerceJsonStringParams,
} from './action-executor';

// ── Provider bundles ────────────────────────────────────────────────────

export {
  coreActions,
  javascriptAction,
  inputAction,
  templateStringAction,
  outputAction,
  ifElseAction,
  switchAction,
  modelAction,
  agentAction,
  agentNodeParamsSchema,
  type AgentNodeParams,
} from './core';

export { asanaActions } from './asana';
export { cloudwatchActions } from './cloudwatch';
export { dropboxActions } from './dropbox';
export { facebookActions } from './facebook';
export { freshdeskActions } from './freshdesk';
export { githubActions } from './github';
export { gitlabActions } from './gitlab';
export { gmailActions } from './gmail';
export { httpActions, httpRequestAction } from './http';
export { googleAnalyticsActions } from './google-analytics';
export { googleCalendarActions } from './google-calendar';
export { googleDocsActions } from './google-docs';
export { googleDriveActions } from './google-drive';
export { googleSheetsActions } from './google-sheets';
export { grafanaActions } from './grafana';
export { hubspotActions } from './hubspot';
export { intercomActions } from './intercom';
export { jiraActions } from './jira';
export { linearActions } from './linear';
export { linkedinActions } from './linkedin';
export { microsoftActions } from './microsoft';
export { microsoftTeamsActions } from './microsoft-teams';
export { mixpanelActions } from './mixpanel';
export { notionActions } from './notion';
export { onedriveActions } from './onedrive';
export { pagerdutyActions } from './pagerduty';
export { postgresActions } from './postgres';
export { resendActions } from './resend';
export { salesforceActions } from './salesforce';
export { segmentActions } from './segment';
export { sendgridActions } from './sendgrid';
export { sentryActions } from './sentry';
export { shopifyActions } from './shopify';
export { slackActions } from './slack';
export { stripeActions } from './stripe';
export { trelloActions } from './trello';
export { triggerActions, manualTriggerAction, cronTriggerAction } from './triggers';
export { twitterActions } from './twitter';
export { woocommerceActions } from './woocommerce';
export { zendeskActions } from './zendesk';

// ── Convenience: all provider actions ───────────────────────────────────

import { coreActions } from './core';
import { asanaActions } from './asana';
import { cloudwatchActions } from './cloudwatch';
import { dropboxActions } from './dropbox';
import { facebookActions } from './facebook';
import { freshdeskActions } from './freshdesk';
import { githubActions } from './github';
import { gitlabActions } from './gitlab';
import { gmailActions } from './gmail';
import { httpActions } from './http';
import { googleAnalyticsActions } from './google-analytics';
import { googleCalendarActions } from './google-calendar';
import { googleDocsActions } from './google-docs';
import { googleDriveActions } from './google-drive';
import { googleSheetsActions } from './google-sheets';
import { grafanaActions } from './grafana';
import { hubspotActions } from './hubspot';
import { intercomActions } from './intercom';
import { jiraActions } from './jira';
import { linearActions } from './linear';
import { linkedinActions } from './linkedin';
import { microsoftActions } from './microsoft';
import { microsoftTeamsActions } from './microsoft-teams';
import { mixpanelActions } from './mixpanel';
import { notionActions } from './notion';
import { onedriveActions } from './onedrive';
import { pagerdutyActions } from './pagerduty';
import { postgresActions } from './postgres';
import { resendActions } from './resend';
import { salesforceActions } from './salesforce';
import { segmentActions } from './segment';
import { sendgridActions } from './sendgrid';
import { sentryActions } from './sentry';
import { shopifyActions } from './shopify';
import { slackActions } from './slack';
import { stripeActions } from './stripe';
import { trelloActions } from './trello';
import { triggerActions } from './triggers';
import { twitterActions } from './twitter';
import { woocommerceActions } from './woocommerce';
import { zendeskActions } from './zendesk';

// ── Lazy provider bundles (edge-runtime bundle size) ───────────────────
//
// Mirrors the eager provider bundles above, but each entry is a
// `LazyActionDefinition` with a `load()` thunk. Use these in edge bundles
// (Cloudflare Workers, Vercel Workflows) so 40+ provider SDKs aren't pulled
// into the cold-start. The eager bundles still exist for self-hosted
// backwards compatibility.
//
// Only 5 representative providers are migrated in this PR; remaining
// providers are tracked in `LAZY_ACTIONS_MIGRATION.md`.

export { lazyCoreActions } from './core/lazy';
export { lazyGmailActions } from './gmail/lazy';
export { lazySlackActions } from './slack/lazy';
export { lazyGithubActions } from './github/lazy';
export { lazyHttpActions } from './http/lazy';

import { lazyCoreActions } from './core/lazy';
import { lazyGmailActions } from './gmail/lazy';
import { lazySlackActions } from './slack/lazy';
import { lazyGithubActions } from './github/lazy';
import { lazyHttpActions } from './http/lazy';

/**
 * Lazy descriptors for every provider that has been migrated to the lazy
 * loading pattern. Provider modules are only imported when the action is
 * resolved (via {@link ActionRegistry.loadAction} or
 * {@link ActionRegistry.executeAction}).
 *
 * Currently migrated: `core`, `gmail`, `slack`, `github`, `http`. Remaining
 * providers fall back to the eager bundles in {@link allProviderActions} —
 * see `LAZY_ACTIONS_MIGRATION.md` for the full list.
 */
export const allProviderActionsLazy: LazyActionDefinition[] = [
  ...lazyCoreActions,
  ...lazyHttpActions,
  ...lazyGithubActions,
  ...lazyGmailActions,
  ...lazySlackActions,
];

/** Every provider action bundled in `@flowlib/actions`. */
export const allProviderActions: ActionDefinition[] = [
  ...coreActions,
  ...asanaActions,
  ...cloudwatchActions,
  ...dropboxActions,
  ...facebookActions,
  ...freshdeskActions,
  ...githubActions,
  ...gitlabActions,
  ...gmailActions,
  ...httpActions,
  ...googleAnalyticsActions,
  ...googleCalendarActions,
  ...googleDocsActions,
  ...googleDriveActions,
  ...googleSheetsActions,
  ...grafanaActions,
  ...hubspotActions,
  ...intercomActions,
  ...jiraActions,
  ...linearActions,
  ...linkedinActions,
  ...microsoftActions,
  ...microsoftTeamsActions,
  ...mixpanelActions,
  ...notionActions,
  ...onedriveActions,
  ...pagerdutyActions,
  ...postgresActions,
  ...resendActions,
  ...salesforceActions,
  ...segmentActions,
  ...sendgridActions,
  ...sentryActions,
  ...shopifyActions,
  ...slackActions,
  ...stripeActions,
  ...trelloActions,
  ...triggerActions,
  ...twitterActions,
  ...woocommerceActions,
  ...zendeskActions,
];
