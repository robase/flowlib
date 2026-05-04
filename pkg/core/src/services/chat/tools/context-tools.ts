/**
 * Chat Tools — Flow Context & Search
 *
 * Tools for reading flow state and searching available actions.
 * These are read-only tools that help the LLM understand the current context.
 */

import { z } from 'zod/v4';
import type { FlowlibDefinition } from 'src/services/flow-versions/schemas-fresh';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';

// =====================================
// get_current_flow_context
// =====================================

export const getCurrentFlowContextTool: ChatToolDefinition = {
  id: 'get_current_flow_context',
  name: 'Get Current Flow Context',
  description:
    'Get the full flow definition including all nodes, edges, and their configurations. ' +
    'Use this when you need detailed information about specific nodes or the complete flow structure. ' +
    'Optionally filter to a specific node by ID.',
  parameters: z.object({
    nodeId: z.string().optional().describe('Optional: get details for a specific node only'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId } = params as { nodeId?: string };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const version = await flowlib.versions.get(flowId, 'latest');
      if (!version) {
        return { success: false, error: 'No flow version found' };
      }

      const definition = version.flowlibDefinition as FlowlibDefinition;

      if (nodeId) {
        const node =
          definition.nodes.find((n) => n.id === nodeId) ??
          definition.nodes.find((n) => n.referenceId === nodeId);
        if (!node) {
          return { success: false, error: `Node "${nodeId}" not found in flow` };
        }
        return { success: true, data: { node } };
      }

      return {
        success: true,
        data: {
          nodes: definition.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.label,
            referenceId: n.referenceId,
            params: n.params,
            ...(n.mapper ? { mapper: n.mapper } : {}),
          })),
          edges: definition.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to get flow context: ${(error as Error).message}` };
    }
  },
};

// =====================================
// search_actions
// =====================================

export const searchActionsTool: ChatToolDefinition = {
  id: 'search_actions',
  name: 'Search Actions',
  description:
    'Search for available node types (actions) that can be added to a flow. ' +
    'Search by keyword to find integrations like Gmail, Slack, HTTP, etc. ' +
    'Returns action IDs, names, descriptions, and parameter schemas.',
  parameters: z.object({
    query: z.string().describe('Search keyword (e.g. "gmail", "http", "slack", "jq", "model")'),
    limit: z.number().optional().default(10).describe('Max results to return (default 10)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { query, limit } = params as { query: string; limit?: number };
    const flowlib = ctx.flowlib;

    try {
      // Use getAvailableNodes() which returns NodeDefinition[] from both actions and legacy executors
      const allNodes = flowlib.actions.getAvailableNodes();
      // Split query into individual terms for relevance scoring
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const maxResults = limit ?? 10;

      // Score each node: +2 for type/label/provider match, +1 for description/tag match
      const scored = allNodes
        .map((n) => {
          const typeLower = n.type.toLowerCase();
          const labelLower = n.label.toLowerCase();
          const providerLower = (n.provider?.name ?? '').toLowerCase();
          const descLower = (n.description ?? '').toLowerCase();
          const tagsLower = (n.searchTerms ?? []).join(' ').toLowerCase();

          let score = 0;
          for (const term of terms) {
            if (
              typeLower.includes(term) ||
              labelLower.includes(term) ||
              providerLower.includes(term)
            ) {
              score += 2; // Strong match: type, name, or provider
            } else if (descLower.includes(term) || tagsLower.includes(term)) {
              score += 1; // Weaker match: description or tags
            }
          }
          return { node: n, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      const matches = scored.map(({ node: n }) => ({
        actionId: n.type,
        name: n.label,
        description: n.description,
        provider: n.provider?.name,
        params: n.paramFields?.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required,
          description: f.description,
          defaultValue: f.defaultValue,
        })),
      }));

      return {
        success: true,
        data: {
          total: matches.length,
          results: matches,
          hint:
            matches.length === 0
              ? `No actions found for "${query}". Try broader terms like "email", "api", "data".`
              : undefined,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Search failed: ${(error as Error).message}` };
    }
  },
};

// =====================================
// list_credentials
// =====================================

