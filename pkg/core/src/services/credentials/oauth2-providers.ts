/**
 * OAuth2 Provider Definitions
 *
 * Registry of OAuth2 providers with their configuration.
 * Each provider defines the URLs, scopes, and parameters needed for OAuth2 flow.
 *
 * Scopes and configurations verified against FlowiseAI/Flowise repository:
 * https://github.com/FlowiseAI/Flowise/tree/main/packages/components/credentials
 */

export interface OAuth2ProviderDefinition {
  /** Unique provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this provider is for */
  description: string;
  /** Icon name (lucide icon) */
  icon?: string;
  /** OAuth2 authorization endpoint */
  authorizationUrl: string;
  /** OAuth2 token endpoint */
  tokenUrl: string;
  /** Default scopes for this provider */
  defaultScopes: string[];
  /** Additional query parameters for authorization request */
  additionalAuthParams?: Record<string, string>;
  /** Whether this provider supports refresh tokens */
  supportsRefresh: boolean;
  /** Separator for scopes in the authorization URL (default: " "). Linear uses ",". */
  scopeSeparator?: string;
  /** Documentation URL for setup instructions */
  docsUrl?: string;
  /** Category for grouping in UI - based on product function, not company */
  category:
    | 'productivity' // Docs, spreadsheets, office suites
    | 'storage' // Cloud file storage and sync
    | 'communication' // Email, messaging, video conferencing
    | 'development' // Code repos, version control, CI/CD
    | 'project_management' // Task tracking, issue tracking, project tools
    | 'crm_sales' // Customer relationship management, sales pipelines
    | 'marketing' // Email marketing, social media, analytics
    | 'payments' // Payment processing, billing
    | 'support' // Customer support, helpdesk, ticketing
    | 'design' // Design tools, creative software
    | 'other';
}

/**
 * Built-in OAuth2 provider definitions
 * Verified against FlowiseAI credential definitions
 */
