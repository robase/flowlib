import anthropic from './anthropic.svg?raw';
import anthropicLight from './anthropic_light.svg?raw';
import { FLOWLIB_ICON_DARK_SVG, FLOWLIB_ICON_LIGHT_SVG } from '../flowlib-branding';
import cloudwatch from './cloudwatch.svg?raw';
import dropbox from './dropbox.svg?raw';
import facebook from './facebook.svg?raw';
import github from './github.svg?raw';
import githubLight from './github_light.svg?raw';
import gmail from './gmail.svg?raw';
import googleAnalytics from './google_analytics.svg?raw';
import googleCalendar from './google_calendar.svg?raw';
import googleDocs from './google_docs.svg?raw';
import googleDrive from './google_drive.svg?raw';
import googleSheets from './google_sheets.svg?raw';
import jira from './jira.svg?raw';
import linear from './linear.svg?raw';
import microsoftTeams from './microsoft_teams.svg?raw';
import openai from './openai.svg?raw';
import postgres from './postgres.svg?raw';
import salesforce from './salesforce.svg?raw';
import shopify from './shopify.svg?raw';
import slack from './slack.svg?raw';
import trello from './trello.svg?raw';
import twitter from './twitter.svg?raw';

/**
 * Inline SVG strings for built-in provider icons.
 *
 * SVGs are stored as files in this directory and imported with Vite's `?raw`
 * loader so the runtime API remains a plain `Record<string, string>`.
 */
export const PROVIDER_SVG_ICONS: Record<string, string> = {
  anthropic,
  anthropic_light: anthropicLight,
  core: FLOWLIB_ICON_LIGHT_SVG,
  core_light: FLOWLIB_ICON_DARK_SVG,
  cloudwatch,
  dropbox,
  facebook,
  github,
  github_light: githubLight,
  gmail,
  google_analytics: googleAnalytics,
  google_calendar: googleCalendar,
  google_docs: googleDocs,
  google_drive: googleDrive,
  google_sheets: googleSheets,
  jira,
  linear,
  microsoft_teams: microsoftTeams,
  openai,
  postgres,
  salesforce,
  shopify,
  slack,
  trello,
  twitter,
};
