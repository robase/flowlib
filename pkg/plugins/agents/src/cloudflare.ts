/**
 * `@flowlib/agents/cloudflare` — the Cloudflare-only runtime surface.
 *
 * Everything here imports a Cloudflare SDK (`agents/ai-chat-agent`,
 * `@cloudflare/sandbox`), so it's isolated on its own entry. Cloudflare
 * Worker hosts forward the Durable Object and inject it into the plugin:
 *
 * ```ts
 * // worker entry
 * export { AgentChatDO } from '@flowlib/agents/cloudflare';
 *
 * // flowlib config
 * import { AgentChatDO } from '@flowlib/agents/cloudflare';
 * import { cloudflareSandbox } from '@flowlib/agents/cloudflare';
 * agents({ cloudflareDoClass: AgentChatDO, workspaceProviders: [cloudflareSandbox({ ... })] });
 * ```
 *
 * Express/Node hosts never import this entry — they get the plugin's
 * REST + UI surface from `@flowlib/agents` without the Cloudflare deps.
 */

export { AgentChatDO } from './backend/cloudflare/chat-agent-do';

export {
  cloudflareSandbox,
  buildSandboxName,
} from './backend/workspaces/cloudflare-sandbox/provider';
export type { CloudflareSandboxOptions } from './backend/workspaces/cloudflare-sandbox/provider';

export { cloudflareSandboxClaude } from './backend/workspaces/cloudflare-sandbox-claude/provider';
export type {
  CloudflareSandboxClaudeOptions,
  CloudflareSandboxClaudeProvider,
} from './backend/workspaces/cloudflare-sandbox-claude/provider';
export type {
  ClaudeServerBootOptions,
  ClaudeServerBundle,
  ClaudeServerClient,
  ClaudeServerHandle,
  ClaudeServerLoader,
} from './backend/workspaces/cloudflare-sandbox-claude/handle';
