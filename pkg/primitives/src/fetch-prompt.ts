import type { ActionExecutionContext, SubmitPromptRequest } from '@flowlib/action-kit';

type SubmitPromptFn = NonNullable<ActionExecutionContext['functions']>['submitPrompt'];

export interface FetchPromptClientOptions {
  // Resolve a credential ID to its raw config (must include apiKey or similar)
  resolveCredential: (credentialId: string) => Promise<Record<string, unknown>>;
  // Override with a custom fetch (e.g. Vercel Workflow's patched fetch)
  fetch?: typeof globalThis.fetch;
}

type PromptResult =
  | { type: 'string'; value: string }
  | { type: 'object'; value: object }
  | { type: 'batch_submitted'; batchJobId: string; nodeId: string; flowRunId: string };

export function createFetchPromptClient(
  options: FetchPromptClientOptions,
): NonNullable<SubmitPromptFn> {
  const fetchFn = options.fetch ?? globalThis.fetch;

  return async (request: SubmitPromptRequest): Promise<PromptResult> => {
    // Resolve the credential to get the API key
    const credentialConfig = request.credentialId
      ? await options.resolveCredential(request.credentialId)
      : {};

    const apiKey = (credentialConfig.apiKey ?? credentialConfig.api_key ?? credentialConfig.key) as
      | string
      | undefined;

    if (!apiKey) {
      throw new Error(
        `fetch-prompt: No API key found in credential "${request.credentialId}". ` +
          `The credential config must contain an "apiKey" field.`,
      );
    }

    const provider = request.provider as string;

    if (provider === 'anthropic') {
      return callAnthropic({ request, apiKey, fetch: fetchFn });
    }

    // Default: OpenAI-compatible (openai, openrouter, etc.)
    return callOpenAI({ request, apiKey, fetch: fetchFn, provider });
  };
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(opts: {
  request: SubmitPromptRequest;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  provider: string;
}): Promise<PromptResult> {
  const { request, apiKey, fetch: fetchFn, provider } = opts;

  const baseUrl =
    provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';

  const messages: Array<{ role: string; content: string }> = [];
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  messages.push({ role: 'user', content: request.prompt });

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    temperature: request.temperature ?? 0.7,
  };

  if (request.maxTokens) {
    body.max_tokens = request.maxTokens;
  }

  if (request.outputJsonSchema) {
    try {
      const schema = JSON.parse(request.outputJsonSchema);
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'output', strict: true, schema },
      };
    } catch {
      // Invalid JSON schema — fall back to plain text
    }
  }

  const res = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = json.choices[0]?.message?.content ?? '';

  // Try to parse as JSON for structured output
  try {
    const parsed = JSON.parse(content);
    return { type: 'object', value: parsed as object };
  } catch {
    return { type: 'string', value: content };
  }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(opts: {
  request: SubmitPromptRequest;
  apiKey: string;
  fetch: typeof globalThis.fetch;
}): Promise<PromptResult> {
  const { request, apiKey, fetch: fetchFn } = opts;

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    messages: [{ role: 'user', content: request.prompt }],
    temperature: request.temperature ?? 0.7,
  };

  if (request.systemPrompt) {
    body.system = request.systemPrompt;
  }

  if (request.outputJsonSchema) {
    try {
      const schema = JSON.parse(request.outputJsonSchema);
      body.tools = [
        {
          name: 'structured_output',
          description: 'Return structured data matching the schema',
          input_schema: schema,
        },
      ];
      body.tool_choice = { type: 'tool', name: 'structured_output' };
    } catch {
      // Invalid JSON schema — fall back to plain text
    }
  }

  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string; input?: unknown }>;
  };

  const block = json.content[0];
  if (!block) {
    throw new Error('Anthropic returned empty content');
  }

  if (block.type === 'tool_use' && block.input !== undefined) {
    return { type: 'object', value: block.input as object };
  }

  const text = block.text ?? '';
  try {
    const parsed = JSON.parse(text);
    return { type: 'object', value: parsed as object };
  } catch {
    return { type: 'string', value: text };
  }
}
