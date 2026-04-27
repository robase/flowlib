/**
 * Response mappers — transform raw API responses into concise, LLM-friendly text.
 *
 * LLMs work better with:
 * - Flat, readable summaries instead of deeply nested JSON
 * - Relevant fields only (no internal IDs like flowVersion numbers unless useful)
 * - Human-readable dates and durations
 * - Markdown formatting for structure
 * - Truncated large payloads with clear indicators
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatDate(d: unknown): string {
  if (!d) {
    return 'N/A';
  }
  const date = typeof d === 'string' ? new Date(d) : d instanceof Date ? d : null;
  if (!date || isNaN(date.getTime())) {
    return String(d);
  }
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

function durationMs(start: unknown, end: unknown): string {
  if (!start || !end) {
    return 'N/A';
  }
  const s = new Date(start as string).getTime();
  const e = new Date(end as string).getTime();
  const ms = e - s;
  if (isNaN(ms)) {
    return 'N/A';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max) + '…';
}

function jsonCompact(obj: unknown, maxLen = 500): string {
  const s = JSON.stringify(obj);
  if (s.length <= maxLen) {
    return s;
  }
  return s.slice(0, maxLen) + `… (${s.length} chars total)`;
}

// ─── Flow Mappers ────────────────────────────────────────────────────────────

export function mapFlowList(raw: unknown): string {
  const items = extractArray(raw);
  if (items.length === 0) {
    return 'No flows found.';
  }

  const lines = items.map((f: Record<string, unknown>) => {
    const tags = Array.isArray(f.tags) && f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
    return `- **${f.name || 'Untitled'}** (id: \`${f.id}\`)${tags}${f.description ? ` — ${truncate(String(f.description), 100)}` : ''}`;
  });

  return `**${items.length} flow(s):**\n\n${lines.join('\n')}`;
}

export function mapFlow(raw: unknown): string {
  const f = raw as Record<string, unknown>;
  if (!f || !f.id) {
    return JSON.stringify(raw, null, 2);
  }

  const parts = [
    `**${f.name || 'Untitled'}**`,
    `- ID: \`${f.id}\``,
    f.description ? `- Description: ${f.description}` : null,
    f.status ? `- Status: ${f.status}` : null,
    f.createdAt ? `- Created: ${formatDate(f.createdAt)}` : null,
    f.updatedAt ? `- Updated: ${formatDate(f.updatedAt)}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

export function mapFlowDefinition(raw: unknown): string {
  const v = raw as Record<string, unknown>;
  if (!v) {
    return 'No definition found.';
  }

  const def = (v.flowlibDefinition ?? v.definition ?? v) as Record<string, unknown>;
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];

  const parts: (string | null)[] = [
    v.version !== null && v.version !== undefined ? `**Version ${v.version}**` : null,
    v.flowId ? `Flow: \`${v.flowId}\`` : null,
    `**${nodes.length} node(s), ${edges.length} edge(s)**`,
  ];

  // Nodes with full configuration
  if (nodes.length > 0) {
    parts.push('', '## Nodes');
    for (const n of nodes as Array<Record<string, unknown>>) {
      const label = n.label || n.referenceId || n.id;
      parts.push(`\n### \`${label}\``);
      parts.push(`- **type:** ${n.type}`);
      parts.push(`- **id:** \`${n.id}\``);
      if (n.referenceId) {
        parts.push(`- **referenceId:** \`${n.referenceId}\``);
      }

      const params = n.params as Record<string, unknown> | undefined;
      if (params && Object.keys(params).length > 0) {
        parts.push('- **params:**');
        for (const [key, val] of Object.entries(params)) {
          const valStr =
            typeof val === 'string'
              ? val.includes('\n')
                ? `\n  \`\`\`\n  ${val.replace(/\n/g, '\n  ')}\n  \`\`\``
                : val
              : JSON.stringify(val);
          parts.push(`  - \`${key}\`: ${valStr}`);
        }
      }
    }
  }

  // Edges
  if (edges.length > 0) {
    parts.push('', '## Edges');
    const nodeMap = new Map(
      nodes.map((n: Record<string, unknown>) => [n.id, n.label || n.referenceId || n.id]),
    );
    for (const e of edges as Array<Record<string, unknown>>) {
      const from = nodeMap.get(e.source) || e.source;
      const to = nodeMap.get(e.target) || e.target;
      parts.push(`- ${from} → ${to}${e.sourceHandle ? ` (${e.sourceHandle})` : ''}`);
    }
  }

  return parts.filter((p) => p !== null).join('\n');
}

export function mapValidation(raw: unknown): string {
  const r = raw as Record<string, unknown>;
  if (r.valid || r.isValid) {
    return 'Flow definition is **valid**.';
  }
  const errors = (r.errors ?? []) as Array<unknown>;
  return `Flow definition is **invalid** (${errors.length} error(s)):\n${errors.map((e) => `- ${typeof e === 'string' ? e : (e as Record<string, unknown>).message || JSON.stringify(e)}`).join('\n')}`;
}

// ─── Version Mappers ─────────────────────────────────────────────────────────

export function mapVersionList(raw: unknown): string {
  const items = extractArray(raw);
  if (items.length === 0) {
    return 'No versions found.';
  }

  return `**${items.length} version(s):**\n\n${items.map((v: Record<string, unknown>) => `- v${v.version}${v.createdAt ? ` (${formatDate(v.createdAt)})` : ''}${v.description ? ` — ${truncate(String(v.description), 80)}` : ''}`).join('\n')}`;
}

// ─── Run Mappers ─────────────────────────────────────────────────────────────

export function mapRunList(raw: unknown): string {
  const items = extractArray(raw);
  if (items.length === 0) {
    return 'No runs found.';
  }

  const lines = items.slice(0, 25).map((r: Record<string, unknown>) => {
    const status = String(r.status || 'UNKNOWN');
    const icon =
      status === 'SUCCESS' ? '✓' : status === 'FAILED' ? '✗' : status === 'RUNNING' ? '⏳' : '○';
    const dur = durationMs(r.startedAt, r.completedAt);
    const err = r.error ? ` — ${truncate(String(r.error), 60)}` : '';
    return `- ${icon} \`${r.id}\` ${status} (${dur})${err}`;
  });

  const suffix = items.length > 25 ? `\n\n…and ${items.length - 25} more` : '';
  return `**${items.length} run(s):**\n\n${lines.join('\n')}${suffix}`;
}

export function mapRun(raw: unknown): string {
  const r = raw as Record<string, unknown>;
  if (!r || !r.id) {
    return JSON.stringify(raw, null, 2);
  }

  const parts = [
    `**Run \`${r.id}\`**`,
    `- Status: **${r.status}**`,
    `- Flow: \`${r.flowId}\``,
    r.startedAt ? `- Started: ${formatDate(r.startedAt)}` : null,
    r.completedAt
      ? `- Completed: ${formatDate(r.completedAt)} (${durationMs(r.startedAt, r.completedAt)})`
      : null,
    r.error ? `- Error: ${truncate(String(r.error), 200)}` : null,
    r.outputs ? `- Output: ${jsonCompact(r.outputs)}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

export function mapRunStarted(raw: unknown): string {
  const r = raw as Record<string, unknown>;
  return `Flow run started: \`${r.flowRunId || r.id}\` (status: ${r.status || 'RUNNING'})`;
}

// ─── Node Execution Mappers ──────────────────────────────────────────────────

export function mapNodeExecutions(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No node executions found.';
  }

  const lines = items.map((n: Record<string, unknown>) => {
    const status = String(n.status || 'UNKNOWN');
    const icon = status === 'SUCCESS' ? '✓' : status === 'FAILED' ? '✗' : '○';
    const dur = durationMs(n.startedAt, n.completedAt);
    const parts = [`### ${icon} \`${n.nodeId}\` (${n.nodeType}) — ${status} (${dur})`];

    if (n.error) {
      parts.push(`**Error:** ${String(n.error)}`);
    }
    if (n.inputs && Object.keys(n.inputs as object).length > 0) {
      parts.push(`**Input:**\n\`\`\`json\n${JSON.stringify(n.inputs, null, 2)}\n\`\`\``);
    }
    if (n.outputs) {
      parts.push(`**Output:**\n\`\`\`json\n${JSON.stringify(n.outputs, null, 2)}\n\`\`\``);
    }
    return parts.join('\n');
  });

  return `**${items.length} node execution(s):**\n\n${lines.join('\n\n')}`;
}

// ─── Debug Tool Mappers ──────────────────────────────────────────────────────

export function mapTestResult(raw: unknown): string {
  const r = raw as Record<string, unknown>;
  if (r.success === false || r.error) {
    return `**Failed:** ${r.error || 'Unknown error'}`;
  }
  const output = r.output ?? r.result ?? r;
  return `**Result:** ${jsonCompact(output, 1000)}`;
}

// ─── Credential Mappers ──────────────────────────────────────────────────────

export function mapCredentialList(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No credentials found.';
  }

  const lines = items.map(
    (c: Record<string, unknown>) =>
      `- **${c.name}** (id: \`${c.id}\`, type: ${c.type}${c.provider ? `, provider: ${c.provider}` : ''})`,
  );
  return `**${items.length} credential(s):**\n\n${lines.join('\n')}`;
}

// ─── Trigger Mappers ─────────────────────────────────────────────────────────

export function mapTriggerList(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No triggers found.';
  }

  const lines = items.map((t: Record<string, unknown>) => {
    const type = t.type || t.triggerType || 'unknown';
    const enabled = t.enabled !== false ? '' : ' (disabled)';
    return `- **${t.name || type}** (id: \`${t.id}\`, type: ${type})${enabled}`;
  });
  return `**${items.length} trigger(s):**\n\n${lines.join('\n')}`;
}

export function mapTrigger(raw: unknown): string {
  const t = raw as Record<string, unknown>;
  if (!t || !t.id) {
    return JSON.stringify(raw, null, 2);
  }

  const parts = [
    `**Trigger \`${t.id}\`**`,
    `- Type: ${t.type || t.triggerType}`,
    `- Flow: \`${t.flowId}\``,
    t.enabled === false ? '- Status: **disabled**' : '- Status: enabled',
    t.config ? `- Config: ${jsonCompact(t.config)}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

// ─── Node Reference Mappers ──────────────────────────────────────────────────

export function mapNodeList(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No nodes available.';
  }

  // Group by provider
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const node of items as Array<Record<string, unknown>>) {
    const p = node.provider as Record<string, unknown> | undefined;
    const providerName = p ? String(p.name || p.id || 'core') : 'core';
    if (!grouped.has(providerName)) {
      grouped.set(providerName, []);
    }
    grouped.get(providerName)?.push(node);
  }

  const sections: string[] = [
    `**${items.length} node type(s) across ${grouped.size} provider(s):**`,
  ];
  for (const [provider, nodes] of grouped) {
    sections.push(`\n### ${provider} (${nodes.length})`);
    for (const n of nodes) {
      sections.push(
        `- \`${n.id}\` — ${n.name || n.id}${n.description ? `: ${truncate(String(n.description), 80)}` : ''}`,
      );
    }
  }
  return sections.join('\n');
}

// ─── Tool / Agent Mappers ────────────────────────────────────────────────────

export function mapToolExecutions(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No tool executions found.';
  }

  const lines = items.map((t: Record<string, unknown>) => {
    const status = String(t.status ?? 'UNKNOWN');
    const icon = status === 'SUCCESS' ? '✓' : status === 'FAILED' ? '✗' : '○';
    const dur = durationMs(t.startedAt, t.completedAt);
    const parts = [`### ${icon} \`${t.toolId ?? t.toolName}\` — ${status} (${dur})`];
    if (t.arguments) {
      parts.push(`**Arguments:** ${jsonCompact(t.arguments, 400)}`);
    }
    if (t.result !== undefined && t.result !== null) {
      parts.push(`**Result:** ${jsonCompact(t.result, 400)}`);
    }
    if (t.error) {
      parts.push(`**Error:** ${truncate(String(t.error), 200)}`);
    }
    return parts.join('\n');
  });

  return `**${items.length} tool execution(s):**\n\n${lines.join('\n\n')}`;
}

export function mapAgentTools(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No agent tools registered.';
  }
  const lines = items.map((t: Record<string, unknown>) => {
    const category = t.category ? ` [${t.category}]` : '';
    return `- \`${t.id}\`${category} — ${t.name ?? t.id}${
      t.description ? `: ${truncate(String(t.description), 120)}` : ''
    }`;
  });
  return `**${items.length} agent tool(s):**\n\n${lines.join('\n')}`;
}

// ─── Field Options / OAuth2 / SDK Source Mappers ────────────────────────────

export function mapFieldOptions(raw: unknown): string {
  const r = raw as Record<string, unknown>;
  if (!r) {
    return 'No options.';
  }
  const options = Array.isArray(r.options) ? r.options : Array.isArray(raw) ? raw : [];
  if (options.length === 0) {
    return 'No options available (loader may require more dependency values).';
  }
  const lines = (options as Array<Record<string, unknown>>).map(
    (o) => `- \`${o.value}\` — ${o.label ?? o.value}`,
  );
  return `**${options.length} option(s):**\n\n${lines.join('\n')}`;
}

export function mapSdkSource(raw: {
  code: string;
  importedBuilders: string[];
  flowName: string;
  version: string | number;
}): string {
  const parts = [
    `**SDK source for \`${raw.flowName}\`** (version ${raw.version})`,
    `Imported builders: ${raw.importedBuilders.map((b) => `\`${b}\``).join(', ')}`,
    '',
    '```ts',
    raw.code,
    '```',
  ];
  return parts.join('\n');
}

export function mapOAuth2ProviderList(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No OAuth2 providers registered.';
  }
  const lines = (items as Array<Record<string, unknown>>).map((p) => {
    const scopes = Array.isArray(p.defaultScopes) ? ` (scopes: ${p.defaultScopes.join(', ')})` : '';
    return `- **${p.name ?? p.id}** (\`${p.id}\`)${p.docsUrl ? ` — ${p.docsUrl}` : ''}${scopes}`;
  });
  return `**${items.length} OAuth2 provider(s):**\n\n${lines.join('\n')}`;
}

export function mapProviderList(raw: unknown): string {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    return 'No providers found.';
  }

  const lines = items.map(
    (p: Record<string, unknown>) =>
      `- **${p.name || p.id}** (\`${p.id}\`)${p.description ? ` — ${truncate(String(p.description), 80)}` : ''}`,
  );
  return `**${items.length} provider(s):**\n\n${lines.join('\n')}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data;
    }
    if (Array.isArray(obj.items)) {
      return obj.items;
    }
  }
  return [];
}
