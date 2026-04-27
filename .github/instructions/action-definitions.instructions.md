---
description: 'Enforce quality standards for Flowlib provider action definitions. Use when: editing defineAction() calls, modifying action descriptions, adding params to actions, reviewing action metadata.'
applyTo: 'pkg/core/src/actions/**'
---

# Action Definition Standards

When editing any action file in `pkg/core/src/actions/`, enforce these rules.

## Description Requirements

Every action that wraps an external API **must** have a description that includes:

1. **What it does + API method name** — e.g., "Send an email via Gmail (messages.send)"
2. **When an AI agent should use it** — e.g., "Use when the user wants to send an email"
3. **Example response shape** — A concise JSON block showing 2-5 representative fields from the actual API response

````
'Send an email via Gmail (messages.send). Use when the user wants to compose and send an email.\n\n'
+ 'Example response:\n'
+ '```json\n'
+ '{"id": "msg_123", "threadId": "thread_456", "labelIds": ["SENT"]}\n'
+ '```'
````

Core utility actions (no external API) need only items 1 and 2 — skip the response shape.

## Param Field Requirements

Every param field must have:

- `description` — Explains what the field is for
- `label` — Human-readable label for the config panel
- `type` — Correct field type (`text`, `textarea`, `number`, `boolean`, `select`, `code`, `json`)

For actions used as agent tools:

- `aiProvided: true` on fields the AI should populate dynamically (e.g., `to`, `subject`, `body`)
- `aiProvided: false` on `credentialId` — users configure credentials, not the AI
- `extended: true` on optional/advanced fields to collapse them in the config panel

## Provider docsUrl

The action's provider (in `providers.ts`) must have a `docsUrl` pointing to the official API reference. If it's missing, add it.

## Action ID Format

Action IDs must follow `provider.action_name` format using snake_case: `gmail.send_message`, `stripe.create_charge`, `core.jq`.

## Credential Pattern

OAuth2 actions must specify:

```typescript
credential: {
  required: true,
  type: 'oauth2',
  oauth2Provider: 'provider_name',
  requiredScopes: ['scope1', 'scope2'],
  description: 'Human-readable credential description',
},
```

API key actions use `type: 'api_key'` with `required: true` or `required: false` as appropriate.

## Error Handling

Always return structured errors — never throw from `execute()`:

```typescript
return { success: false, error: 'Descriptive error message with context' };
```

Include the HTTP status code in API error messages: `"Gmail API error (403): Insufficient permissions"`.
