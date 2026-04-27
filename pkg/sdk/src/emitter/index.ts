/**
 * Unified SDK emitter — `InvectDefinition` (DB form) → `@flowlib/sdk` source.
 *
 * Produces TypeScript source that imports from `@flowlib/sdk` and any relevant
 * `@flowlib/actions/<provider>` packages and uses the callable action helpers
 * to rebuild the flow graph. The emitted source is what FlowCodePanel shows,
 * what the chat assistant reads + writes, what copy-paste + git sync produce,
 * and what users hand-author.
 *
 * Round-trip semantics:
 *   - Known action types (core, triggers, http) → typed SDK helpers.
 *   - Provider actions → direct action-callable imports with snake_case ids
 *     mapped to the package's camelCase action export.
 *   - Unknown / plugin-only actions → generic `node(ref, type, params)` fallback.
 *   - String expressions → `(ctx) => ...` arrow bodies with upstream destructured.
 *   - Template strings in output values → template literals or string literals.
 *   - Agent `addedTools` → `tool()` calls (instanceId stripped; merge pipeline
 *     re-assigns by matching against prior version).
 *   - Mapper config → emitted as a `{ mapper: {...} }` NodeOptions entry.
 *   - Positions → emitted as `{ position: {...} }` NodeOptions entry.
 *
 *   - Arrow-to-string on the save side is Phase 4. For now the emitter reads
 *     DB strings and emits arrows; the save path accepts strings back.
 */

import type {
  DbFlowDefinition,
  DbFlowNode,
  DbFlowEdge,
  EmitOptions,
  EmitResult,
  NodeSpan,
} from './types';
import { SdkEmitError } from './types';
import { arrowFromExpression, arrowFromOutputValue } from './expressions';
import { indent, isValidJsIdent, toTsLiteral } from './literals';

export type { EmitOptions, EmitResult, DbFlowDefinition, DbFlowNode, DbFlowEdge, NodeSpan };
export { SdkEmitError };

// ═══════════════════════════════════════════════════════════════════════════
// Type → SDK helper dispatch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Action types known to emit via `@flowlib/sdk`'s friendly helpers. Anything
 * not here falls through to the provider-import path (for action-catalogue
 * actions like `gmail.send_message`) or the generic `node()` fallback.
 */
const SDK_HELPERS: Record<string, string> = {
  'core.input': 'input',
  'core.output': 'output',
  'core.javascript': 'code',
  'core.if_else': 'ifElse',
  'core.switch': 'switchNode',
  'core.template_string': 'template',
  'core.model': 'model',
  'core.agent': 'agent',
  'http.request': 'httpRequest',
  'trigger.manual': 'trigger.manual',
  'trigger.cron': 'trigger.cron',
};

/** SDK-helper names that need a top-level import from `@flowlib/sdk`. */
const SDK_IMPORT_NAMES: Record<string, string> = {
  'core.input': 'input',
  'core.output': 'output',
  'core.javascript': 'code',
  'core.if_else': 'ifElse',
  'core.switch': 'switchNode',
  'core.template_string': 'template',
  'core.model': 'model',
  'core.agent': 'agent',
  'http.request': 'httpRequest',
  'trigger.manual': 'trigger',
  'trigger.cron': 'trigger',
};

// ═══════════════════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════════════════

