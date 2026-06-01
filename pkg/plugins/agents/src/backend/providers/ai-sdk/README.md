# `@flowlib/agents/providers/ai-sdk` — AI SDK provider

Native-DO agent provider that runs the turn loop with Vercel's `ai`
package's `streamText`, with tools dispatched as discrete short calls
(sandbox `containerFetch`, flowlib actions, direct fetches).

Replaces the opencode-in-container provider for chat agents. See
[../../docs/architecture-options.md](../../../../docs/architecture-options.md)
for why, and
[../../docs/migration-plan-ai-sdk.md](../../../../docs/migration-plan-ai-sdk.md)
for the multi-phase migration plan.

## What's here today (Phases 1 + 2 of the plan)

- **`provider.ts`** — `aiSdkProvider(options)` returns an `AgentProvider`
  matching the existing interface. `prompt(input)` lazy-imports `ai`
  and yields `AgentEvent`s by translating `streamText().fullStream`
  chunks. SDK imports happen on first use only.
- **`models.ts`** — `parseModelSpec(raw)` parses `'vendor/model-id'`
  strings; `resolveModel(spec, credential)` lazy-loads the vendor SDK
  (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`,
  `@ai-sdk/google`) and returns a `LanguageModel` instance.
- **`tools.ts`** — `buildToolSet(input)` returns built-in stub tools
  (`echo`, `now`) used for smoke-testing tool dispatch.
- **`sandbox-tools.ts`** — `buildSandboxTools(workspace)` returns a
  catalogue of `WorkspaceHandle`-backed tools: `sandbox.read_file`,
  `sandbox.write_file`, `sandbox.edit_file`, `sandbox.list_files`,
  `sandbox.run_shell`, `sandbox.git`. Each tool is one short
  `containerFetch` — no long-lived RPCs.

## What's pending (Phases 3-6 of the plan)

- **Phase 3** — wire the existing flowlib action registry (Gmail,
  GitHub, Linear, Slack, 200+ more) as agent tools.
- **Phase 4** — flowlib SDK tools: `flowlib.list_flows`,
  `flowlib.save_flow` (with `typecheckSdkSource` validation), etc.
- **Phase 5** — Permission gating: tools that need user approval
  emit `permission-request` events.
- **Phase 6** — Cutover: flip default `provider_id`, delete opencode.

## Host wiring (minimal example)

```ts
import { agents } from '@flowlib/agents';
import { aiSdkProvider, buildAiSdkSandboxTools } from '@flowlib/agents';

agents({
  providers: [
    aiSdkProvider({
      id: 'ai-sdk-claude',
      name: 'Claude (AI SDK)',
      defaultModel: 'anthropic/claude-sonnet-4-5',

      // Required: resolve a credential for the requested vendor.
      // Wire this to your flowlib credentials service so OAuth refresh
      // stays current. The orchestrator calls this once per session
      // and caches the result.
      resolveCredential: async ({ auth, credentialId, vendor }) => {
        const cred = await credentialsService.getDecryptedWithRefresh(
          credentialId ?? defaultCredentialIdForVendor(vendor, auth.orgId),
        );
        return {
          vendor,
          apiKey: cred.config.apiKey,
        };
      },

      // Optional: provide additional tools on top of the stubs. The
      // canonical wiring is `buildAiSdkSandboxTools` from this package,
      // which returns the sandbox.* catalogue. Hosts can compose their
      // own catalogues here.
      tools: async ({ workspace }) => (workspace ? buildAiSdkSandboxTools(workspace) : {}),
    }),
  ],
});
```

## Required peer dependencies (per vendor)

Install only the vendors your sessions actually use:

```bash
pnpm add ai
pnpm add @ai-sdk/anthropic        # if you use 'anthropic/...' models
pnpm add @ai-sdk/openai           # if you use 'openai/...' models
pnpm add @openrouter/ai-sdk-provider  # if you use 'openrouter/...' models
pnpm add @ai-sdk/google           # if you use 'google/...' models
```

Each peer is declared optional in this package's `package.json`. Missing
vendors throw a clear "install this peer" error only when a session
requests a model for that vendor.

## Model id format

Model ids are `'<vendor>/<model-id>'`. Examples:

- `'anthropic/claude-sonnet-4-5'`
- `'openai/gpt-5'`
- `'openrouter/anthropic/claude-sonnet-4-5'` — note the `openrouter/`
  prefix; the part after is the OpenRouter-routed model id
- `'google/gemini-2.5-pro'`

The vendor must match the credential's vendor. Mismatch surfaces as a
`session-end { reason: 'error' }` with a clear message.

## What `prompt()` yields (event mapping)

`streamText().fullStream` chunks are translated to `AgentEvent`s as
follows:

| AI SDK chunk type     | Yielded AgentEvent                                                |
| --------------------- | ----------------------------------------------------------------- |
| `text-delta` / `text` | `{ type: 'text-delta', messageId, text }`                         |
| `tool-call`           | `{ type: 'tool-call', messageId, id, name, input }`               |
| `tool-result`         | `{ type: 'tool-result', messageId, id, output, isError: false }`  |
| `error`               | `{ type: 'session-end', reason: 'error', error }` (terminal)      |
| `finish`              | (sets usage; terminal `message-complete` + `session-end` emitted) |
| _other_               | logged once, ignored — reasoning / step boundaries / etc.         |

After the stream terminates normally, the provider emits
`message-complete` + `session-end { reason: 'completed' }` (or
`'stopped'` if aborted).

## What's intentionally NOT in this provider

- **Chat history persistence** — handled by `AIChatAgent` via
  `cf_agents_state` (DO storage). `listMessages` returns an empty
  array; the orchestrator falls back to the SDK's stored history.
- **Image / multimodal parts** — Phase 1 only forwards text parts.
  Wire-up requires per-vendor multimodal encoding; out of scope.
- **MCP server connections** — capability is `false`. Flowlib actions
  cover the same ground via the action registry → tool bridge
  (Phase 3 of the migration).
- **Tool permission prompts (`canUseTool`)** — Phase 5 will add
  `permission-request` event emission for gated tools.
