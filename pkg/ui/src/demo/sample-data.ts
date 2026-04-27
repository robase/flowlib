/**
 * Example: Static demo data for showcasing Invect flows in documentation.
 *
 * This file demonstrates the shape of data needed to power the DemoInvect
 * and FlowViewer components without a backend server.
 */

import type { DemoData } from './demo-api-client';
import type { NodeDefinition } from '../types/node-definition.types';
import type { ReactFlowNodeData } from '@flowlib/core/types';
import type { Node, Edge } from '@xyflow/react';

// ---------------------------------------------------------------------------
// 1. Node Definitions — describes available node types for the palette & config
// ---------------------------------------------------------------------------

export const sampleNodeDefinitions: NodeDefinition[] = [
  {
    type: 'core.input',
    label: 'Flow Input',
    description: 'Entry point for the flow. Defines input variables.',
    icon: 'ArrowRightToLine',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: undefined,
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [{ name: 'inputSchema', label: 'Input Schema', type: 'json', required: false }],
    maxInstances: 1,
  },
  {
    type: 'core.output',
    label: 'Flow Output',
    description: 'Exit point for the flow. Returns data to the caller.',
    icon: 'ArrowLeftFromLine',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [],
    paramFields: [],
    maxInstances: 1,
  },
  {
    type: 'core.model',
    label: 'AI Model',
    description: 'Send a prompt to an LLM (OpenAI, Anthropic, etc.)',
    icon: 'Brain',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Output', type: 'string' }],
    paramFields: [
      {
        name: 'credentialId',
        label: 'API Credential',
        type: 'credential',
        required: true,
        credentialTypes: ['llm'],
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        options: [
          { label: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
          { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
          { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
          { label: 'GPT-4o', value: 'gpt-4o' },
          { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
        ],
      },
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
      { name: 'systemPrompt', label: 'System Prompt', type: 'textarea', required: false },
    ],
  },
  {
    type: 'core.javascript',
    label: 'JavaScript',
    description:
      'Transform data with JavaScript in a sandboxed runtime. Upstream outputs are available as local variables by reference ID.',
    icon: 'Braces',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [{ name: 'code', label: 'JavaScript Code', type: 'code', required: true }],
  },
  {
    type: 'core.if_else',
    label: 'If/Else',
    description: 'Conditional branching based on a JavaScript expression.',
    icon: 'GitBranch',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [
      { id: 'true_output', label: 'True', type: 'any' },
      { id: 'false_output', label: 'False', type: 'any' },
    ],
    paramFields: [{ name: 'condition', label: 'Condition', type: 'code', required: true }],
  },
  {
    type: 'http.request',
    label: 'HTTP Request',
    description: 'Make an HTTP request to any URL.',
    icon: 'Globe',
    provider: { id: 'http', name: 'HTTP', icon: 'Globe' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Response', type: 'object' }],
    paramFields: [
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        required: true,
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'DELETE', value: 'DELETE' },
        ],
        defaultValue: 'GET',
      },
      { name: 'url', label: 'URL', type: 'text', required: true },
      { name: 'headers', label: 'Headers', type: 'json', required: false },
      { name: 'body', label: 'Body', type: 'json', required: false },
    ],
  },
  {
    type: 'gmail.send_message',
    label: 'Send Email',
    description: 'Send an email via Gmail.',
    icon: 'Mail',
    provider: { id: 'gmail', name: 'Gmail', icon: 'Mail' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Result', type: 'object' }],
    paramFields: [
      { name: 'to', label: 'To', type: 'text', required: true },
      { name: 'subject', label: 'Subject', type: 'text', required: true },
      { name: 'body', label: 'Body', type: 'textarea', required: true },
    ],
  },
  {
    type: 'gmail.get_message',
    label: 'Get Email',
    description: 'Retrieve a Gmail message by ID.',
    icon: 'Mail',
    provider: { id: 'gmail', name: 'Gmail', icon: 'Mail' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Message', type: 'object' }],
    paramFields: [{ name: 'messageId', label: 'Message ID', type: 'text', required: true }],
  },
  {
    type: 'gmail.modify_labels',
    label: 'Modify Labels',
    description: 'Add or remove labels from a Gmail message.',
    icon: 'Mail',
    provider: { id: 'gmail', name: 'Gmail', icon: 'Mail' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Result', type: 'object' }],
    paramFields: [
      { name: 'messageId', label: 'Message ID', type: 'text', required: true },
      { name: 'addLabels', label: 'Add Labels', type: 'text', required: false },
      { name: 'removeLabels', label: 'Remove Labels', type: 'text', required: false },
    ],
  },
  {
    type: 'slack.send_message',
    label: 'Send Message',
    description: 'Send a message to a Slack channel.',
    icon: 'MessageSquare',
    provider: { id: 'slack', name: 'Slack', icon: 'MessageSquare' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Result', type: 'object' }],
    paramFields: [
      { name: 'channel', label: 'Channel', type: 'text', required: true },
      { name: 'text', label: 'Message', type: 'textarea', required: true },
    ],
  },
  {
    type: 'linear.create_issue',
    label: 'Create Issue',
    description: 'Create a new issue in Linear.',
    icon: 'SquarePen',
    provider: { id: 'linear', name: 'Linear', icon: 'SquarePen' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Issue', type: 'object' }],
    paramFields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: false },
      { name: 'teamId', label: 'Team ID', type: 'text', required: true },
    ],
  },
  {
    type: 'linear.update_issue',
    label: 'Update Issue',
    description: 'Update an existing issue in Linear.',
    icon: 'SquarePen',
    provider: { id: 'linear', name: 'Linear', icon: 'SquarePen' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Issue', type: 'object' }],
    paramFields: [
      { name: 'issueId', label: 'Issue ID', type: 'text', required: true },
      { name: 'stateId', label: 'State', type: 'text', required: false },
      { name: 'comment', label: 'Comment', type: 'textarea', required: false },
    ],
  },
  {
    type: 'github.create_issue',
    label: 'Create Issue',
    description: 'Create a new GitHub issue.',
    icon: 'Github',
    provider: { id: 'github', name: 'GitHub', icon: 'Github' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Issue', type: 'object' }],
    paramFields: [
      { name: 'owner', label: 'Owner', type: 'text', required: true },
      { name: 'repo', label: 'Repository', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Body', type: 'textarea', required: false },
    ],
  },
  {
    type: 'trigger.webhook',
    label: 'Webhook Trigger',
    description: 'Trigger a flow from an incoming webhook.',
    icon: 'Webhook',
    provider: { id: 'triggers', name: 'Triggers', icon: 'Zap' },
    input: undefined,
    outputs: [{ id: 'output', label: 'Payload', type: 'any' }],
    paramFields: [],
    maxInstances: 1,
  },
  {
    type: 'core.agent',
    label: 'AI Agent',
    description: 'Autonomous AI agent with iterative tool-calling loop.',
    icon: 'Bot',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [
      {
        name: 'credentialId',
        label: 'API Credential',
        type: 'credential',
        required: true,
        credentialTypes: ['llm'],
      },
      {
        name: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        options: [
          { label: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
          { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
          { label: 'GPT-4o', value: 'gpt-4o' },
        ],
      },
      { name: 'taskPrompt', label: 'Task Prompt', type: 'textarea', required: true },
      { name: 'systemPrompt', label: 'System Prompt', type: 'textarea', required: false },
    ],
  },
  {
    type: 'core.switch',
    label: 'Switch',
    description: 'Multi-way conditional branching based on JS expressions.',
    icon: 'GitFork',
    provider: { id: 'core', name: 'Core', icon: 'Blocks' },
    input: { id: 'input', label: 'Input', type: 'any' },
    dynamicOutputs: true,
    outputs: [
      { id: 'case_0', label: 'Case 0', type: 'any' },
      { id: 'default', label: 'Default', type: 'any' },
    ],
    paramFields: [
      {
        name: 'matchMode',
        label: 'Match Mode',
        type: 'select',
        required: false,
        options: [
          { label: 'First match', value: 'first' },
          { label: 'All matches', value: 'all' },
        ],
      },
      { name: 'cases', label: 'Cases', type: 'switch-cases', required: true },
    ],
  },
  {
    type: 'github.create_pull_request',
    label: 'Create Pull Request',
    description: 'Create a new pull request on GitHub.',
    icon: 'GitPullRequest',
    provider: { id: 'github', name: 'GitHub', icon: 'Github' },
    input: { id: 'input', label: 'Input', type: 'any' },
    outputs: [{ id: 'output', label: 'PR', type: 'object' }],
    paramFields: [
      { name: 'owner', label: 'Owner', type: 'text', required: true },
      { name: 'repo', label: 'Repository', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Body', type: 'textarea', required: false },
      { name: 'head', label: 'Head Branch', type: 'text', required: true },
      { name: 'base', label: 'Base Branch', type: 'text', required: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// 2. Example Flow: Input → AI Model → JavaScript Transform → Output
// ---------------------------------------------------------------------------

export const simpleFlowNodes: Node<ReactFlowNodeData>[] = [
  {
    id: 'node-input',
    type: 'core.input',
    position: { x: 0, y: 100 },
    data: {
      id: 'node-input',
      type: 'core.input',
      display_name: 'User Query',
      reference_id: 'user_query',
      status: 'idle',
      params: {},
    },
  },
  {
    id: 'node-model',
    type: 'core.model',
    position: { x: 300, y: 100 },
    data: {
      id: 'node-model',
      type: 'core.model',
      display_name: 'Summarize',
      reference_id: 'summarize',
      status: 'idle',
      params: {
        model: 'gpt-4o',
        prompt: 'Summarize the following text:\n\n{{ user_query }}',
        systemPrompt: 'You are a helpful assistant that summarizes text concisely.',
      },
    },
  },
  {
    id: 'node-transform',
    type: 'core.javascript',
    position: { x: 600, y: 100 },
    data: {
      id: 'node-transform',
      type: 'core.javascript',
      display_name: 'Format Output',
      reference_id: 'format_output',
      status: 'idle',
      params: {
        code: 'return { summary: summarize, timestamp: new Date().toISOString() };',
      },
    },
  },
  {
    id: 'node-output',
    type: 'core.output',
    position: { x: 900, y: 100 },
    data: {
      id: 'node-output',
      type: 'core.output',
      display_name: 'Result',
      reference_id: 'result',
      status: 'idle',
      params: {},
    },
  },
];

export const simpleFlowEdges: Edge[] = [
  { id: 'e-input-model', source: 'node-input', target: 'node-model' },
  { id: 'e-model-transform', source: 'node-model', target: 'node-transform' },
  { id: 'e-transform-output', source: 'node-transform', target: 'node-output' },
];

// ---------------------------------------------------------------------------
// 3. Example Flow with Branching: Input → If/Else → (HTTP | Email) → Output
// ---------------------------------------------------------------------------

export const branchingFlowNodes: Node<ReactFlowNodeData>[] = [
  {
    id: 'b-input',
    type: 'core.input',
    position: { x: 0, y: 150 },
    data: {
      id: 'b-input',
      type: 'core.input',
      display_name: 'Webhook Data',
      reference_id: 'webhook_data',
      status: 'idle',
      params: {},
    },
  },
  {
    id: 'b-branch',
    type: 'core.if_else',
    position: { x: 300, y: 150 },
    data: {
      id: 'b-branch',
      type: 'core.if_else',
      display_name: 'Is Priority?',
      reference_id: 'is_priority',
      status: 'idle',
      params: {
        condition: '{{ webhook_data.priority === "high" }}',
      },
    },
  },
  {
    id: 'b-http',
    type: 'http.request',
    position: { x: 600, y: 50 },
    data: {
      id: 'b-http',
      type: 'http.request',
      display_name: 'Create Ticket',
      reference_id: 'create_ticket',
      status: 'idle',
      params: {
        method: 'POST',
        url: 'https://api.example.com/tickets',
        body: '{{ { title: is_priority.subject, priority: "urgent" } }}',
      },
    },
  },
  {
    id: 'b-email',
    type: 'gmail.send_message',
    position: { x: 600, y: 280 },
    data: {
      id: 'b-email',
      type: 'gmail.send_message',
      display_name: 'Notify Team',
      reference_id: 'notify_team',
      status: 'idle',
      params: {
        to: 'team@example.com',
        subject: 'Low priority notification',
        body: '{{ is_priority.message }}',
      },
    },
  },
  {
    id: 'b-output',
    type: 'core.output',
    position: { x: 900, y: 150 },
    data: {
      id: 'b-output',
      type: 'core.output',
      display_name: 'Done',
      reference_id: 'done',
      status: 'idle',
      params: {},
    },
  },
];

export const branchingFlowEdges: Edge[] = [
  { id: 'be-input-branch', source: 'b-input', target: 'b-branch' },
  { id: 'be-branch-http', source: 'b-branch', target: 'b-http', sourceHandle: 'true_output' },
  { id: 'be-branch-email', source: 'b-branch', target: 'b-email', sourceHandle: 'false_output' },
  { id: 'be-http-output', source: 'b-http', target: 'b-output' },
  { id: 'be-email-output', source: 'b-email', target: 'b-output' },
];

// ---------------------------------------------------------------------------
// 3b. Showcase Flow: Linear Ticket Triage → Agent Investigation → Switch → Handlers
// ---------------------------------------------------------------------------

/** A realistic webhook payload from Linear */
const linearWebhookPayload = {
  action: 'create',
  type: 'Issue',
  data: {
    id: 'LIN-4821',
    identifier: 'ENG-4821',
    title: 'Payment processing fails with 502 for Stripe webhook handler',
    description:
      'Multiple customers reporting failed payments since 14:30 UTC. Stripe webhook endpoint returns 502. Logs show connection pool exhaustion in payment-service.',
    priority: 1,
    state: { name: 'Triage' },
    team: { key: 'ENG', name: 'Engineering' },
    creator: { name: 'Sarah Chen', email: 'sarah@acme.com' },
    labels: [{ name: 'bug' }, { name: 'payments' }, { name: 'urgent' }],
    url: 'https://linear.app/acme/issue/ENG-4821',
    createdAt: '2025-04-07T14:32:00Z',
  },
};

/** Agent investigation result — what the agent concluded */
const investigationResult = {
  summary:
    'Payment processing failures caused by PostgreSQL connection pool exhaustion in payment-service. The Stripe webhook handler opens a new DB connection per request but the pool limit (20) was exceeded during a traffic spike at 14:30 UTC. 847 failed payments in the last 2 hours affecting ~320 customers.',
  root_cause:
    'Connection pool exhaustion in payment-service. The `handleStripeWebhook()` function in `src/services/payments/stripe-handler.ts` acquires a connection but does not release it on the error path (missing `finally` block). Under normal load this is masked by the pool recycler, but the 3x traffic spike from the flash sale exhausted all 20 connections.',
  severity: 'critical',
  issue_type: 'bug',
  recommended_action:
    'Hotfix: Add `finally { connection.release() }` in stripe-handler.ts. Increase pool size to 50 as interim measure. Consider switching to a connection-per-transaction pattern.',
  affected_customers: 320,
  failed_transactions: 847,
  estimated_revenue_impact: '$42,350',
};

/** GitHub PR creation result */
const prResult = {
  id: 98712,
  number: 4293,
  html_url: 'https://github.com/acme/platform/pull/4293',
  title: 'fix: Payment processing fails with 502 for Stripe webhook handler',
  state: 'open',
  head: { ref: 'fix/ENG-4821' },
  base: { ref: 'main' },
  created_at: '2025-04-07T16:32:45Z',
};

/** Agent tool definitions for the showcase flow's Investigate Ticket agent node */
export const showcaseAgentTools: Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  provider?: { id: string; name: string; icon: string };
}> = [
  {
    id: 'postgres.execute_query',
    name: 'Query Database',
    description: 'Execute a SQL query against a PostgreSQL database.',
    category: 'data',
    provider: { id: 'postgres', name: 'PostgreSQL', icon: 'Database' },
  },
  {
    id: 'sentry.list_issues',
    name: 'Sentry Issues',
    description: 'Search Sentry for recent errors matching the ticket.',
    category: 'web',
    provider: { id: 'sentry', name: 'Sentry', icon: 'Bug' },
  },
  {
    id: 'cloudwatch.start_query',
    name: 'AWS Log Insights',
    description: 'Query CloudWatch Logs Insights for anomalies.',
    category: 'data',
    provider: { id: 'cloudwatch', name: 'CloudWatch', icon: 'Cloud' },
  },
  {
    id: 'notion.search',
    name: 'Search Notion',
    description: 'Search Notion workspace for relevant documentation.',
    category: 'web',
    provider: { id: 'notion', name: 'Notion', icon: 'FileText' },
  },
  {
    id: 'github.get_file_content',
    name: 'Read Source File',
    description: 'Read a file from the GitHub repository.',
    category: 'code',
    provider: { id: 'github', name: 'GitHub', icon: 'Github' },
  },
];

export const showcaseFlowNodes: Node<ReactFlowNodeData>[] = [
  // --- Row 1: Trigger + Agent investigation ---
  {
    id: 's-webhook',
    type: 'trigger.webhook',
    position: { x: 0, y: 240 },
    data: {
      id: 's-webhook',
      type: 'trigger.webhook',
      display_name: 'Linear Webhook',
      reference_id: 'linear_webhook',
      status: 'idle',
      params: {
        credentialId: 'cred-linear',
      },
    },
  },
  {
    id: 's-agent',
    type: 'core.agent',
    position: { x: 280, y: 240 },
    data: {
      id: 's-agent',
      type: 'core.agent',
      display_name: 'Investigation Agent',
      reference_id: 'investigation_agent',
      status: 'idle',
      params: {
        credentialId: 'cred-openai',
        model: 'gpt-4o',
        taskPrompt:
          'Investigate Linear ticket "{{ linear_webhook.title }}".\n\n1. Query the database for related records\n2. Search Sentry for recent errors\n3. Check AWS logs for anomalies\n4. Search Notion for relevant docs\n5. Read related source files on GitHub\n\nOutput a JSON object with: summary, root_cause, severity (critical/high/medium/low), issue_type (bug/feature_request/incident), and recommended_action.',
        systemPrompt:
          'You are a senior on-call engineer performing ticket triage. Be thorough but concise.',
        maxIterations: 10,
        stopCondition: 'explicit_stop',
        temperature: 0.7,
        toolTimeoutMs: 30000,
        maxConversationTokens: 100000,
        enableParallelTools: true,
        useBatchProcessing: false,
        maxTokens: 2000,
        addedTools: [
          {
            instanceId: 'tool_qn4q8nv0',
            toolId: 'postgres.execute_query',
            name: 'Query Database',
            description: 'Query PostgreSQL for related records',
            params: { _aiChosenModes: { query: true } },
          },
          {
            instanceId: 'tool_qvs9k37e',
            toolId: 'sentry.list_issues',
            name: 'Sentry Issues',
            description: 'Search Sentry for recent errors matching the ticket',
            params: { _aiChosenModes: { query: true } },
          },
          {
            instanceId: 'tool_bwhiecqs',
            toolId: 'cloudwatch.start_query',
            name: 'AWS Log Insights',
            description: 'Query CloudWatch Logs Insights for anomalies',
            params: { _aiChosenModes: { logGroupName: true, queryString: true } },
          },
          {
            instanceId: 'tool_cxbfi7au',
            toolId: 'notion.search',
            name: 'Search Notion',
            description: 'Search Notion workspace for relevant documentation',
            params: { _aiChosenModes: { query: true } },
          },
          {
            instanceId: 'tool_dez9g3z0',
            toolId: 'github.get_file_content',
            name: 'Read Source File',
            description: 'Read a file from the GitHub repository',
            params: { _aiChosenModes: { owner: true, repo: true, path: true } },
          },
        ],
      },
    },
  },

  // --- Row 2: Switch on issue type ---
  {
    id: 's-switch',
    type: 'core.switch',
    position: { x: 580, y: 220 },
    data: {
      id: 's-switch',
      type: 'core.switch',
      display_name: 'Route by Issue Type',
      reference_id: 'route_by_issue_type',
      status: 'idle',
      params: {
        matchMode: 'first',
        cases: [
          { slug: 'bug', label: 'Bug', expression: 'investigation.issue_type === "bug"' },
          {
            slug: 'feature',
            label: 'Feature Request',
            expression: 'investigation.issue_type === "feature_request"',
          },
          {
            slug: 'incident',
            label: 'Incident',
            expression: 'investigation.issue_type === "incident"',
          },
        ],
      },
    },
  },

  // --- Row 3: Handler for each branch ---

  // Bug path → Create PR with fix
  {
    id: 's-gh-pr',
    type: 'github.create_pull_request',
    position: { x: 900, y: 80 },
    data: {
      id: 's-gh-pr',
      type: 'github.create_pull_request',
      display_name: 'Create Fix PR',
      reference_id: 'create_fix_pr',
      status: 'idle',
      params: {
        credentialId: 'cred-github',
        owner: 'acme',
        repo: 'platform',
        title: 'fix: {{ linear_webhook.title }}',
        body: '{{ investigation.summary }}\n\nRoot cause: {{ investigation.root_cause }}',
        head: 'fix/{{ linear_webhook.identifier }}',
        base: 'main',
      },
    },
  },

  // Feature request path → Notify product channel
  {
    id: 's-slack-feature',
    type: 'slack.send_message',
    position: { x: 900, y: 190 },
    data: {
      id: 's-slack-feature',
      type: 'slack.send_message',
      display_name: 'Notify #product',
      reference_id: 'notify_product',
      status: 'idle',
      params: {
        credentialId: 'cred-slack',
        channel: '#product-requests',
        text: '*New feature request:* {{ linear_webhook.title }}\n\n{{ investigation.summary }}',
      },
    },
  },

  // Incident path → PagerDuty escalation
  {
    id: 's-pagerduty',
    type: 'http.request',
    position: { x: 900, y: 290 },
    data: {
      id: 's-pagerduty',
      type: 'http.request',
      display_name: 'PagerDuty Alert',
      reference_id: 'pagerduty_alert',
      status: 'idle',
      params: {
        method: 'POST',
        url: 'https://events.pagerduty.com/v2/enqueue',
        body: '{"routing_key": "R0123456789abcdef", "event_action": "trigger", "payload": {"summary": "{{ investigation.summary }}", "severity": "{{ investigation.severity }}", "source": "flowlib-triage"}}',
      },
    },
  },

  // Default path → Notify Slack
  {
    id: 's-slack-default',
    type: 'slack.send_message',
    position: { x: 900, y: 390 },
    data: {
      id: 's-slack-default',
      type: 'slack.send_message',
      display_name: 'Notify #triage',
      reference_id: 'notify_triage',
      status: 'idle',
      params: {
        credentialId: 'cred-slack',
        channel: '#triage',
        text: '*Unclassified ticket:* {{ linear_webhook.title }}\nSeverity: {{ investigation.severity }}\n\n{{ investigation.summary }}',
      },
    },
  },

  // --- Row 4: Merge — all branches converge here ---
  // Demonstrates multi-source-aware skip propagation: this node executes
  // because the bug branch (Create Fix PR) is live, even though the other
  // three source edges come from skipped nodes.
  {
    id: 's-linear-update',
    type: 'linear.update_issue',
    position: { x: 1300, y: 240 },
    data: {
      id: 's-linear-update',
      type: 'linear.update_issue',
      display_name: 'Update Linear Ticket',
      reference_id: 'update_linear_ticket',
      status: 'idle',
      params: {
        credentialId: 'cred-linear',
        issueId: '{{ linear_webhook.identifier }}',
        stateId: 'in-progress',
        comment:
          'Automated triage complete.\n\n**Severity:** {{ investigation.severity }}\n**Root cause:** {{ investigation.root_cause }}\n\n{% if fix_pr.html_url %}Fix PR: {{ fix_pr.html_url }}{% else %}No PR created — see action above.{% endif %}',
      },
    },
  },
];

export const showcaseFlowEdges: Edge[] = [
  { id: 'se-webhook-agent', source: 's-webhook', target: 's-agent' },
  { id: 'se-agent-switch', source: 's-agent', target: 's-switch' },
  { id: 'se-switch-pr', source: 's-switch', target: 's-gh-pr', sourceHandle: 'bug' },
  {
    id: 'se-switch-feature',
    source: 's-switch',
    target: 's-slack-feature',
    sourceHandle: 'feature',
  },
  { id: 'se-switch-incident', source: 's-switch', target: 's-pagerduty', sourceHandle: 'incident' },
  {
    id: 'se-switch-triage-output',
    source: 's-switch',
    target: 's-slack-default',
    sourceHandle: 'output',
  },
  {
    id: 'se-switch-triage-default',
    source: 's-switch',
    target: 's-slack-default',
    sourceHandle: 'default',
  },
  // All branches converge into Update Linear Ticket (diamond pattern)
  { id: 'se-pr-linear', source: 's-gh-pr', target: 's-linear-update' },
  { id: 'se-feature-linear', source: 's-slack-feature', target: 's-linear-update' },
  { id: 'se-incident-linear', source: 's-pagerduty', target: 's-linear-update' },
  { id: 'se-default-linear', source: 's-slack-default', target: 's-linear-update' },
];

// ---------------------------------------------------------------------------
// 4. Dummy flow run + node executions for the triage flow
// ---------------------------------------------------------------------------

/** Tool call records from the agent investigation */
const agentToolResults = [
  {
    toolId: 'postgres.execute_query',
    toolName: 'Query Database',
    input: {
      query:
        "SELECT COUNT(*) as failed_count, COUNT(DISTINCT customer_id) as affected_customers FROM payments WHERE status = 'failed' AND created_at > NOW() - INTERVAL '2 hours'",
    },
    output: { rows: [{ failed_count: 847, affected_customers: 320 }], rowCount: 1 },
    error: undefined,
    success: true,
    iteration: 1,
    executionTimeMs: 120,
  },
  {
    toolId: 'sentry.list_issues',
    toolName: 'Sentry Issues',
    input: { query: 'payment stripe webhook 502', project: 'payment-service' },
    output: {
      issues: [
        {
          id: 'SENTRY-89421',
          title: 'ConnectionPool exhausted: cannot acquire connection',
          count: 847,
          firstSeen: '2025-04-07T14:31:00Z',
          lastSeen: '2025-04-07T16:28:00Z',
          level: 'error',
          culprit: 'stripe-handler.ts in handleStripeWebhook',
        },
      ],
    },
    error: undefined,
    success: true,
    iteration: 2,
    executionTimeMs: 340,
  },
  {
    toolId: 'cloudwatch.start_query',
    toolName: 'AWS Log Insights',
    input: {
      logGroup: '/ecs/payment-service',
      query:
        'fields @timestamp, @message | filter @message like /connection pool|exhausted|502/ | sort @timestamp desc | limit 20',
      startTime: '2025-04-07T14:00:00Z',
      endTime: '2025-04-07T16:30:00Z',
    },
    output: {
      results: [
        {
          timestamp: '2025-04-07T14:31:12Z',
          message:
            'ERROR ConnectionPool: Cannot acquire connection — pool exhausted (20/20 active)',
        },
        {
          timestamp: '2025-04-07T14:31:13Z',
          message: 'ERROR StripeWebhookHandler: Failed to process payment_intent.succeeded — 502',
        },
        {
          timestamp: '2025-04-07T14:30:58Z',
          message: 'WARN ConnectionPool: Pool utilization at 95% (19/20) — approaching limit',
        },
      ],
      totalResults: 1247,
    },
    error: undefined,
    success: true,
    iteration: 3,
    executionTimeMs: 890,
  },
  {
    toolId: 'notion.search',
    toolName: 'Search Notion',
    input: { query: 'payment service connection pool architecture' },
    output: {
      results: [
        {
          id: 'page-1',
          title: 'Payment Service — Architecture & Runbook',
          url: 'https://notion.so/acme/payment-service-arch',
          snippet:
            '...connection pool is configured to max 20 connections via PG_POOL_MAX env var. The pool recycler runs every 30s...',
        },
        {
          id: 'page-2',
          title: 'Incident Response: Database Connection Issues',
          url: 'https://notion.so/acme/incident-db-connections',
          snippet:
            '...if pool exhaustion occurs, increase PG_POOL_MAX and restart. Long-term: implement connection-per-transaction...',
        },
      ],
    },
    error: undefined,
    success: true,
    iteration: 4,
    executionTimeMs: 210,
  },
  {
    toolId: 'github.get_file_content',
    toolName: 'Read Source File',
    input: { owner: 'acme', repo: 'platform', path: 'src/services/payments/stripe-handler.ts' },
    output: {
      content:
        'export async function handleStripeWebhook(event: StripeEvent) {\n  const connection = await pool.acquire();\n  try {\n    const payment = await connection.query(...);\n    await processPayment(payment);\n  } catch (err) {\n    logger.error("Webhook failed", err);\n    throw err;\n    // BUG: connection not released on error path!\n  }\n}',
      sha: 'abc123',
      size: 2847,
      path: 'src/services/payments/stripe-handler.ts',
    },
    error: undefined,
    success: true,
    iteration: 5,
    executionTimeMs: 155,
  },
];

/** The switch node's evaluation — bug path matched */
const switchOutput = {
  matchedCase: 'bug',
  matchedLabel: 'Bug',
  matchMode: 'first',
  caseResults: [
    { slug: 'bug', label: 'Bug', matched: true },
    { slug: 'feature', label: 'Feature Request', matched: false },
    { slug: 'incident', label: 'Incident', matched: false },
  ],
};

// --- Flow run timestamps (realistic ~18s total execution) ---
const RUN_START = '2025-04-07T16:32:10.000Z';
const WEBHOOK_END = '2025-04-07T16:32:10.045Z';
const AGENT_START = '2025-04-07T16:32:10.050Z';
const AGENT_END = '2025-04-07T16:32:26.120Z';
const SWITCH_START = '2025-04-07T16:32:26.125Z';
const SWITCH_END = '2025-04-07T16:32:26.180Z';
const PR_START = '2025-04-07T16:32:26.185Z';
const PR_END = '2025-04-07T16:32:28.340Z';
const LINEAR_UPDATE_START = '2025-04-07T16:32:28.345Z';
const LINEAR_UPDATE_END = '2025-04-07T16:32:29.110Z';
const RUN_END = '2025-04-07T16:32:29.115Z';

export const showcaseFlowRun = {
  id: 'run-triage-1',
  flowId: 'flow-triage',
  flowVersion: 1,
  status: 'SUCCESS',
  inputs: linearWebhookPayload,
  outputs: {
    create_fix_pr: prResult,
    update_linear_ticket: {
      id: 'LIN-4821',
      identifier: 'ENG-4821',
      state: { name: 'In Progress' },
    },
  },
  error: undefined,
  startedAt: RUN_START,
  completedAt: RUN_END,
  duration: 19115,
  triggerType: 'webhook',
  triggerNodeId: 's-webhook',
  triggerData: { source: 'linear', event: 'Issue.create' },
};

export const showcaseNodeExecutions = [
  // 1. Webhook trigger
  {
    id: 'nexec-webhook',
    flowRunId: 'run-triage-1',
    nodeId: 's-webhook',
    nodeType: 'trigger.webhook',
    status: 'SUCCESS',
    inputs: {},
    outputs: {
      nodeType: 'trigger.webhook',
      data: {
        variables: {
          output: { value: linearWebhookPayload.data, type: 'object' as const },
        },
      },
    },
    startedAt: RUN_START,
    completedAt: WEBHOOK_END,
    duration: 45,
    retryCount: 0,
  },
  // 2. Agent investigation
  {
    id: 'nexec-agent',
    flowRunId: 'run-triage-1',
    nodeId: 's-agent',
    nodeType: 'core.agent',
    status: 'SUCCESS',
    inputs: {
      linear_webhook: linearWebhookPayload.data,
    },
    outputs: {
      nodeType: 'core.agent',
      data: {
        variables: {
          output: {
            value: {
              finalResponse: JSON.stringify(investigationResult, null, 2),
              toolResults: agentToolResults,
              iterations: 6,
              finishReason: 'completed',
            },
            type: 'object' as const,
          },
        },
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
          totalToolCalls: 5,
          iterations: 6,
        },
      },
    },
    startedAt: AGENT_START,
    completedAt: AGENT_END,
    duration: 16070,
    retryCount: 0,
  },
  // 3. Switch — routes to "bug" branch
  {
    id: 'nexec-switch',
    flowRunId: 'run-triage-1',
    nodeId: 's-switch',
    nodeType: 'core.switch',
    status: 'SUCCESS',
    inputs: {
      investigation_agent: investigationResult,
    },
    outputs: {
      nodeType: 'core.switch',
      data: {
        variables: {
          bug: { value: investigationResult, type: 'object' as const },
        },
        metadata: switchOutput,
      },
    },
    startedAt: SWITCH_START,
    completedAt: SWITCH_END,
    duration: 55,
    retryCount: 0,
  },
  // 4. Bug → Create PR (active path)
  {
    id: 'nexec-gh-pr',
    flowRunId: 'run-triage-1',
    nodeId: 's-gh-pr',
    nodeType: 'github.create_pull_request',
    status: 'SUCCESS',
    inputs: {
      route_by_issue_type: investigationResult,
    },
    outputs: {
      nodeType: 'github.create_pull_request',
      data: {
        variables: {
          output: { value: prResult, type: 'object' as const },
        },
      },
    },
    startedAt: PR_START,
    completedAt: PR_END,
    duration: 2155,
    retryCount: 0,
  },
  // 5. Feature path — skipped (switch didn't match)
  {
    id: 'nexec-slack-feature',
    flowRunId: 'run-triage-1',
    nodeId: 's-slack-feature',
    nodeType: 'slack.send_message',
    status: 'SKIPPED',
    inputs: {},
    outputs: undefined,
    startedAt: SWITCH_END,
    completedAt: SWITCH_END,
    duration: 0,
    retryCount: 0,
  },
  // 6. Incident path — skipped
  {
    id: 'nexec-pagerduty',
    flowRunId: 'run-triage-1',
    nodeId: 's-pagerduty',
    nodeType: 'http.request',
    status: 'SKIPPED',
    inputs: {},
    outputs: undefined,
    startedAt: SWITCH_END,
    completedAt: SWITCH_END,
    duration: 0,
    retryCount: 0,
  },
  // 7. Default path — skipped
  {
    id: 'nexec-slack-default',
    flowRunId: 'run-triage-1',
    nodeId: 's-slack-default',
    nodeType: 'slack.send_message',
    status: 'SKIPPED',
    inputs: {},
    outputs: undefined,
    startedAt: SWITCH_END,
    completedAt: SWITCH_END,
    duration: 0,
    retryCount: 0,
  },
  // 8. Update Linear Ticket — executes because bug branch (Create Fix PR) is live,
  //    even though the other 3 source edges come from skipped nodes
  {
    id: 'nexec-linear-update',
    flowRunId: 'run-triage-1',
    nodeId: 's-linear-update',
    nodeType: 'linear.update_issue',
    status: 'SUCCESS',
    inputs: {
      create_fix_pr: prResult,
    },
    outputs: {
      nodeType: 'linear.update_issue',
      data: {
        variables: {
          output: {
            value: {
              id: 'LIN-4821',
              identifier: 'ENG-4821',
              state: { name: 'In Progress' },
              updatedAt: '2025-04-07T16:32:29.100Z',
            },
            type: 'object' as const,
          },
        },
      },
    },
    startedAt: LINEAR_UPDATE_START,
    completedAt: LINEAR_UPDATE_END,
    duration: 765,
    retryCount: 0,
  },
];

// ---------------------------------------------------------------------------
// 5. Mock credentials used by the triage flow
// ---------------------------------------------------------------------------

export const sampleCredentials = [
  {
    id: 'cred-anthropic',
    name: 'Anthropic — Production',
    type: 'llm' as const,
    authType: 'apiKey' as const,
    description: 'Claude API key for agent nodes',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: { apiKey: 'sk-ant-••••••••' },
    lastUsedAt: '2025-04-07T16:32:26Z',
    createdAt: '2025-01-10T09:00:00Z',
    updatedAt: '2025-03-15T11:20:00Z',
  },
  {
    id: 'cred-openai',
    name: 'OpenAI — Production',
    type: 'llm' as const,
    authType: 'apiKey' as const,
    description: 'GPT-4o key for model nodes',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: { apiKey: 'sk-proj-••••••••' },
    lastUsedAt: '2025-04-06T22:10:00Z',
    createdAt: '2025-01-10T09:05:00Z',
    updatedAt: '2025-02-20T14:00:00Z',
  },
  {
    id: 'cred-postgres',
    name: 'PostgreSQL — payment-db',
    type: 'database' as const,
    authType: 'connectionString' as const,
    description: 'Payment service database (read-only replica)',
    isActive: true,
    userId: 'demo-user',
    isShared: false,
    config: { connectionString: 'postgresql://readonly:••••@db.acme.internal:5432/payments' },
    lastUsedAt: '2025-04-07T16:32:11Z',
    createdAt: '2025-02-05T10:30:00Z',
    updatedAt: '2025-03-01T16:00:00Z',
  },
  {
    id: 'cred-github',
    name: 'GitHub — acme org',
    type: 'http-api' as const,
    authType: 'oauth2' as const,
    description: 'GitHub OAuth2 for repo access and PR creation',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: {
      oauth2Provider: 'github',
      accessToken: 'gho_••••••••',
      refreshToken: 'ghr_••••••••',
      tokenType: 'bearer',
      scope: 'repo,read:org',
      expiresAt: '2025-05-07T16:00:00Z',
    },
    lastUsedAt: '2025-04-07T16:32:28Z',
    createdAt: '2025-01-20T13:00:00Z',
    updatedAt: '2025-04-07T16:32:28Z',
  },
  {
    id: 'cred-slack',
    name: 'Slack — Acme Workspace',
    type: 'http-api' as const,
    authType: 'oauth2' as const,
    description: 'Slack bot for #triage and #product-requests channels',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: {
      oauth2Provider: 'slack',
      accessToken: 'xoxb-••••••••',
      tokenType: 'bearer',
      scope: 'chat:write,channels:read',
    },
    lastUsedAt: '2025-04-06T09:45:00Z',
    createdAt: '2025-01-25T11:00:00Z',
    updatedAt: '2025-03-10T08:30:00Z',
  },
  {
    id: 'cred-sentry',
    name: 'Sentry — acme org',
    type: 'http-api' as const,
    authType: 'bearer' as const,
    description: 'Sentry API token for issue search',
    isActive: true,
    userId: 'demo-user',
    isShared: false,
    config: { token: 'sntrys_••••••••' },
    lastUsedAt: '2025-04-07T16:32:14Z',
    createdAt: '2025-02-10T15:00:00Z',
    updatedAt: '2025-02-10T15:00:00Z',
  },
  {
    id: 'cred-aws',
    name: 'AWS — CloudWatch Logs',
    type: 'http-api' as const,
    authType: 'awsSigV4' as const,
    description: 'AWS credentials for CloudWatch Logs Insights queries',
    isActive: true,
    userId: 'demo-user',
    isShared: false,
    config: {
      accessKeyId: 'AKIA••••••••',
      secretAccessKey: '••••••••',
      region: 'us-east-1',
      service: 'logs',
    },
    lastUsedAt: '2025-04-07T16:32:18Z',
    createdAt: '2025-02-15T09:00:00Z',
    updatedAt: '2025-03-20T10:00:00Z',
  },
  {
    id: 'cred-notion',
    name: 'Notion — Acme Workspace',
    type: 'http-api' as const,
    authType: 'bearer' as const,
    description: 'Notion integration token for doc search',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: { token: 'ntn_••••••••' },
    lastUsedAt: '2025-04-07T16:32:20Z',
    createdAt: '2025-03-01T14:00:00Z',
    updatedAt: '2025-03-01T14:00:00Z',
  },
  {
    id: 'cred-pagerduty',
    name: 'PagerDuty — Events API',
    type: 'http-api' as const,
    authType: 'apiKey' as const,
    description: 'PagerDuty Events API v2 routing key',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: { apiKey: 'R0••••••••', paramName: 'routing_key' },
    lastUsedAt: '2025-03-28T03:15:00Z',
    createdAt: '2025-02-20T16:00:00Z',
    updatedAt: '2025-02-20T16:00:00Z',
  },
  {
    id: 'cred-linear',
    name: 'Linear — acme workspace',
    type: 'http-api' as const,
    authType: 'oauth2' as const,
    description: 'Linear OAuth2 for issue creation and updates',
    isActive: true,
    userId: 'demo-user',
    isShared: true,
    config: {
      oauth2Provider: 'linear',
      accessToken: 'lin_api_••••••••',
      tokenType: 'bearer',
      scope: 'read,write',
    },
    lastUsedAt: '2025-04-07T16:32:29Z',
    createdAt: '2025-01-30T12:00:00Z',
    updatedAt: '2025-04-07T16:32:29Z',
  },
];

// ---------------------------------------------------------------------------
// 6. Mock chat messages — assistant helped build the triage flow
// ---------------------------------------------------------------------------

const T = (offset: number) =>
  new Date(Date.parse('2025-04-07T15:00:00Z') + offset * 1000).toISOString();

export const sampleChatMessages = [
  // --- Turn 1: User asks to build the flow ---
  {
    id: 'chat-1',
    flowId: 'flow-triage',
    role: 'user' as const,
    content:
      'I want to build a ticket triage flow. When a Linear webhook comes in, an AI agent should investigate the ticket using our Postgres DB, Sentry, AWS CloudWatch logs, Notion docs, and GitHub. Then route it based on issue type — bug, feature request, or incident — to different handlers.',
    toolMeta: null,
    createdAt: T(0),
  },

  // --- Assistant sets a plan ---
  {
    id: 'chat-2',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'set_plan',
      args: {
        summary: 'Build a Linear ticket triage flow with AI investigation and multi-path routing',
        steps: [
          { index: 0, title: 'Add webhook trigger for Linear events', status: 'done' },
          { index: 1, title: 'Add AI agent node with investigation tools', status: 'done' },
          {
            index: 2,
            title: 'Configure agent tools: Postgres, Sentry, CloudWatch, Notion, GitHub',
            status: 'done',
          },
          { index: 3, title: 'Add switch node to route by issue type', status: 'done' },
          { index: 4, title: 'Add handler nodes for each branch', status: 'done' },
          { index: 5, title: 'Connect all nodes and validate flow', status: 'done' },
        ],
      },
      result: { success: true, data: { planSet: true } },
      status: 'done',
      startedAt: Date.parse(T(2)),
      durationMs: 45,
    },
    createdAt: T(2),
  },

  // --- Assistant creates the flow ---
  {
    id: 'chat-3',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'search_actions',
      args: { query: 'webhook trigger' },
      result: {
        success: true,
        data: {
          actions: [
            { id: 'trigger.webhook', name: 'Webhook Trigger', provider: 'Triggers' },
            { id: 'trigger.cron', name: 'Cron Trigger', provider: 'Triggers' },
          ],
        },
      },
      status: 'done',
      startedAt: Date.parse(T(3)),
      durationMs: 12,
    },
    createdAt: T(3),
  },

  // --- Add webhook trigger ---
  {
    id: 'chat-4',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'trigger.webhook',
        name: 'Linear Webhook',
        referenceId: 'linear_webhook',
      },
      result: {
        success: true,
        data: { nodeId: 's-webhook', type: 'trigger.webhook', name: 'Linear Webhook' },
      },
      status: 'done',
      startedAt: Date.parse(T(4)),
      durationMs: 85,
    },
    createdAt: T(4),
  },

  // --- Add agent node ---
  {
    id: 'chat-5',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'core.agent',
        name: 'Investigation Agent',
        referenceId: 'investigation_agent',
      },
      result: {
        success: true,
        data: { nodeId: 's-agent', type: 'core.agent', name: 'Investigation Agent' },
      },
      status: 'done',
      startedAt: Date.parse(T(5)),
      durationMs: 92,
    },
    createdAt: T(5),
  },

  // --- Find credentials for agent ---
  {
    id: 'chat-6',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'find_credentials_for_action',
      args: { actionId: 'core.agent' },
      result: {
        success: true,
        data: {
          credentials: [
            { id: 'cred-anthropic', name: 'Anthropic — Production', type: 'llm' },
            { id: 'cred-openai', name: 'OpenAI — Production', type: 'llm' },
          ],
        },
      },
      status: 'done',
      startedAt: Date.parse(T(6)),
      durationMs: 18,
    },
    createdAt: T(6),
  },

  // --- Configure agent node ---
  {
    id: 'chat-7',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'configure_agent',
      args: {
        nodeId: 's-agent',
        credentialId: 'cred-openai',
        model: 'gpt-4o',
        taskPrompt: 'Investigate Linear ticket "{{ linear_webhook.title }}"...',
        systemPrompt: 'You are a senior on-call engineer performing ticket triage.',
        maxIterations: 10,
        stopCondition: 'explicit_stop',
      },
      result: { success: true, data: { configured: true } },
      status: 'done',
      startedAt: Date.parse(T(7)),
      durationMs: 110,
    },
    createdAt: T(7),
  },

  // --- Add tools to agent (batch of 5) ---
  {
    id: 'chat-8',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_tool_to_agent',
      args: { nodeId: 's-agent', toolId: 'postgres.execute_query', name: 'Query Database' },
      result: { success: true, data: { instanceId: 'tool-pg', toolId: 'postgres.execute_query' } },
      status: 'done',
      startedAt: Date.parse(T(8)),
      durationMs: 65,
    },
    createdAt: T(8),
  },
  {
    id: 'chat-9',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_tool_to_agent',
      args: { nodeId: 's-agent', toolId: 'sentry.list_issues', name: 'Sentry Issues' },
      result: {
        success: true,
        data: { instanceId: 'tool-sentry', toolId: 'sentry.list_issues' },
      },
      status: 'done',
      startedAt: Date.parse(T(9)),
      durationMs: 58,
    },
    createdAt: T(9),
  },
  {
    id: 'chat-10',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_tool_to_agent',
      args: { nodeId: 's-agent', toolId: 'cloudwatch.start_query', name: 'AWS Log Insights' },
      result: {
        success: true,
        data: { instanceId: 'tool-aws', toolId: 'cloudwatch.start_query' },
      },
      status: 'done',
      startedAt: Date.parse(T(10)),
      durationMs: 62,
    },
    createdAt: T(10),
  },
  {
    id: 'chat-11',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_tool_to_agent',
      args: { nodeId: 's-agent', toolId: 'notion.search', name: 'Search Notion' },
      result: { success: true, data: { instanceId: 'tool-notion', toolId: 'notion.search' } },
      status: 'done',
      startedAt: Date.parse(T(11)),
      durationMs: 55,
    },
    createdAt: T(11),
  },
  {
    id: 'chat-12',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_tool_to_agent',
      args: { nodeId: 's-agent', toolId: 'github.get_file_content', name: 'Read Source File' },
      result: {
        success: true,
        data: { instanceId: 'tool-gh', toolId: 'github.get_file_content' },
      },
      status: 'done',
      startedAt: Date.parse(T(12)),
      durationMs: 60,
    },
    createdAt: T(12),
  },

  // --- Assistant explains progress ---
  {
    id: 'chat-13',
    flowId: 'flow-triage',
    role: 'assistant' as const,
    content:
      "I've set up the webhook trigger and the investigation agent with all 5 tools. Now I'll add the switch node to route based on the issue type the agent identifies.",
    toolMeta: null,
    createdAt: T(13),
  },

  // --- Add switch node ---
  {
    id: 'chat-14',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'core.switch',
        name: 'Route by Issue Type',
        referenceId: 'route_by_issue_type',
        params: {
          matchMode: 'first',
          cases: [
            { slug: 'bug', label: 'Bug', expression: 'investigation.issue_type === "bug"' },
            {
              slug: 'feature',
              label: 'Feature Request',
              expression: 'investigation.issue_type === "feature_request"',
            },
            {
              slug: 'incident',
              label: 'Incident',
              expression: 'investigation.issue_type === "incident"',
            },
          ],
        },
      },
      result: { success: true, data: { nodeId: 's-switch', type: 'core.switch' } },
      status: 'done',
      startedAt: Date.parse(T(14)),
      durationMs: 95,
    },
    createdAt: T(14),
  },

  // --- Add handler nodes ---
  {
    id: 'chat-15',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'github.create_pull_request',
        name: 'Create Fix PR',
        referenceId: 'create_fix_pr',
      },
      result: { success: true, data: { nodeId: 's-gh-pr' } },
      status: 'done',
      startedAt: Date.parse(T(15)),
      durationMs: 78,
    },
    createdAt: T(15),
  },
  {
    id: 'chat-16',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'slack.send_message',
        name: 'Notify #product',
        referenceId: 'notify_product',
      },
      result: { success: true, data: { nodeId: 's-slack-feature' } },
      status: 'done',
      startedAt: Date.parse(T(16)),
      durationMs: 72,
    },
    createdAt: T(16),
  },
  {
    id: 'chat-17',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'http.request',
        name: 'PagerDuty Alert',
        referenceId: 'pagerduty_alert',
      },
      result: { success: true, data: { nodeId: 's-pagerduty' } },
      status: 'done',
      startedAt: Date.parse(T(17)),
      durationMs: 68,
    },
    createdAt: T(17),
  },
  {
    id: 'chat-18',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'add_node',
      args: {
        type: 'slack.send_message',
        name: 'Notify #triage',
        referenceId: 'notify_triage',
      },
      result: { success: true, data: { nodeId: 's-slack-default' } },
      status: 'done',
      startedAt: Date.parse(T(18)),
      durationMs: 70,
    },
    createdAt: T(18),
  },

  // --- Connect all nodes ---
  {
    id: 'chat-19',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-webhook', targetId: 's-agent' },
      result: { success: true, data: { edgeId: 'se-webhook-agent' } },
      status: 'done',
      startedAt: Date.parse(T(19)),
      durationMs: 30,
    },
    createdAt: T(19),
  },
  {
    id: 'chat-20',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-agent', targetId: 's-switch' },
      result: { success: true, data: { edgeId: 'se-agent-switch' } },
      status: 'done',
      startedAt: Date.parse(T(20)),
      durationMs: 28,
    },
    createdAt: T(20),
  },
  {
    id: 'chat-21',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-switch', targetId: 's-gh-pr', sourceHandle: 'bug' },
      result: { success: true, data: { edgeId: 'se-switch-pr' } },
      status: 'done',
      startedAt: Date.parse(T(21)),
      durationMs: 25,
    },
    createdAt: T(21),
  },
  {
    id: 'chat-22',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-switch', targetId: 's-slack-feature', sourceHandle: 'feature' },
      result: { success: true, data: { edgeId: 'se-switch-feature' } },
      status: 'done',
      startedAt: Date.parse(T(22)),
      durationMs: 26,
    },
    createdAt: T(22),
  },
  {
    id: 'chat-23',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-switch', targetId: 's-pagerduty', sourceHandle: 'incident' },
      result: { success: true, data: { edgeId: 'se-switch-incident' } },
      status: 'done',
      startedAt: Date.parse(T(23)),
      durationMs: 24,
    },
    createdAt: T(23),
  },
  {
    id: 'chat-24',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'connect_nodes',
      args: { sourceId: 's-switch', targetId: 's-slack-default', sourceHandle: 'default' },
      result: { success: true, data: { edgeId: 'se-switch-default' } },
      status: 'done',
      startedAt: Date.parse(T(24)),
      durationMs: 27,
    },
    createdAt: T(24),
  },

  // --- Validate flow ---
  {
    id: 'chat-25',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'validate_flow',
      args: {},
      result: { success: true, data: { isValid: true, errors: [], warnings: [] } },
      status: 'done',
      startedAt: Date.parse(T(25)),
      durationMs: 140,
    },
    createdAt: T(25),
  },

  // --- Update plan to mark all done ---
  {
    id: 'chat-26',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'update_plan',
      args: {
        steps: [
          { index: 0, status: 'done' },
          { index: 1, status: 'done' },
          { index: 2, status: 'done' },
          { index: 3, status: 'done' },
          { index: 4, status: 'done' },
          { index: 5, status: 'done' },
        ],
      },
      result: { success: true, data: { updated: true } },
      status: 'done',
      startedAt: Date.parse(T(26)),
      durationMs: 15,
    },
    createdAt: T(26),
  },

  // --- Final assistant message ---
  {
    id: 'chat-27',
    flowId: 'flow-triage',
    role: 'assistant' as const,
    content:
      "Your Linear ticket triage flow is ready! Here's what I built:\n\n" +
      '1. **Linear Webhook** — receives incoming ticket events\n' +
      '2. **Investigation Agent** — an AI agent (GPT-4o) that queries your Postgres DB, searches Sentry for errors, checks AWS CloudWatch logs, searches Notion for runbooks, and reads source files on GitHub to produce a root cause analysis with severity rating\n' +
      "3. **Route by Issue Type** — routes based on the agent's classification:\n" +
      '   - **Bug** → Creates a fix PR on GitHub\n' +
      '   - **Feature Request** → Notifies #product-requests on Slack\n' +
      '   - **Incident** → Triggers a PagerDuty incident for escalation\n' +
      '   - **Default** → Notifies #triage on Slack for manual review\n\n' +
      "The flow validated successfully. You can test it by sending a sample Linear webhook payload, or set up a real webhook in your Linear workspace settings pointing to this flow's trigger URL.",
    toolMeta: null,
    createdAt: T(28),
  },

  // --- User asks a follow-up ---
  {
    id: 'chat-28',
    flowId: 'flow-triage',
    role: 'user' as const,
    content: 'Can you run it with a test payload to make sure everything works?',
    toolMeta: null,
    createdAt: T(60),
  },

  // --- Assistant runs the flow ---
  {
    id: 'chat-29',
    flowId: 'flow-triage',
    role: 'tool' as const,
    content: '',
    toolMeta: {
      toolName: 'run_flow',
      args: {
        inputs: {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'LIN-4821',
            identifier: 'ENG-4821',
            title: 'Payment processing fails with 502 for Stripe webhook handler',
            priority: 1,
            team: { key: 'ENG' },
            labels: [{ name: 'bug' }, { name: 'payments' }],
          },
        },
      },
      result: {
        success: true,
        data: {
          flowRunId: 'run-triage-1',
          status: 'SUCCESS',
          duration: 18345,
          outputs: {
            fix_pr: { number: 4293, html_url: 'https://github.com/acme/platform/pull/4293' },
          },
        },
      },
      status: 'done',
      startedAt: Date.parse(T(62)),
      durationMs: 18400,
    },
    createdAt: T(62),
  },

  // --- Final confirmation ---
  {
    id: 'chat-30',
    flowId: 'flow-triage',
    role: 'assistant' as const,
    content:
      "The test run completed successfully in 18.3 seconds. Here's what happened:\n\n" +
      '- The agent investigated the Stripe webhook 502 issue across all 5 data sources\n' +
      '- It identified a **connection pool exhaustion bug** in `stripe-handler.ts` (missing `finally` block for connection release)\n' +
      '- The switch node correctly classified it as a **bug**\n' +
      '- A fix PR was created: [acme/platform#4293](https://github.com/acme/platform/pull/4293)\n\n' +
      'The skipped branches (feature request, incident, default) behaved correctly — only the bug path executed. You can view the full execution details in the Flow Runs tab.',
    toolMeta: null,
    createdAt: T(82),
  },
];