export const listCredentialsTool: ChatToolDefinition = {
  id: 'list_credentials',
  name: 'List Credentials',
  description:
    'List all configured credentials (without sensitive data). ' +
    'Use this to find credential IDs for nodes that need authentication. ' +
    'For OAuth2 credentials, includes the OAuth2 provider ID and granted scopes. ' +
    'Optionally filter by OAuth2 provider or required scopes.',
  parameters: z.object({
    oauth2Provider: z
      .string()
      .optional()
      .describe('Filter by OAuth2 provider ID (e.g. "google", "github", "slack", "microsoft")'),
    requiredScopes: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to credentials that have ALL of these OAuth2 scopes granted ' +
          '(e.g. ["https://www.googleapis.com/auth/gmail.readonly"])',
      ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { oauth2Provider, requiredScopes } = params as {
      oauth2Provider?: string;
      requiredScopes?: string[];
    };
    const flowlib = ctx.flowlib;

    try {
      const credentials = await flowlib.credentials.list(
        oauth2Provider ? { authType: 'oauth2' } : undefined,
      );

      let filtered = credentials;

      // Filter by OAuth2 provider if specified
      if (oauth2Provider) {
        filtered = filtered.filter((c) => {
          const meta = c.metadata as Record<string, unknown> | null;
          return meta?.oauth2Provider === oauth2Provider;
        });
      }

      // Filter by required scopes if specified
      if (requiredScopes && requiredScopes.length > 0) {
        filtered = filtered.filter((c) => {
          const meta = c.metadata as Record<string, unknown> | null;
          const grantedScopes = Array.isArray(meta?.scopes) ? (meta.scopes as string[]) : [];
          return requiredScopes.every((scope) => grantedScopes.includes(scope));
        });
      }

      return {
        success: true,
        data: filtered.map((c) => {
          const meta = c.metadata as Record<string, unknown> | null;
          return {
            id: c.id,
            name: c.name,
            type: c.type,
            authType: c.authType,
            description: c.description,
            ...(c.authType === 'oauth2' && meta
              ? {
                  oauth2Provider: meta.oauth2Provider,
                  grantedScopes: meta.scopes,
                }
              : {}),
          };
        }),
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to list credentials: ${(error as Error).message}` };
    }
  },
};

// =====================================
// find_credentials_for_action
// =====================================

export const findCredentialsForActionTool: ChatToolDefinition = {
  id: 'find_credentials_for_action',
  name: 'Find Credentials for Action',
  description:
    'Find credentials that are compatible with a specific action (node type). ' +
    "Checks the action's credential requirements (OAuth2 provider and scopes) " +
    'against the granted scopes on stored credentials. Returns matching credentials ' +
    'with compatibility info (full match vs partial scopes). ' +
    'Use this before configuring a node to find the right credential, or to check ' +
    'whether the user needs to set up a new credential.',
  parameters: z.object({
    actionId: z
      .string()
      .describe(
        'The action ID to find credentials for (e.g. "gmail.send_message", "slack.send_message")',
      ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { actionId } = params as { actionId: string };
    const flowlib = ctx.flowlib;

    try {
      // Look up the action definition to get credential requirements
      const registry = flowlib.actions.getRegistry();
      const action = registry.get(actionId);

      if (!action) {
        return {
          success: false,
          error: `Action "${actionId}" not found. Use search_actions to find available actions.`,
        };
      }

      if (!action.credential) {
        return {
          success: true,
          data: {
            actionId,
            requiresCredential: false,
            message: `Action "${action.name}" does not require a credential.`,
          },
        };
      }

      const { oauth2Provider, requiredScopes, type: credType } = action.credential;

      // Get all credentials
      const allCredentials = await flowlib.credentials.list(
        credType === 'oauth2' ? { authType: 'oauth2' } : undefined,
      );

      // Match against provider and scopes
      const results = allCredentials
        .map((c) => {
          const meta = c.metadata as Record<string, unknown> | null;
          const credProvider = meta?.oauth2Provider as string | undefined;
          const grantedScopes = Array.isArray(meta?.scopes) ? (meta.scopes as string[]) : [];

          // Provider match
          if (oauth2Provider && credProvider !== oauth2Provider) {
            return null;
          }

          // For non-OAuth2, match by auth type (map action credential types to credential auth types)
          if (credType && credType !== 'oauth2') {
            const authTypeMap: Record<string, string> = {
              api_key: 'apiKey',
              basic_auth: 'basic',
              database: 'connectionString',
              llm: 'apiKey',
            };
            const expectedAuthType = authTypeMap[credType] ?? credType;
            if (c.authType !== expectedAuthType) {
              return null;
            }
          }

          // Scope matching
          let scopeMatch: 'full' | 'partial' | 'none' = 'full';
          let missingScopes: string[] = [];

          if (requiredScopes && requiredScopes.length > 0) {
            missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));
            if (missingScopes.length === 0) {
              scopeMatch = 'full';
            } else if (missingScopes.length < requiredScopes.length) {
              scopeMatch = 'partial';
            } else {
              scopeMatch = 'none';
            }
          }

          return {
            id: c.id,
            name: c.name,
            authType: c.authType,
            description: c.description,
            oauth2Provider: credProvider,
            grantedScopes,
            scopeMatch,
            missingScopes: missingScopes.length > 0 ? missingScopes : undefined,
          };
        })
        .filter(Boolean)
        // Sort: full match first, then partial, then none
        .sort((a, b) => {
          const order = { full: 0, partial: 1, none: 2 };
          return order[a?.scopeMatch ?? 'none'] - order[b?.scopeMatch ?? 'none'];
        });

      const fullMatches = results.filter((r) => r?.scopeMatch === 'full');
      const partialMatches = results.filter((r) => r?.scopeMatch === 'partial');

      return {
        success: true,
        data: {
          actionId,
          actionName: action.name,
          requiresCredential: action.credential.required,
          credentialType: credType,
          oauth2Provider,
          requiredScopes,
          matches: results,
          summary: {
            total: results.length,
            fullMatch: fullMatches.length,
            partialMatch: partialMatches.length,
          },
          hint:
            results.length === 0
              ? `No matching credentials found. Use suggest_credential_setup to guide the user to create one for "${oauth2Provider || credType}".`
              : fullMatches.length > 0
                ? `Found ${fullMatches.length} fully compatible credential(s). Use the credential ID to configure the node.`
                : `Found ${partialMatches.length} credential(s) with partial scope coverage. The user may need to re-authorize with additional scopes.`,
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to find credentials: ${(error as Error).message}`,
      };
    }
  },
};

// =====================================
// suggest_credential_setup
// =====================================

export const suggestCredentialSetupTool: ChatToolDefinition = {
  id: 'suggest_credential_setup',
  name: 'Suggest Credential Setup',
  description:
    'Guide the user to set up a credential through the secure credential UI. ' +
    'NEVER ask users to paste API keys in chat — always use this tool instead.',
  parameters: z.object({
    providerName: z.string().describe('The service name (e.g. "Gmail", "OpenAI", "Slack")'),
    reason: z.string().describe('Why this credential is needed'),
  }),
  async execute(params: unknown, _ctx: ChatToolContext): Promise<ChatToolResult> {
    const { providerName, reason } = params as { providerName: string; reason: string };

    return {
      success: true,
      data: {
        message: `To connect ${providerName}: ${reason}`,
        instructions: 'Click the link below to open the credential setup page.',
      },
      uiAction: {
        action: 'open_credential_setup',
        data: { providerName },
      },
    };
  },
};

// =====================================
// get_action_details
// =====================================

export const getActionDetailsTool: ChatToolDefinition = {
  id: 'get_action_details',
  name: 'Get Action Details',
  description:
    'Get the full definition of a specific action by its ID. ' +
    'Returns the complete parameter schema, field definitions, provider info, and description. ' +
    'Use this when you need to know exactly what parameters a node type expects before adding or configuring it.',
  parameters: z.object({
    actionId: z
      .string()
      .describe('The action ID (e.g. "core.model", "gmail.send_message", "http.request")'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { actionId } = params as { actionId: string };
    const flowlib = ctx.flowlib;

    try {
      const allNodes = flowlib.actions.getAvailableNodes();
      const node = allNodes.find((n) => n.type === actionId);

      if (!node) {
        // Suggest close matches
        const searchLower = actionId.toLowerCase();
        const similar = allNodes
          .filter((n) => n.type.toLowerCase().includes(searchLower.split('.').pop() ?? ''))
          .slice(0, 5)
          .map((n) => n.type);

        return {
          success: false,
          error: `Action "${actionId}" not found`,
          suggestion:
            similar.length > 0
              ? `Did you mean one of: ${similar.join(', ')}?`
              : 'Use search_actions to find available actions.',
        };
      }

      return {
        success: true,
        data: {
          actionId: node.type,
          name: node.label,
          description: node.description,
          provider: node.provider,
          paramFields: node.paramFields?.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            required: f.required,
            description: f.description,
            defaultValue: f.defaultValue,
            options: f.options,
          })),
          outputs: node.outputs,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to get action details: ${(error as Error).message}` };
    }
  },
};

// =====================================
// list_providers
// =====================================

export const listProvidersTool: ChatToolDefinition = {
  id: 'list_providers',
  name: 'List Providers',
  description:
    'List all available integration providers and how many actions each has. ' +
    'Use this to answer "what integrations do you support?" or to discover available services. ' +
    'Follow up with search_actions to find specific actions within a provider.',
  parameters: z.object({}),
  async execute(_params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const flowlib = ctx.flowlib;

    try {
      const providers = flowlib.actions.getProviders();

      return {
        success: true,
        data: {
          total: providers.length,
          providers: providers.map((p) => {
            const actions = flowlib.actions.getForProvider(p.id);
            return {
              id: p.id,
              name: p.name,
              description: p.description,
              icon: p.icon,
              actionCount: actions.length,
              actions: actions.map((a) => a.id),
            };
          }),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to list providers: ${(error as Error).message}` };
    }
  },
};

// =====================================
// test_expression
// =====================================

export const testExpressionTool: ChatToolDefinition = {
  id: 'test_expression',
  name: 'Test Expression',
  description:
    'Evaluate a template expression or JavaScript snippet against sample data in a sandboxed environment. ' +
    'Use this to verify that {{ }} templates or JavaScript code work correctly BEFORE writing them into node params. ' +
    'Supports two modes:\n' +
    '- "template": Evaluates a {{ expr }} template (same engine used in node params)\n' +
    '- "javascript": Evaluates raw JavaScript in a sandboxed QuickJS runtime (same engine used in core.javascript nodes)',
  parameters: z.object({
    type: z
      .enum(['template', 'javascript'])
      .describe('"template" for {{ expr }} strings, "javascript" for raw JS code'),
    expression: z
      .string()
      .describe(
        'The expression to evaluate. For "template": a string with {{ }} blocks (e.g. "{{ users.length }}"). For "javascript": raw JS code.',
      ),
    sampleData: z
      .record(z.string(), z.unknown())
      .describe(
        'Sample data context — keys become available as variables (e.g. { "fetch_users": [...] })',
      ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { type, expression, sampleData } = params as {
      type: 'template' | 'javascript';
      expression: string;
      sampleData: Record<string, unknown>;
    };

    try {
      if (type === 'javascript') {
        const jsResult = await ctx.flowlib.testing.testJsExpression({
          expression,
          context: sampleData,
        });
        if (!jsResult.success) {
          return {
            success: false,
            error: jsResult.error ?? 'Expression evaluation failed',
            suggestion: 'Check for syntax errors or undefined variables.',
          };
        }
        return {
          success: true,
          data: { result: jsResult.result, resultType: typeof jsResult.result },
        };
      }

      // Template mode — extract {{ }} blocks and evaluate each one
      const BLOCK_RE = /\{\{((?:[^}]|\}(?!\}))*)\}\}/g;
      const blocks: string[] = [];
      let m;
      while ((m = BLOCK_RE.exec(expression)) !== null) {
        blocks.push(m[1].trim());
      }

      if (blocks.length === 0) {
        return {
          success: true,
          data: {
            result: expression,
            note: 'No {{ }} expressions found — the string is a literal value.',
          },
        };
      }

      // Test each expression block
      const results: Array<{ expression: string; result?: unknown; error?: string }> = [];
      for (const block of blocks) {
        const jsResult = await ctx.flowlib.testing.testJsExpression({
          expression: block,
          context: sampleData,
        });
        results.push({
          expression: `{{ ${block} }}`,
          ...(jsResult.success ? { result: jsResult.result } : { error: jsResult.error }),
        });
      }

      const allOk = results.every((r) => !r.error);

      // For a single pure expression, return the result directly
      if (blocks.length === 1 && allOk) {
        return {
          success: true,
          data: { result: results[0].result, resultType: typeof results[0].result },
        };
      }

      return {
        success: allOk,
        data: { expressionResults: results },
        ...(allOk ? {} : { error: 'One or more template expressions failed — see details.' }),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Expression evaluation failed: ${(error as Error).message}`,
      };
    }
  },
};

// =====================================
// Export all context tools
// =====================================

export const contextTools: ChatToolDefinition[] = [
  getCurrentFlowContextTool,
  searchActionsTool,
  listCredentialsTool,
  findCredentialsForActionTool,
  suggestCredentialSetupTool,
  getActionDetailsTool,
  listProvidersTool,
  testExpressionTool,
];
