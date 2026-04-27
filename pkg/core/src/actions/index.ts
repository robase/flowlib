/**
 * Actions Module – barrel export
 *
 * Public API for the Provider-Actions system.
 *
 * Integration provider actions (Gmail, Slack, GitHub, …) live in
 * `@flowlib/actions`. Core-runtime actions (Model, JavaScript, If/Else,
 * Switch, Template, HTTP, Triggers) stay here because they depend on
 * core's execution internals.
 */

// ── Types & helpers (re-exported from @flowlib/action-kit) ───────────────
export type {
  ActionDefinition,
  ActionExecutionContext,
  ActionResult,
  ActionCredential,
  ActionCategory,
  ProviderDef,
  ProviderCategory,
  CredentialRequirement,
  ParamField,
  ActionConfigUpdateContext,
  ActionConfigUpdateEvent,
  ActionConfigUpdateResponse,
  LoadOptionsContext,
  LoadOptionsConfig,
  LoadOptionsResult,
} from './types';

export { defineAction } from './define-action';

// ── Providers (from @flowlib/actions) ────────────────────────────────────
export {
  CORE_PROVIDER,
  HTTP_PROVIDER,
  GMAIL_PROVIDER,
  SLACK_PROVIDER,
  GITHUB_PROVIDER,
  GOOGLE_DOCS_PROVIDER,
  GOOGLE_SHEETS_PROVIDER,
  GOOGLE_DRIVE_PROVIDER,
  GOOGLE_CALENDAR_PROVIDER,
  LINEAR_PROVIDER,
  POSTGRES_PROVIDER,
  TRIGGERS_PROVIDER,
  MICROSOFT_PROVIDER,
  MICROSOFT_TEAMS_PROVIDER,
  SENTRY_PROVIDER,
  GRAFANA_PROVIDER,
  SALESFORCE_PROVIDER,
  HUBSPOT_PROVIDER,
  JIRA_PROVIDER,
  ASANA_PROVIDER,
  TRELLO_PROVIDER,
  DROPBOX_PROVIDER,
  ONEDRIVE_PROVIDER,
  STRIPE_PROVIDER,
  TWITTER_PROVIDER,
  LINKEDIN_PROVIDER,
  FACEBOOK_PROVIDER,
  SHOPIFY_PROVIDER,
  WOOCOMMERCE_PROVIDER,
  ZENDESK_PROVIDER,
  INTERCOM_PROVIDER,
  FRESHDESK_PROVIDER,
  SEGMENT_PROVIDER,
  MIXPANEL_PROVIDER,
  GOOGLE_ANALYTICS_PROVIDER,
  GITLAB_PROVIDER,
  RESEND_PROVIDER,
  SENDGRID_PROVIDER,
  NOTION_PROVIDER,
  CLOUDWATCH_PROVIDER,
  PAGERDUTY_PROVIDER,
} from './providers';

// ── Registry (from @flowlib/actions) ─────────────────────────────────────
export {
  ActionRegistry,
  getGlobalActionRegistry,
  initializeGlobalActionRegistry,
  setGlobalActionRegistry,
  resetGlobalActionRegistry,
} from './action-registry';

// ── Executor bridge (stays in core) ─────────────────────────────────────
export {
  executeActionAsNode,
  executeActionAsTool,
  createToolExecutorForAction,
} from './action-executor';

// ── Action bundles — from @flowlib/actions ───────────────────────────────
export {
  coreActions,
  asanaActions,
  cloudwatchActions,
  dropboxActions,
  facebookActions,
  freshdeskActions,
  githubActions,
  gitlabActions,
  gmailActions,
  googleAnalyticsActions,
  googleCalendarActions,
  googleDocsActions,
  googleDriveActions,
  googleSheetsActions,
  grafanaActions,
  httpActions,
  hubspotActions,
  intercomActions,
  jiraActions,
  linearActions,
  linkedinActions,
  microsoftActions,
  microsoftTeamsActions,
  mixpanelActions,
  notionActions,
  onedriveActions,
  pagerdutyActions,
  postgresActions,
  resendActions,
  salesforceActions,
  segmentActions,
  sendgridActions,
  sentryActions,
  shopifyActions,
  slackActions,
  stripeActions,
  trelloActions,
  triggerActions,
  twitterActions,
  woocommerceActions,
  zendeskActions,
} from '@flowlib/actions';

// ── Convenience: all built-in actions ───────────────────────────────────

import type { ActionDefinition } from './types';
import { allProviderActions } from '@flowlib/actions';

/** Every built-in action across all providers. */
export const allBuiltinActions: ActionDefinition[] = [...allProviderActions];

// ── Registration helper ─────────────────────────────────────────────────

import type { ActionRegistry } from './action-registry';

/**
 * Register all built-in actions into the given registry.
 * Called during `Invect.initialize()`.
 */
export function registerBuiltinActions(registry: ActionRegistry): void {
  registry.registerMany(allBuiltinActions);
}