// ---------------------------------------------------------------------------
// 7. Complete DemoData bundle — ready for <DemoInvect>
// ---------------------------------------------------------------------------

// The DemoData types (ReactFlowData, Flow) come from core DB types which
// are stricter than what static sample data needs. We build a loose object
// and cast once at the boundary — the mock client only serialises values.
export const sampleDemoData: DemoData = {
  flows: [
    {
      id: 'flow-triage',
      name: 'Linear Ticket Triage',
      description: 'AI-powered ticket investigation with multi-path routing',
      isActive: true,
      createdAt: '2025-03-10T12:00:00Z',
      updatedAt: '2025-04-01T16:45:00Z',
    },
    {
      id: 'flow-simple',
      name: 'Text Summarizer',
      description: 'Summarizes user input text using GPT-4o',
      isActive: true,
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-03-20T14:30:00Z',
    },
    {
      id: 'flow-branching',
      name: 'Priority Router',
      description: 'Routes incoming webhooks based on priority level',
      isActive: true,
      createdAt: '2025-02-01T08:00:00Z',
      updatedAt: '2025-03-25T09:15:00Z',
    },
  ] as DemoData['flows'],
  flowReactFlowData: {
    'flow-triage': {
      nodes: showcaseFlowNodes,
      edges: showcaseFlowEdges,
      version: { flowId: 'flow-triage', version: 1 },
      name: 'Linear Ticket Triage',
      isActive: true,
    },
    'flow-simple': {
      nodes: simpleFlowNodes,
      edges: simpleFlowEdges,
      version: { flowId: 'flow-simple', version: 1 },
      name: 'Text Summarizer',
      isActive: true,
    },
    'flow-branching': {
      nodes: branchingFlowNodes,
      edges: branchingFlowEdges,
      version: { flowId: 'flow-branching', version: 1 },
      name: 'Priority Router',
      isActive: true,
    },
  } as unknown as DemoData['flowReactFlowData'],
  nodeDefinitions: sampleNodeDefinitions,
  agentTools: showcaseAgentTools as unknown as DemoData['agentTools'],
  flowRuns: [showcaseFlowRun] as unknown as DemoData['flowRuns'],
  nodeExecutions: {
    'run-triage-1': showcaseNodeExecutions,
  } as unknown as DemoData['nodeExecutions'],
  credentials: sampleCredentials as unknown as DemoData['credentials'],
  chatMessages: {
    'flow-triage': sampleChatMessages,
  },
};
