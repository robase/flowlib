/**
 * Screen definitions for the visual audit tool.
 *
 * Each entry describes a UI state to capture: what it is, how to reach it,
 * and what tags to apply for the AI analysis context.
 */

export interface ScreenDefinition {
  id: string;
  description: string;
  tags: string[];
  /** Viewport override — defaults to 1280×720 if not set */
  viewport?: { width: number; height: number };
  /**
   * CSS selector for a focused crop screenshot (in addition to full viewport).
   * If set, the locator is screenshot'd separately as `{id}-focus.png`.
   */
  focusCropSelector?: string;
}

// Seed flow definitions used by capture.ts
export const SEED_FLOWS = {
  dataPipeline: {
    name: 'Data Pipeline',
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'core.input',
          label: 'User Data',
          referenceId: 'user_data',
          params: {
            variableName: 'data',
            defaultValue: JSON.stringify({
              users: [
                { name: 'Alice', active: true },
                { name: 'Bob', active: false },
              ],
            }),
          },
          position: { x: 100, y: 200 },
        },
        {
          id: 'n2',
          type: 'core.javascript',
          label: 'Transform',
          referenceId: 'transform',
          params: { code: 'user_data.users.filter(u => u.active)' },
          position: { x: 380, y: 200 },
        },
        {
          id: 'n3',
          type: 'core.output',
          label: 'Results',
          referenceId: 'results',
          params: { outputValue: '{{ transform }}' },
          position: { x: 660, y: 200 },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    },
  },
  aiAssistant: {
    name: 'AI Chat',
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'core.input',
          label: 'Question',
          referenceId: 'question',
          params: { variableName: 'query', defaultValue: 'What is workflow orchestration?' },
          position: { x: 80, y: 200 },
        },
        {
          id: 'n2',
          type: 'core.template_string',
          label: 'Build Prompt',
          referenceId: 'build_prompt',
          params: { template: 'Summarize this topic: {{ question }}' },
          position: { x: 340, y: 200 },
        },
        {
          id: 'n3',
          type: 'core.agent',
          label: 'Research Agent',
          referenceId: 'research_agent',
          params: {
            model: 'gpt-4o-mini',
            taskPrompt: 'Research: {{ build_prompt }}',
            maxIterations: 5,
          },
          position: { x: 600, y: 200 },
        },
        {
          id: 'n4',
          type: 'core.output',
          label: 'Answer',
          referenceId: 'answer',
          params: { outputValue: '{{ research_agent }}' },
          position: { x: 860, y: 200 },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
      ],
    },
  },
  simpleTemplate: {
    name: 'Simple Template',
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'core.input',
          label: 'Topic',
          referenceId: 'topic',
          params: { variableName: 'subject', defaultValue: 'artificial intelligence' },
          position: { x: 100, y: 200 },
        },
        {
          id: 'n2',
          type: 'core.template_string',
          label: 'Format Prompt',
          referenceId: 'format_prompt',
          params: { template: 'Write about {{ topic }} in detail.' },
          position: { x: 400, y: 200 },
        },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    },
  },
  /** A bare agent node with no params — shows the empty agent config panel */
  agentEmpty: {
    name: 'Empty Agent Flow',
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'core.agent',
          label: 'AI Agent',
          referenceId: 'ai_agent',
          params: {},
          position: { x: 300, y: 200 },
        },
      ],
      edges: [],
    },
  },
  /** Agent node with pre-configured tool instances — shows the filled AgentToolsBox and ToolConfigPanel */
  agentWithTools: {
    name: 'Agent With Tools',
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'core.input',
          label: 'Task',
          referenceId: 'task',
          params: {
            variableName: 'task',
            defaultValue: 'Analyse the sales data and send a summary',
          },
          position: { x: 80, y: 200 },
        },
        {
          id: 'n2',
          type: 'core.agent',
          label: 'Data Agent',
          referenceId: 'data_agent',
          params: {
            model: 'gpt-4o-mini',
            taskPrompt: '{{ task }}',
            maxIterations: 10,
            stopCondition: 'explicit_stop',
            enableParallelTools: false,
            addedTools: [
              {
                instanceId: 'va-tool-1',
                toolId: 'math_eval',
                name: 'Math Evaluate',
                description: 'Evaluate mathematical expressions',
                params: {},
              },
              {
                instanceId: 'va-tool-2',
                toolId: 'http.request',
                name: 'HTTP Request',
                description: 'Make HTTP requests to external APIs',
                params: {},
              },
              {
                instanceId: 'va-tool-3',
                toolId: 'core.javascript',
                name: 'JS Transform',
                description: 'Transform JSON data with JavaScript',
                params: { code: '$input.data' },
              },
            ],
          },
          position: { x: 360, y: 200 },
        },
        {
          id: 'n3',
          type: 'core.output',
          label: 'Report',
          referenceId: 'report',
          params: { outputValue: '{{ data_agent }}' },
          position: { x: 640, y: 200 },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    },
  },
} as const;

