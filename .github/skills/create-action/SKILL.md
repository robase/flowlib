---
name: create-action
description: 'Scaffold a new Flowlib provider action from scratch. Use when: creating a new defineAction, adding a new tool/node to a provider, implementing a new API integration action, scaffolding OAuth2 actions, adding actions to existing providers.'
argument-hint: "Provider name and action (e.g. 'stripe create_charge')"
---

# Create Action

Scaffold a complete Flowlib provider action using the `defineAction()` pattern. The resulting action auto-registers as both a **flow node** and an **agent tool**.

## When to Use

- Adding a new action to an existing provider (e.g., `gmail.search_messages`)
- Creating an entirely new provider with its first actions
- Implementing an API integration action with OAuth2 credentials
- Adding a utility action to the core provider

## Procedure

### 1. Determine Provider

Check if the provider already exists in `pkg/core/src/actions/providers.ts`.

- **Existing provider**: Use the existing `ProviderDef` constant
- **New provider**: Create a new `ProviderDef` in `providers.ts` following the [provider template](./references/provider-template.md)

### 2. Create the Action File

Create `pkg/core/src/actions/<provider>/<action-name>.ts` using the appropriate template from [action templates](./references/action-templates.md).

Choose the right template based on the action type:

- **API Read** (GET/list): For fetching data from external APIs
- **API Write** (POST/PUT/DELETE): For creating/updating/deleting via external APIs
- **Core Utility**: For data transformation, logic, or internal operations
- **Trigger**: For flow entry-point nodes

### 3. Register the Action

1. Export the action from the provider barrel `pkg/core/src/actions/<provider>/index.ts`
2. Add to the provider's `[provider]Actions` array in the same barrel
3. If new provider: add the barrel import + spread to `allBuiltinActions` in `pkg/core/src/actions/index.ts`

See [registration checklist](./references/registration-checklist.md) for the exact steps.

### 4. Verify

- Confirm the action ID follows `provider.action_name` format (snake_case)
- Confirm the description includes the API method name and an example response shape (for API actions)
- Confirm the provider has a `docsUrl` in `providers.ts`
- Confirm all param fields have `description` and appropriate `aiProvided` flags
- Run `pnpm typecheck` from the repo root to validate types

## Quality Checklist

Before considering the action complete, verify:

- [ ] Action ID is `provider.action_name` (snake_case, globally unique)
- [ ] `description` is AI-agent-friendly (explains when to use, not just what it does)
- [ ] `description` includes API method reference for external API actions (e.g., "Gmail messages.send")
- [ ] `description` includes example response shape for API actions (2-5 key fields as JSON)
- [ ] Provider has `docsUrl` in `providers.ts`
- [ ] Zod schema validates all params with sensible defaults
- [ ] Each param field has `description`, `label`, and correct `type`
- [ ] `aiProvided: true` on fields the AI agent should populate dynamically
- [ ] `aiProvided: false` on `credentialId` (user must configure this)
- [ ] `extended: true` on optional/advanced fields
- [ ] Credential requirement specifies correct `type`, `oauth2Provider`, and `requiredScopes`
- [ ] Tags include provider name, action verbs, and domain keywords
- [ ] `actionCategory` set to `'read'` or `'write'` as appropriate
- [ ] Error handling returns `{ success: false, error: "descriptive message" }`
- [ ] Action exported from provider barrel and added to `[provider]Actions` array
- [ ] Action included in `allBuiltinActions` (via provider barrel)