export function emitSdkSource(def: DbFlowDefinition, options: EmitOptions = {}): EmitResult {
  const flowName = options.flowName ?? 'myFlow';
  const sdkImport = options.sdkImport ?? '@flowlib/sdk';
  const actionsImportRoot = options.actionsImportRoot ?? '@flowlib/actions';
  if (!isValidJsIdent(flowName)) {
    throw new SdkEmitError(`flowName "${flowName}" is not a valid JS identifier`);
  }

  const upstreamByRef = buildUpstreamMap(def.nodes, def.edges);

  // Every `defineFlow(...)` export needs `defineFlow` itself.
  const sdkImports = new Set<string>(['defineFlow']);
  // Action-catalogue imports: { '@flowlib/actions/gmail': Set{ 'gmailSendMessageAction' } }
  const actionImports = new Map<string, Set<string>>();

  // Render each node as a helper-call expression (no leading referenceId,
  // no trailing comma). The composer wraps each one as a named-record
  // entry: `${key}: ${value},`.
  const nodeValues = def.nodes.map((node) => {
    return emitNode(node, { upstreamByRef, sdkImports, actionImports, actionsImportRoot });
  });
  const edgeLines = def.edges.map((e) => emitEdge(e, def.nodes));

  // Compose imports.
  const importLines: string[] = [];
  const sortedSdkImports = [...sdkImports].sort((a, b) => {
    // `defineFlow` always first for readability.
    if (a === 'defineFlow') {
      return -1;
    }
    if (b === 'defineFlow') {
      return 1;
    }
    return a.localeCompare(b);
  });
  importLines.push(`import { ${sortedSdkImports.join(', ')} } from ${JSON.stringify(sdkImport)};`);
  for (const [modulePath, names] of [...actionImports.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sorted = [...names].sort();
    importLines.push(`import { ${sorted.join(', ')} } from ${JSON.stringify(modulePath)};`);
  }

  // Metadata.
  const metadata = options.metadata ?? def.metadata ?? {};
  const metadataLines: string[] = [];
  if (metadata.name !== undefined) {
    metadataLines.push(`  name: ${JSON.stringify(metadata.name)},`);
  }
  if (metadata.description !== undefined) {
    metadataLines.push(`  description: ${JSON.stringify(metadata.description)},`);
  }
  if (metadata.tags !== undefined && metadata.tags.length > 0) {
    metadataLines.push(`  tags: ${JSON.stringify(metadata.tags)},`);
  }

  // Wrap each node value as a named-record entry. Keys that aren't valid
  // JS identifiers (e.g. `"my ref"`, `"42"`) get string-literal quoting.
  const nodeEntryLines = def.nodes.map((node, i) => {
    const ref = node.referenceId ?? node.id;
    const key = isValidJsIdent(ref) ? ref : JSON.stringify(ref);
    return `${key}: ${nodeValues[i]},`;
  });

  const body: string[] = [
    importLines.join('\n'),
    '',
    `export const ${flowName} = defineFlow({`,
    ...metadataLines,
    `  nodes: {`,
    ...nodeEntryLines.map((l) => indent(l, 4)),
    `  },`,
    `  edges: [`,
    ...edgeLines.map((l) => `    ${l},`),
    `  ],`,
    `});`,
    '',
  ];

  let code = body.join('\n');

  if (options.includeJsonFooter) {
    code += `\n/* @flowlib-definition\n${JSON.stringify({ nodes: def.nodes, edges: def.edges, metadata })}\n*/\n`;
  }

  // Compute 1-based line spans for each emitted node. The final code layout is:
  //   lines 1..importLines.length        → import statements
  //   line importLines.length + 1        → blank
  //   line importLines.length + 2        → `export const ${flowName} = defineFlow({`
  //   next metadataLines.length lines    → metadata fields
  //   line after metadata                → `  nodes: {`
  //   then each nodeEntryLines[i] (indented), one per node, possibly multi-line
  const preambleLines =
    importLines.length + // imports
    1 + // blank
    1 + // defineFlow opener
    metadataLines.length + // metadata
    1; // `  nodes: {`

  const nodeSpans: Record<string, NodeSpan> = {};
  let cursor = preambleLines + 1;
  for (let i = 0; i < def.nodes.length; i++) {
    const node = def.nodes[i];
    const ref = node.referenceId ?? node.id;
    const lineCount = nodeEntryLines[i].split('\n').length;
    nodeSpans[ref] = { start: cursor, end: cursor + lineCount - 1 };
    cursor += lineCount;
  }

  return {
    code,
    sdkImports: [...sdkImports],
    actionImports: Object.fromEntries(
      [...actionImports.entries()].map(([k, v]) => [k, [...v].sort()]),
    ),
    nodeSpans,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Node emission
// ═══════════════════════════════════════════════════════════════════════════

interface EmitCtx {
  upstreamByRef: Map<string, string[]>;
  sdkImports: Set<string>;
  actionImports: Map<string, Set<string>>;
  actionsImportRoot: string;
}

/**
 * Emit a single node as a helper-call expression — no leading referenceId,
 * no trailing comma. The composer wraps the result as a named-record entry
 * (`${key}: ${value},`).
 */
function emitNode(node: DbFlowNode, ctx: EmitCtx): string {
  const ref = node.referenceId ?? node.id;
  const upstream = ctx.upstreamByRef.get(ref) ?? [];
  const nodeOptions = buildNodeOptions(node);

  const sdkHelper = SDK_HELPERS[node.type];
  if (sdkHelper) {
    const importName = SDK_IMPORT_NAMES[node.type];
    if (importName) {
      ctx.sdkImports.add(importName);
    }
    return emitKnownNode(node, sdkHelper, ref, upstream, nodeOptions, ctx);
  }

  // Provider actions (core + non-core): look up the provider prefix, emit
  // direct action-callable import.
  const dot = node.type.indexOf('.');
  if (dot > 0) {
    const providerId = node.type.slice(0, dot);
    const actionId = node.type.slice(dot + 1);
    const importName = toActionExportName(providerId, actionId);
    const modulePath = `${ctx.actionsImportRoot}/${providerId}`;
    let set = ctx.actionImports.get(modulePath);
    if (!set) {
      set = new Set();
      ctx.actionImports.set(modulePath, set);
    }
    set.add(importName);
    return emitActionCall(importName, node.params ?? {}, nodeOptions);
  }

  // Truly unknown: generic node() fallback. New no-ref signature is
  // `node(type, params?, options?)`.
  ctx.sdkImports.add('node');
  const paramsLit = toTsLiteral(node.params ?? {});
  const typeLit = JSON.stringify(node.type);
  const parts = [`node(${typeLit}`];
  if (paramsLit !== '{}') {
    parts.push(paramsLit);
  }
  if (nodeOptions !== null) {
    parts.push(nodeOptions);
  }
  return `${parts.join(', ')})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Known-node emission (each handles its own params/arrow conversion)
// ═══════════════════════════════════════════════════════════════════════════

function emitKnownNode(
  node: DbFlowNode,
  sdkHelper: string,
  ref: string,
  upstream: string[],
  nodeOptions: string | null,
  ctx: EmitCtx,
): string {
  const optionsSuffix = nodeOptions === null ? '' : `, ${nodeOptions}`;
  const params = node.params ?? {};

  switch (node.type) {
    case 'core.input': {
      const variableName = params.variableName;
      const defaultValue = params.defaultValue;
      const p: string[] = [];
      // Helper auto-defaults variableName to the referenceId at runtime, so
      // omit the field when it equals the ref.
      if (typeof variableName === 'string' && variableName !== ref) {
        p.push(`variableName: ${JSON.stringify(variableName)}`);
      }
      if (typeof defaultValue === 'string' && defaultValue !== '') {
        p.push(`defaultValue: ${JSON.stringify(defaultValue)}`);
      }
      if (p.length === 0 && !nodeOptions) {
        return `input()`;
      }
      const paramsLit = p.length === 0 ? '{}' : `{ ${p.join(', ')} }`;
      return `input(${paramsLit}${optionsSuffix})`;
    }

    case 'core.output': {
      // Output value: may be `outputValue` (preferred), `output`, `value`, or `template`.
      const raw = params.outputValue ?? params.output ?? params.value ?? params.template ?? '';
      const value = arrowFromOutputValue(raw, upstream);
      const outputName = typeof params.outputName === 'string' ? params.outputName : undefined;
      const nameFragment =
        outputName !== undefined && outputName !== ref
          ? `, name: ${JSON.stringify(outputName)}`
          : '';
      return `output({ value: ${value}${nameFragment} }${optionsSuffix})`;
    }

    case 'core.javascript': {
      const raw = params.code;
      if (typeof raw !== 'string') {
        throw new SdkEmitError(
          `code node "${ref}" is missing params.code (expected string)`,
          node.id,
        );
      }
      const body = arrowFromExpression(raw, upstream);
      return `code({ code: ${body} }${optionsSuffix})`;
    }

    case 'core.if_else': {
      const raw = params.expression;
      // Unconfigured if_else nodes (no expression yet) shouldn't block a copy
      // or full-flow emit. Emit `return null` so the source stays valid —
      // at runtime the node's Zod schema still rejects empty expressions,
      // so a genuinely broken node fails on execute, not on copy.
      const expr = typeof raw === 'string' && raw.trim() !== '' ? raw : 'return null';
      const body = arrowFromExpression(expr, upstream);
      return `ifElse({ condition: ${body} }${optionsSuffix})`;
    }

    case 'core.switch': {
      const rawCases = params.cases;
      if (!Array.isArray(rawCases)) {
        throw new SdkEmitError(
          `switch node "${ref}" is missing params.cases (expected array)`,
          node.id,
        );
      }
      const matchMode = params.matchMode === 'all' ? 'all' : 'first';
      const caseLines = rawCases.map((c, i) => {
        const rec = c as { slug?: unknown; label?: unknown; expression?: unknown };
        if (typeof rec.slug !== 'string' || typeof rec.label !== 'string') {
          throw new SdkEmitError(`switch "${ref}" case[${i}] missing slug/label`, node.id);
        }
        if (typeof rec.expression !== 'string') {
          throw new SdkEmitError(`switch "${ref}" case[${i}] missing expression`, node.id);
        }
        const cond = arrowFromExpression(rec.expression, upstream);
        return `    { slug: ${JSON.stringify(rec.slug)}, label: ${JSON.stringify(rec.label)}, expression: ${cond} },`;
      });
      const lines = [
        `switchNode({`,
        `  matchMode: ${JSON.stringify(matchMode)},`,
        `  cases: [`,
        ...caseLines,
        `  ],`,
        `}${optionsSuffix})`,
      ];
      return lines.join('\n');
    }

    case 'core.template_string': {
      const tmpl = typeof params.template === 'string' ? params.template : '';
      return `template({ template: ${JSON.stringify(tmpl)} }${optionsSuffix})`;
    }

    case 'core.model': {
      return emitActionCall(sdkHelper, params, nodeOptions);
    }

    case 'core.agent': {
      return emitAgent(params, nodeOptions, ctx);
    }

    case 'http.request': {
      return emitActionCall(sdkHelper, params, nodeOptions);
    }

    case 'trigger.manual': {
      const di = params.defaultInputs;
      if (di && typeof di === 'object' && !Array.isArray(di) && Object.keys(di).length > 0) {
        const lit = toTsLiteral({ defaultInputs: di });
        return `trigger.manual(${lit}${optionsSuffix})`;
      }
      return nodeOptions === null
        ? `trigger.manual()`
        : `trigger.manual(undefined, ${nodeOptions})`;
    }

    case 'trigger.cron': {
      const expression = typeof params.expression === 'string' ? params.expression : '';
      const timezone = typeof params.timezone === 'string' ? params.timezone : 'UTC';
      const staticInputs = params.staticInputs;
      const body: Record<string, unknown> = { expression, timezone };
      if (
        staticInputs &&
        typeof staticInputs === 'object' &&
        !Array.isArray(staticInputs) &&
        Object.keys(staticInputs).length > 0
      ) {
        body.staticInputs = staticInputs;
      }
      return `trigger.cron(${toTsLiteral(body)}${optionsSuffix})`;
    }
  }

  // Should not reach here — SDK_HELPERS is exhaustive over the switch.
  throw new SdkEmitError(`unhandled SDK helper "${sdkHelper}" for type "${node.type}"`, node.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent + tool() emission
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_SDK_FIELDS = new Set([
  'credentialId',
  'model',
  'systemPrompt',
  'taskPrompt',
  'messages',
  'temperature',
  'maxTokens',
  'maxIterations',
]);

const TOOL_OPTION_KEYS = ['name', 'description', 'params'] as const;

interface AddedToolLike {
  instanceId?: unknown;
  toolId?: unknown;
  name?: unknown;
  description?: unknown;
  params?: unknown;
}

function emitAgent(
  params: Record<string, unknown>,
  nodeOptions: string | null,
  ctx: EmitCtx,
): string {
  const addedTools = Array.isArray(params.addedTools) ? (params.addedTools as AddedToolLike[]) : [];
  if (addedTools.length > 0) {
    ctx.sdkImports.add('tool');
  }

  const lines: string[] = [];
  lines.push(`agent({`);

  const emitField = (key: string, value: unknown) => {
    lines.push(`  ${key}: ${toTsLiteral(value).replace(/\n/g, '\n  ')},`);
  };

  // SDK-first fields in stable order, then DB-only extras in source order.
  const orderedSdkKeys = [
    'credentialId',
    'model',
    'systemPrompt',
    'taskPrompt',
    'messages',
    'temperature',
    'maxTokens',
    'maxIterations',
  ] as const;
  for (const key of orderedSdkKeys) {
    if (params[key] !== undefined) {
      emitField(key, params[key]);
    }
  }
  for (const [key, value] of Object.entries(params)) {
    if (AGENT_SDK_FIELDS.has(key)) {
      continue;
    }
    if (key === 'addedTools') {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    emitField(key, value);
  }

  if (addedTools.length > 0) {
    lines.push(`  addedTools: [`);
    for (const t of addedTools) {
      lines.push(`    ${emitToolCall(t)},`);
    }
    lines.push(`  ],`);
  }

  // Closing of the agent({ ... }) call. No trailing comma — the composer
  // adds it when wrapping as a named-record entry.
  lines.push(nodeOptions === null ? '})' : `}, ${nodeOptions})`);
  return lines.join('\n');
}

function emitToolCall(t: AddedToolLike): string {
  const toolId = typeof t.toolId === 'string' ? t.toolId : '';
  const name = typeof t.name === 'string' ? t.name : '';
  const description = typeof t.description === 'string' ? t.description : '';
  const rawParams = (t.params && typeof t.params === 'object' ? t.params : {}) as Record<
    string,
    unknown
  >;
  // Drop UI-only _aiChosenModes — runtime doesn't use it.
  const { _aiChosenModes: _drop, ...cleanParams } = rawParams as {
    _aiChosenModes?: unknown;
  } & Record<string, unknown>;

  const options: Record<string, unknown> = {};
  if (name && name !== toolId) {
    options.name = name;
  }
  if (description.length > 0) {
    options.description = description;
  }
  if (Object.keys(cleanParams).length > 0) {
    options.params = cleanParams;
  }

  const idLit = JSON.stringify(toolId);
  if (TOOL_OPTION_KEYS.every((k) => options[k] === undefined)) {
    return `tool(${idLit})`;
  }
  const optionsLit = toTsLiteral(options).replace(/\n/g, '\n    ');
  return `tool(${idLit}, ${optionsLit})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Action-callable emission for known-imports (model, httpRequest)
// ═══════════════════════════════════════════════════════════════════════════

function emitActionCall(
  fnName: string,
  params: Record<string, unknown>,
  nodeOptions: string | null,
): string {
  const paramsLit = toTsLiteral(params);
  const optionsSuffix = nodeOptions === null ? '' : `, ${nodeOptions}`;
  return `${fnName}(${paramsLit}${optionsSuffix})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// NodeOptions (position, label, mapper) emission
// ═══════════════════════════════════════════════════════════════════════════

function buildNodeOptions(node: DbFlowNode): string | null {
  const opts: Record<string, unknown> = {};
  if (node.position) {
    opts.position = node.position;
  }
  if (node.label !== undefined) {
    opts.label = node.label;
  }
  if (node.mapper && typeof node.mapper === 'object') {
    const m = node.mapper as Record<string, unknown>;
    // Skip disabled / empty mappers.
    const enabled = m.enabled !== false;
    const expr = typeof m.expression === 'string' ? m.expression : '';
    if (enabled && expr.length > 0) {
      opts.mapper = node.mapper;
    }
  }
  if (Object.keys(opts).length === 0) {
    return null;
  }
  return toTsLiteral(opts);
}

// ═══════════════════════════════════════════════════════════════════════════
// Edges
// ═══════════════════════════════════════════════════════════════════════════

function emitEdge(edge: DbFlowEdge, nodes: DbFlowNode[]): string {
  const refById = new Map(nodes.map((n) => [n.id, n.referenceId ?? n.id]));
  const sourceRef = refById.get(edge.source);
  const targetRef = refById.get(edge.target);
  if (!sourceRef || !targetRef) {
    throw new SdkEmitError(
      `edge "${edge.id}" references unknown node (source="${edge.source}", target="${edge.target}")`,
    );
  }
  if (edge.sourceHandle) {
    return `{ from: ${JSON.stringify(sourceRef)}, to: ${JSON.stringify(targetRef)}, handle: ${JSON.stringify(edge.sourceHandle)} }`;
  }
  return `{ from: ${JSON.stringify(sourceRef)}, to: ${JSON.stringify(targetRef)} }`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Upstream graph
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a map: targetRef → [upstream refs reachable via incoming edges].
 * Filter to valid JS identifiers so the destructure in arrow bodies is safe.
 */
function buildUpstreamMap(nodes: DbFlowNode[], edges: DbFlowEdge[]): Map<string, string[]> {
  const refById = new Map(nodes.map((n) => [n.id, n.referenceId ?? n.id]));
  const upstream = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceRef = refById.get(edge.source);
    const targetRef = refById.get(edge.target);
    if (!sourceRef || !targetRef) {
      continue;
    }
    if (!isValidJsIdent(sourceRef)) {
      continue;
    }
    const existing = upstream.get(targetRef);
    if (existing) {
      if (!existing.includes(sourceRef)) {
        existing.push(sourceRef);
      }
    } else {
      upstream.set(targetRef, [sourceRef]);
    }
  }
  return upstream;
}

// ═══════════════════════════════════════════════════════════════════════════
// Action import naming
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a provider + action id to the export name the action catalogue uses.
 * Format: `<provider><ActionName>Action` — matches the conventions in
 * `@flowlib/actions/*` (e.g. `gmail.send_message` → `gmailSendMessageAction`).
 */
function toActionExportName(providerId: string, actionId: string): string {
  const providerPart = snakeToCamel(providerId);
  const actionPart = snakeToCamel(actionId);
  const capitalized = actionPart.charAt(0).toUpperCase() + actionPart.slice(1);
  return `${providerPart}${capitalized}Action`;
}

function snakeToCamel(s: string): string {
  return s
    .replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9_$]/g, '_');
}