export const OAUTH2_PROVIDERS: Record<string, OAuth2ProviderDefinition> = {
  // =============================================================================
  // GOOGLE
  // =============================================================================

  // Unified Google OAuth2 provider — scopes cover Gmail, Drive, Docs, Sheets, Calendar.
  // A single Google credential works across all Google API actions.
  google: {
    id: 'google',
    name: 'Google',
    description: 'Access Google APIs — Gmail, Drive, Docs, Sheets, Calendar, and more',
    icon: 'Globe',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    defaultScopes: [
      // Gmail
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels',
      // Drive (covers Docs file access too)
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.metadata',
      // Docs
      'https://www.googleapis.com/auth/documents',
      // Sheets
      'https://www.googleapis.com/auth/spreadsheets',
      // Calendar
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      // Analytics
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/analytics',
    ],
    additionalAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
    supportsRefresh: true,
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2',
    category: 'productivity',
  },

  // =============================================================================
  // MICROSOFT
  // =============================================================================

  // Unified Microsoft OAuth2 provider — scopes cover Outlook, Teams, OneDrive, Calendar.
  // A single Microsoft credential works across all Microsoft Graph API actions.
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    description:
      'Access Microsoft 365 services via Graph API — Outlook, Teams, OneDrive, Calendar, and more',
    icon: 'Cloud',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    defaultScopes: [
      // Core
      'openid',
      'profile',
      'email',
      'offline_access',
      'User.Read',
      // Calendar
      'Calendars.Read',
      'Calendars.Read.Shared',
      'Calendars.ReadWrite',
      // Mail / Outlook
      'Mail.Read',
      'Mail.ReadBasic',
      'Mail.ReadWrite',
      'Mail.ReadWrite.Shared',
      'Mail.Send',
      'Mail.Send.Shared',
      'MailboxSettings.Read',
      'Contacts.Read',
      'Contacts.ReadWrite',
      // Meetings
      'OnlineMeetings.Read',
      'OnlineMeetingTranscript.Read.All',
      // Teams & Groups
      'Group.ReadWrite.All',
      'Team.ReadBasic.All',
      'Team.Create',
      'TeamMember.ReadWrite.All',
      'Channel.ReadBasic.All',
      'Channel.Create',
      'Channel.Delete.All',
      'ChannelMember.ReadWrite.All',
      'Chat.ReadWrite',
      'Chat.Create',
      'ChatMember.ReadWrite',
      'ChatMessage.Send',
      'ChatMessage.Read',
      'ChannelMessage.Send',
      'ChannelMessage.Read.All',
      'TeamsActivity.Send',
      // OneDrive / Files
      'Files.Read',
      'Files.Read.All',
      'Files.ReadWrite',
      'Files.ReadWrite.All',
    ],
    supportsRefresh: true,
    docsUrl:
      'https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow',
    category: 'productivity',
  },

  // =============================================================================
  // DEVELOPMENT
  // =============================================================================

  // GitHub - Verified from FlowiseAI (uses API tokens, not full OAuth2 in Flowise)
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Access GitHub repositories and issues',
    icon: 'Github',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    defaultScopes: ['repo', 'read:user', 'user:email'],
    supportsRefresh: false, // GitHub tokens don't expire by default
    docsUrl: 'https://docs.github.com/en/apps/oauth-apps',
    category: 'development',
  },

  // =============================================================================
  // COMMUNICATION
  // =============================================================================

  // Slack - Based on FlowiseAI SlackApi.credential.ts (uses bot tokens)
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Access Slack for messaging and channel operations',
    icon: 'MessageSquare',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    defaultScopes: [
      'channels:read',
      'channels:write',
      'chat:write',
      'users:read',
      'im:read',
      'im:write',
      'groups:read',
    ],
    supportsRefresh: true,
    docsUrl: 'https://api.slack.com/authentication/oauth-v2',
    category: 'communication',
  },

  // =============================================================================
  // PROJECT MANAGEMENT
  // =============================================================================

  // Jira (Atlassian Cloud) - Verified from FlowiseAI JiraApi.credential.ts
  jira: {
    id: 'jira',
    name: 'Jira',
    description: 'Access Jira for issue tracking and project management',
    icon: 'Bug',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    defaultScopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    additionalAuthParams: {
      audience: 'api.atlassian.com',
      prompt: 'consent',
    },
    supportsRefresh: true,
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
    category: 'project_management',
  },

  // Confluence Cloud - Based on FlowiseAI ConfluenceCloudApi.credential.ts
  confluence: {
    id: 'confluence',
    name: 'Confluence',
    description: 'Access Confluence for documentation and wiki pages',
    icon: 'BookOpen',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    defaultScopes: [
      'read:confluence-content.all',
      'read:confluence-space.summary',
      'write:confluence-content',
      'offline_access',
    ],
    additionalAuthParams: {
      audience: 'api.atlassian.com',
      prompt: 'consent',
    },
    supportsRefresh: true,
    docsUrl: 'https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/',
    category: 'productivity',
  },

  // =============================================================================
  // OTHER PROVIDERS
  // =============================================================================

  // Notion - Verified (Notion uses internal OAuth, no traditional scopes)
  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Access Notion workspaces and pages',
    icon: 'FileText',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    defaultScopes: [], // Notion doesn't use scopes, permissions are set during integration setup
    additionalAuthParams: {
      owner: 'user',
    },
    supportsRefresh: false,
    docsUrl: 'https://developers.notion.com/docs/authorization',
    category: 'productivity',
  },

  // Linear - Verified
  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Access Linear for issue tracking and project management',
    icon: 'CheckSquare',
    authorizationUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    // `admin` is required by Linear for managing webhooks (`webhookCreate`,
    // `webhookUpdate`, `webhookDelete`). The webhook-management UI in
    // `@flowlib/webhooks` won't work without it. Other Linear actions only
    // need `read`/`write` — `admin` is a strict superset.
    defaultScopes: ['read', 'write', 'admin', 'issues:create', 'comments:create'],
    scopeSeparator: ',',
    supportsRefresh: true,
    docsUrl: 'https://linear.app/developers/oauth-2-0-authentication',
    category: 'project_management',
  },

  // Airtable - Verified
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    description: 'Access Airtable bases and records',
    icon: 'Table',
    authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    defaultScopes: [
      'data.records:read',
      'data.records:write',
      'schema.bases:read',
      'schema.bases:write',
    ],
    supportsRefresh: true,
    docsUrl: 'https://airtable.com/developers/web/api/oauth-reference',
    category: 'productivity',
  },

  // Figma - Based on FlowiseAI FigmaApi.credential.ts
  figma: {
    id: 'figma',
    name: 'Figma',
    description: 'Access Figma for design files and collaboration',
    icon: 'Figma',
    authorizationUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://www.figma.com/api/oauth/token',
    defaultScopes: ['files:read', 'file_comments:write'],
    supportsRefresh: true,
    docsUrl: 'https://www.figma.com/developers/api#authentication',
    category: 'design',
  },

  // Dropbox
  dropbox: {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Access Dropbox for file storage and sharing',
    icon: 'Cloud',
    authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    defaultScopes: [
      'account_info.read',
      'files.content.read',
      'files.content.write',
      'files.metadata.read',
      'files.metadata.write',
    ],
    additionalAuthParams: {
      token_access_type: 'offline',
    },
    supportsRefresh: true,
    docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
    category: 'storage',
  },

  // HubSpot
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Access HubSpot CRM for contacts, deals, and marketing',
    icon: 'Users',
    authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    defaultScopes: [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
    ],
    supportsRefresh: true,
    docsUrl: 'https://developers.hubspot.com/docs/api/oauth-quickstart-guide',
    category: 'crm_sales',
  },

  // Salesforce
  salesforce: {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Access Salesforce CRM for sales and customer data',
    icon: 'Cloud',
    authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    defaultScopes: ['api', 'refresh_token', 'offline_access'],
    supportsRefresh: true,
    docsUrl:
      'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_oauth_and_connected_apps.htm',
    category: 'crm_sales',
  },

  // Asana
  asana: {
    id: 'asana',
    name: 'Asana',
    description: 'Access Asana for task and project management',
    icon: 'CheckSquare',
    authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    defaultScopes: ['default'], // Asana uses 'default' scope for full access
    supportsRefresh: true,
    docsUrl: 'https://developers.asana.com/docs/oauth',
    category: 'project_management',
  },

  // Trello
  trello: {
    id: 'trello',
    name: 'Trello',
    description: 'Access Trello boards, cards, and lists',
    icon: 'Layout',
    authorizationUrl: 'https://trello.com/1/authorize',
    tokenUrl: 'https://trello.com/1/OAuthGetAccessToken',
    defaultScopes: ['read', 'write'],
    additionalAuthParams: {
      expiration: 'never',
      name: 'Flowlib',
    },
    supportsRefresh: false, // Trello uses OAuth 1.0a style with non-expiring tokens
    docsUrl: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/',
    category: 'project_management',
  },

  // Zoom
  zoom: {
    id: 'zoom',
    name: 'Zoom',
    description: 'Access Zoom for meetings and webinars',
    icon: 'Video',
    authorizationUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    defaultScopes: ['meeting:read', 'meeting:write', 'user:read', 'webinar:read', 'webinar:write'],
    supportsRefresh: true,
    docsUrl: 'https://developers.zoom.us/docs/integrations/oauth/',
    category: 'communication',
  },

  // Discord
  discord: {
    id: 'discord',
    name: 'Discord',
    description: 'Access Discord for messaging and server management',
    icon: 'MessageSquare',
    authorizationUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    defaultScopes: ['identify', 'email', 'guilds', 'guilds.members.read', 'bot', 'messages.read'],
    supportsRefresh: true,
    docsUrl: 'https://discord.com/developers/docs/topics/oauth2',
    category: 'communication',
  },

  // Twitter/X
  twitter: {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Access Twitter/X for tweets and user data',
    icon: 'Twitter',
    authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    defaultScopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    additionalAuthParams: {
      code_challenge_method: 'S256',
    },
    supportsRefresh: true,
    docsUrl: 'https://developer.twitter.com/en/docs/authentication/oauth-2-0',
    category: 'marketing',
  },

  // Spotify
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    description: 'Access Spotify for music and playlist management',
    icon: 'Music',
    authorizationUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    defaultScopes: [
      'user-read-email',
      'user-read-private',
      'playlist-read-private',
      'playlist-modify-public',
      'playlist-modify-private',
    ],
    supportsRefresh: true,
    docsUrl: 'https://developer.spotify.com/documentation/web-api/tutorials/code-flow',
    category: 'other',
  },

  // Shopify
  shopify: {
    id: 'shopify',
    name: 'Shopify',
    description: 'Access Shopify for e-commerce store management',
    icon: 'ShoppingBag',
    authorizationUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
    defaultScopes: [
      'read_products',
      'write_products',
      'read_orders',
      'write_orders',
      'read_customers',
    ],
    supportsRefresh: false, // Shopify tokens don't expire
    docsUrl: 'https://shopify.dev/docs/apps/auth/oauth',
    category: 'other', // ecommerce
  },

  // Intercom
  intercom: {
    id: 'intercom',
    name: 'Intercom',
    description: 'Access Intercom for customer messaging and support',
    icon: 'MessageCircle',
    authorizationUrl: 'https://app.intercom.com/oauth',
    tokenUrl: 'https://api.intercom.io/auth/eagle/token',
    defaultScopes: [], // Intercom doesn't use scopes in OAuth flow
    supportsRefresh: false,
    docsUrl: 'https://developers.intercom.com/building-apps/docs/setting-up-oauth',
    category: 'support',
  },

  // Zendesk
  zendesk: {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Access Zendesk for customer support and ticketing',
    icon: 'Headphones',
    authorizationUrl: 'https://{subdomain}.zendesk.com/oauth/authorizations/new',
    tokenUrl: 'https://{subdomain}.zendesk.com/oauth/tokens',
    defaultScopes: ['read', 'write'],
    supportsRefresh: true,
    docsUrl: 'https://developer.zendesk.com/documentation/live-chat/getting-started/auth/',
    category: 'support',
  },

  // Box
  box: {
    id: 'box',
    name: 'Box',
    description: 'Access Box for file storage and collaboration',
    icon: 'Box',
    authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    defaultScopes: [], // Box doesn't use scopes in authorization
    supportsRefresh: true,
    docsUrl: 'https://developer.box.com/guides/authentication/oauth2/',
    category: 'storage',
  },

  // Pipedrive
  pipedrive: {
    id: 'pipedrive',
    name: 'Pipedrive',
    description: 'Access Pipedrive CRM for sales pipeline management',
    icon: 'TrendingUp',
    authorizationUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    defaultScopes: [], // Pipedrive uses app-level permissions, not OAuth scopes
    supportsRefresh: true,
    docsUrl: 'https://pipedrive.readme.io/docs/marketplace-oauth-authorization',
    category: 'crm_sales',
  },

  // Monday.com
  monday: {
    id: 'monday',
    name: 'Monday.com',
    description: 'Access Monday.com for work management',
    icon: 'Calendar',
    authorizationUrl: 'https://auth.monday.com/oauth2/authorize',
    tokenUrl: 'https://auth.monday.com/oauth2/token',
    defaultScopes: ['me:read', 'boards:read', 'boards:write'],
    supportsRefresh: true,
    docsUrl: 'https://developer.monday.com/apps/docs/oauth',
    category: 'project_management',
  },

  // ClickUp
  clickup: {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Access ClickUp for project and task management',
    icon: 'CheckCircle',
    authorizationUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    defaultScopes: [], // ClickUp doesn't use OAuth scopes
    supportsRefresh: true,
    docsUrl: 'https://clickup.com/api/developer-portal/authentication/',
    category: 'project_management',
  },

  // Freshdesk
  freshdesk: {
    id: 'freshdesk',
    name: 'Freshdesk',
    description: 'Access Freshdesk for customer support ticketing',
    icon: 'Headphones',
    authorizationUrl: 'https://{domain}.freshdesk.com/oauth/authorize',
    tokenUrl: 'https://{domain}.freshdesk.com/oauth/token',
    defaultScopes: [], // Freshdesk uses API key or OAuth without scopes
    supportsRefresh: true,
    docsUrl: 'https://developers.freshdesk.com/api/#authentication',
    category: 'support',
  },

  // QuickBooks
  quickbooks: {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Access QuickBooks for accounting and financial data',
    icon: 'DollarSign',
    authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    defaultScopes: ['com.intuit.quickbooks.accounting'],
    supportsRefresh: true,
    docsUrl:
      'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0',
    category: 'payments', // accounting/finance
  },

  // Mailchimp
  mailchimp: {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Access Mailchimp for email marketing and audiences',
    icon: 'Mail',
    authorizationUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    defaultScopes: [], // Mailchimp doesn't use OAuth scopes
    supportsRefresh: false, // Mailchimp tokens don't expire
    docsUrl: 'https://mailchimp.com/developer/marketing/guides/access-user-data-oauth-2/',
    category: 'marketing',
  },

  // Stripe
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    description: 'Access Stripe for payment processing',
    icon: 'CreditCard',
    authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    defaultScopes: ['read_write'],
    supportsRefresh: true,
    docsUrl: 'https://stripe.com/docs/connect/oauth-reference',
    category: 'payments',
  },

  // PayPal
  paypal: {
    id: 'paypal',
    name: 'PayPal',
    description: 'Access PayPal for payment processing',
    icon: 'DollarSign',
    authorizationUrl: 'https://www.paypal.com/signin/authorize',
    tokenUrl: 'https://api.paypal.com/v1/oauth2/token',
    defaultScopes: ['openid', 'email'],
    supportsRefresh: true,
    docsUrl: 'https://developer.paypal.com/docs/log-in-with-paypal/integrate/',
    category: 'payments',
  },

  // Sentry
  sentry: {
    id: 'sentry',
    name: 'Sentry',
    description: 'Access Sentry for error monitoring, issue tracking, and project management',
    icon: 'Bug',
    authorizationUrl: 'https://sentry.io/oauth/authorize/',
    tokenUrl: 'https://sentry.io/oauth/token/',
    defaultScopes: ['org:read', 'project:read', 'event:read', 'event:write'],
    supportsRefresh: true,
    docsUrl: 'https://docs.sentry.io/api/auth/',
    category: 'development',
  },

  // LinkedIn
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Access LinkedIn for profiles, posts, and company pages',
    icon: 'Linkedin',
    authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    defaultScopes: ['openid', 'profile', 'email', 'w_member_social'],
    supportsRefresh: true,
    docsUrl:
      'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    category: 'marketing',
  },

  // GitLab
  gitlab: {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Access GitLab repositories, issues, and merge requests',
    icon: 'GitBranch',
    authorizationUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    defaultScopes: ['api', 'read_user', 'read_repository', 'write_repository'],
    supportsRefresh: true,
    docsUrl: 'https://docs.gitlab.com/ee/api/oauth2.html',
    category: 'development',
  },

  // Facebook
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    description: 'Access Facebook pages, posts, and insights',
    icon: 'Facebook',
    authorizationUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    defaultScopes: [
      'public_profile',
      'email',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
    ],
    supportsRefresh: false,
    docsUrl: 'https://developers.facebook.com/docs/facebook-login/guides/access-tokens/',
    category: 'marketing',
  },
};

/**
 * Get a provider definition by ID
 */
export function getOAuth2Provider(providerId: string): OAuth2ProviderDefinition | undefined {
  return OAUTH2_PROVIDERS[providerId];
}

/**
 * Get all provider definitions
 */
export function getAllOAuth2Providers(): OAuth2ProviderDefinition[] {
  return Object.values(OAUTH2_PROVIDERS);
}

/**
 * Get providers by category
 */
export function getOAuth2ProvidersByCategory(
  category: OAuth2ProviderDefinition['category'],
): OAuth2ProviderDefinition[] {
  return Object.values(OAUTH2_PROVIDERS).filter((p) => p.category === category);
}