/**
 * All screens to capture, in order.
 *
 * The `id` doubles as the screenshot filename prefix (e.g. "01-dashboard-collapsed" → "01-dashboard-collapsed.png").
 * The capture script interprets these declaratively — the actual navigation logic lives in capture.ts.
 */
export const SCREENS: ScreenDefinition[] = [
  // ── Pages & Navigation ──────────────────────────────────────────────────
  {
    id: '01-dashboard-collapsed',
    description:
      'Dashboard page with sidebar in default collapsed (icon-only) state. Shows flow cards, stats, and navigation icons.',
    tags: ['page', 'dashboard', 'navigation'],
  },
  {
    id: '02-dashboard-expanded',
    description:
      'Dashboard page with sidebar expanded showing full nav labels (Home, Executions, Credentials).',
    tags: ['page', 'dashboard', 'navigation'],
  },
  {
    id: '03-executions-page',
    description:
      'Executions page showing the flow run history table with status, duration, and timestamp columns.',
    tags: ['page', 'executions'],
  },
  {
    id: '04-credentials-page',
    description: 'Credentials page showing the list of stored API keys and OAuth2 connections.',
    tags: ['page', 'credentials'],
  },

  // ── Modals ──────────────────────────────────────────────────────────────
  {
    id: '05-add-flow-modal',
    description: 'Add Flow modal dialog opened from the dashboard, with flow name input field.',
    tags: ['modal', 'dashboard', 'flow-creation'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '06-add-credential-modal',
    description:
      'Add Credential modal dialog opened from the credentials page, showing credential type selection and form fields.',
    tags: ['modal', 'credentials'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '06b-credential-edit-modal',
    description:
      'Credential detail modal with the Edit tab selected, showing editable credential fields and update actions.',
    tags: ['modal', 'credentials', 'edit'],
    focusCropSelector: "[role='dialog']",
  },

  // ── Flow Editor ─────────────────────────────────────────────────────────
  {
    id: '07-editor-canvas',
    description:
      "Flow editor canvas showing the 'Data Pipeline' flow with 3 connected nodes (User Data → Transform → Results) on the React Flow canvas.",
    tags: ['editor', 'canvas', 'nodes'],
  },
  {
    id: '08-node-selected',
    description:
      "Flow editor with the 'Transform' (JQ) node clicked/selected, showing selection highlight state.",
    tags: ['editor', 'node-selection'],
  },
  {
    id: '09-input-config-panel',
    description:
      "Node configuration panel for the 'User Data' Input node, showing parameter fields and input/output preview editors.",
    tags: ['editor', 'config-panel', 'input-node'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '10-jq-config-panel',
    description:
      "Node configuration panel for the 'Transform' JQ node, showing the JQ query code editor and parameter fields.",
    tags: ['editor', 'config-panel', 'jq-node'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '11-agent-config-panel',
    description:
      "Node configuration panel for the 'Research Agent' AGENT node, showing task prompt, model selector, tool configuration, and iteration settings.",
    tags: ['editor', 'config-panel', 'agent-node'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '12-editor-toolbar',
    description:
      'Flow editor header and toolbar area showing the flow name, zoom controls, run button, and version info.',
    tags: ['editor', 'toolbar'],
    focusCropSelector: 'header',
  },

  // ── Chat Assistant ────────────────────────────────────────────────────────
  {
    id: '13-chat-no-credential',
    description:
      'Chat assistant panel opened on the flow editor with no LLM credential configured, showing the setup prompt.',
    tags: ['chat', 'empty-state', 'credentials'],
  },
  {
    id: '14-chat-settings-panel',
    description:
      'Chat assistant settings panel showing LLM credential selector dropdown and max steps configuration.',
    tags: ['chat', 'settings', 'credentials'],
  },
  {
    id: '15-chat-ready',
    description:
      'Chat assistant panel with credential configured, showing the empty conversation ready state with input field.',
    tags: ['chat', 'empty-state'],
  },
  {
    id: '16-chat-user-message',
    description: 'Chat assistant panel showing a user message bubble after submitting a prompt.',
    tags: ['chat', 'conversation', 'user-message'],
  },
  {
    id: '17-chat-assistant-reply',
    description:
      "Chat assistant panel showing the assistant's reply rendered as markdown, with tool call bubbles showing executed tools.",
    tags: ['chat', 'conversation', 'assistant-reply', 'tool-calls'],
  },
  {
    id: '18-chat-tool-expanded',
    description:
      'Chat assistant panel with a tool call result expanded, showing the JSON output data inside a collapsible section.',
    tags: ['chat', 'conversation', 'tool-calls', 'expanded'],
  },
  {
    id: '19-chat-multi-turn',
    description:
      'Chat assistant panel showing a multi-turn conversation with user messages, assistant replies, and multiple tool calls demonstrating the full interaction flow.',
    tags: ['chat', 'conversation', 'multi-turn'],
  },

  // ── Agent Node ───────────────────────────────────────────────────────────
  {
    id: '22-agent-node-canvas-empty',
    description:
      "Flow editor canvas showing the 'AI Assistant' flow with the AGENT node visible. The AgentToolsBox below the node shows the empty state with the dashed 'Add Tools' call-to-action.",
    tags: ['editor', 'canvas', 'agent-node', 'empty-state'],
  },
  {
    id: '23-agent-node-canvas-with-tools',
    description:
      "Flow editor canvas showing the 'Agent With Tools' flow. The AGENT node has a populated AgentToolsBox below it displaying tool tiles (Math Evaluate, HTTP Request, JQ Transform) and a Configure button.",
    tags: ['editor', 'canvas', 'agent-node', 'tools', 'agent-tools-box'],
  },
  {
    id: '24-agent-config-panel-empty',
    description:
      'Node configuration panel (dialog) for a bare AGENT node with no params configured. Shows the empty model selector, empty task prompt, and an empty tools section.',
    tags: ['editor', 'config-panel', 'agent-node', 'empty-state'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '25-agent-config-panel-seeded',
    description:
      "Node configuration panel (dialog) for the 'Research Agent' AGENT node from the AI Assistant flow, showing the configured model, task prompt, and max iterations settings.",
    tags: ['editor', 'config-panel', 'agent-node'],
    focusCropSelector: "[role='dialog']",
  },

  // ── Tools Configuration ───────────────────────────────────────────────────
  {
    id: '26-agent-actions-sidebar-empty',
    description:
      "Flow editor with the left sidebar switched to 'Agent Actions' mode after clicking 'Add Tools' on an agent node with no tools. Shows the tool catalog with search, category filters, and the full list of available actions. No tools are added yet.",
    tags: ['editor', 'tools', 'agent-actions-sidebar', 'empty-state'],
  },
  {
    id: '27-agent-actions-sidebar-seeded',
    description:
      "Flow editor with the 'Agent Actions' sidebar open on the 'Agent With Tools' flow. Shows the tool catalog with the count badge (3 tools already added), and tool tiles visible in the sidebar list.",
    tags: ['editor', 'tools', 'agent-actions-sidebar'],
  },
  {
    id: '28-tool-config-panel',
    description:
      "Flow editor showing the ToolConfigPanel right panel after clicking the 'HTTP Request' tool tile in the AgentToolsBox. The panel shows the tool name, description, category badge, and parameter fields.",
    tags: ['editor', 'tools', 'tool-config-panel'],
  },

  // ── Theme ────────────────────────────────────────────────────────────────
  {
    id: '20-dashboard-dark',
    description:
      'Dashboard page in dark mode theme, showing flow cards and navigation with dark color scheme.',
    tags: ['dark-mode', 'dashboard'],
  },
  {
    id: '21-editor-dark',
    description: 'Flow editor canvas in dark mode showing the node graph with dark theme styling.',
    tags: ['dark-mode', 'editor'],
  },

  // ── Plugin: Webhooks ──────────────────────────────────────────────────────
  {
    id: '29-webhooks-empty',
    description:
      "Webhooks management page in empty state showing the 'No webhooks yet' message with a create button. Part of the @flowlib/webhooks plugin.",
    tags: ['page', 'plugin', 'webhooks', 'empty-state'],
  },
  {
    id: '30-webhook-create-form',
    description:
      'Create Webhook modal showing the form with name input, description, authentication info, and HTTP methods selector.',
    tags: ['modal', 'plugin', 'webhooks', 'create'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '31-webhook-create-success',
    description:
      'Create Webhook modal in success state showing the generated webhook URL with copy button and a Done button.',
    tags: ['modal', 'plugin', 'webhooks', 'create', 'success'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '32-webhooks-list',
    description:
      'Webhooks page showing a populated list of webhook triggers with name, status dot, auth badge, trigger count, and last triggered time.',
    tags: ['page', 'plugin', 'webhooks'],
  },
  {
    id: '33-webhook-detail-overview',
    description:
      'Webhook detail panel (Overview tab) showing webhook URL, endpoint secret, methods, authentication mode, linked flow, trigger stats, and enable/disable + delete action buttons.',
    tags: ['modal', 'plugin', 'webhooks', 'detail', 'overview'],
    focusCropSelector: "[role='dialog']",
  },
  {
    id: '34-webhook-detail-edit',
    description:
      'Webhook detail panel (Edit tab) showing editable name, description, and HTTP methods fields with Cancel and Save Changes buttons.',
    tags: ['modal', 'plugin', 'webhooks', 'detail', 'edit'],
    focusCropSelector: "[role='dialog']",
  },

  // ── Plugin: Auth / Users ────────────────────────────────────────────────
  {
    id: '35-users-list',
    description:
      'User management page from the @flowlib/user-auth plugin showing the admin user table with name, email, role dropdown, and action columns.',
    tags: ['page', 'plugin', 'auth', 'users'],
  },
  {
    id: '36-users-create-form',
    description:
      'User management page with the Create User form expanded, showing name, role selector, email, and password fields.',
    tags: ['page', 'plugin', 'auth', 'users', 'create'],
  },
  {
    id: '37-user-profile',
    description:
      "Profile page from the @flowlib/user-auth plugin showing the current user's avatar, name, email, role badge, user ID, and sign out button.",
    tags: ['page', 'plugin', 'auth', 'profile'],
  },
  {
    id: '38-sidebar-user-menu',
    description:
      'Sidebar footer showing the signed-in user avatar and name from the @flowlib/user-auth plugin, visible when sidebar is expanded.',
    tags: ['navigation', 'plugin', 'auth', 'sidebar-footer'],
  },

  // ── Plugin: RBAC / Access Control ───────────────────────────────────────
  {
    id: '39-access-control-tree',
    description:
      "Access Control page from the @flowlib/rbac plugin showing the two-pane layout: left pane has a team/flow hierarchy tree with Engineering and Data Science teams, right pane shows the 'Select a team or flow' empty state.",
    tags: ['page', 'plugin', 'rbac', 'access-control', 'tree'],
  },
  {
    id: '40-access-control-team-detail',
    description:
      'Access Control page with a team selected in the tree. Right pane shows the ScopeDetailPanel with team name, breadcrumb path, team role selector, members section, and access grants.',
    tags: ['page', 'plugin', 'rbac', 'access-control', 'team-detail'],
  },
  {
    id: '41-access-control-flow-detail',
    description:
      'Access Control page with a flow selected in the tree. Right pane shows the FlowDetailPanel with flow name, breadcrumb path, direct access table, and inherited access table.',
    tags: ['page', 'plugin', 'rbac', 'access-control', 'flow-detail'],
  },
  {
    id: '42-share-button-flow',
    description:
      'Flow editor header showing the Share button contributed by the @flowlib/rbac plugin, alongside the standard flow name, run button, and version controls.',
    tags: ['editor', 'plugin', 'rbac', 'share-button'],
  },
  {
    id: '43-share-flow-modal',
    description:
      "Share Flow modal dialog showing the 'People with access' list with user avatars, permission badges, and revoke buttons, plus the 'Add people' section with user/team selector and permission dropdown.",
    tags: ['modal', 'plugin', 'rbac', 'share-flow'],
    focusCropSelector: '.fixed.inset-0',
  },
];
