// ============================================================================
// Flow → Cloudflare Workflow Compiler
//
// Reads an FlowlibDefinition (nodes + edges) and emits a TypeScript source
// file containing a Cloudflare AgentWorkflow (or standalone Workflow) class
// that executes the same logic.
// ============================================================================

import type {
  FlowNode as FlowNodeDefinitions,
  FlowEdge,
  FlowlibDefinition,
} from '@flowlib/core/types';
import {
  isIfElseType,
  isTriggerManualType,
  isOutputType,
  isModelType,
  isAgentType,
} from '@flowlib/primitives';
import type { CompileResult, CompileMetadata, GeneratedFile, CompileTarget } from '../shared/types';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Kahn's topological sort (mirrors GraphService.topologicalSort). */
function topologicalSort(nodes: FlowNodeDefinitions[], edges: FlowEdge[]): string[] {
  const nodeIds = nodes.map((n) => n.id);
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)?.push(e.target);
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) {
      queue.push(id);
    }
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) {
      break;
    }
    result.push(cur);
    for (const nb of adj.get(cur) ?? []) {
      const d = (inDeg.get(nb) ?? 1) - 1;
      inDeg.set(nb, d);
      if (d === 0) {
        queue.push(nb);
      }
    }
  }
  if (result.length !== nodeIds.length) {
    throw new Error('Flow contains a cycle — cannot compile to a linear workflow');
  }
  return result;
}

/** Sanitise a label/referenceId into a valid JS identifier. */
function toIdentifier(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1')
    .replace(/_+/g, '_')
    .replace(/_$/, '')
    .toLowerCase();
}

/** Return the slug used as the key in the nodeOutputs accumulator. */
function nodeSlug(node: FlowNodeDefinitions): string {
  if (node.referenceId) {
    return toIdentifier(node.referenceId);
  }
  if (node.label) {
    return toIdentifier(node.label);
  }
  return toIdentifier(node.id);
}

/** Get upstream node slugs for a given node. */
function getUpstreamSlugs(
  nodeId: string,
  edges: FlowEdge[],
  nodeMap: Map<string, FlowNodeDefinitions>,
): string[] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((e) => {
      const srcNode = nodeMap.get(e.source);
      return srcNode ? nodeSlug(srcNode) : 'unknown';
    });
}

// ── Node-specific code generators ──────────────────────────────────────────

interface StepCodeResult {
  /** Lines of code to emit inside run() */
  lines: string[];
  /** Extra imports needed at the top of the file */
  imports: Set<string>;
  /** Does this step need an AI provider? */
  needsAI: boolean;
}

function compileTriggerManualNode(node: FlowNodeDefinitions, _slug: string): StepCodeResult {
  // Manual trigger nodes forward the flow inputs (with declared defaults
  // already merged in by the runtime — at compile time we just pass through).
  return {
    lines: [
      `    // Node: ${node.label ?? node.id} (manual trigger)`,
      `    const ${nodeSlug(node)} = inputs;`,
      '',
    ],
    imports: new Set(),
    needsAI: false,
  };
}

function compileOutputNode(node: FlowNodeDefinitions, upstreamSlugs: string[]): StepCodeResult {
  const src = upstreamSlugs[0] ?? 'inputs';
  return {
    lines: [`    // Node: ${node.label ?? node.id} (output)`, `    outputs = ${src};`, ''],
    imports: new Set(),
    needsAI: false,
  };
}

function compileModelNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const prompt = node.params.prompt ?? node.params.taskPrompt ?? '""';
  const model = node.params.model ?? 'gpt-4o-mini';
  const systemPrompt = node.params.systemPrompt;

  // Build the incoming data reference
  const dataRef =
    upstreamSlugs.length === 1
      ? upstreamSlugs[0]
      : `{ ${upstreamSlugs.map((s) => `${s}: nodeOutputs["${s}"]`).join(', ')} }`;

  const messages: string[] = [];
  if (systemPrompt) {
    messages.push(
      `        { role: "system" as const, content: resolveTemplate(\`${escapeTemplate(String(systemPrompt))}\`, incomingData) },`,
    );
  }
  messages.push(`        { role: "user" as const, content: resolvedPrompt },`);

  const lines = [
    `    // Node: ${node.label ?? node.id} (core.model)`,
    `    const ${slug} = await step.do("${slug}", async () => {`,
    `      const incomingData = ${upstreamSlugs.length > 0 ? dataRef : '{}'};`,
    `      const resolvedPrompt = resolveTemplate(\`${escapeTemplate(String(prompt))}\`, incomingData);`,
    `      const client = new OpenAI({ apiKey: (this as any).env?.OPENAI_API_KEY ?? "" });`,
    `      const completion = await client.chat.completions.create({`,
    `        model: "${model}",`,
    `        messages: [`,
    ...messages,
    `        ],`,
    `      });`,
    `      return completion.choices[0]?.message?.content ?? "";`,
    `    });`,
    `    nodeOutputs["${slug}"] = ${slug};`,
    '',
  ];

  return { lines, imports: new Set(), needsAI: true };
}

function compileJqNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const query = String(node.params.query ?? '.');
  const src = upstreamSlugs[0] ?? '{}';

  return {
    lines: [
      `    // Node: ${node.label ?? node.id} (core.jq)`,
      `    const ${slug} = await step.do("${slug}", async () => {`,
      `      // JQ query: ${query}`,
      `      return jqTransform(nodeOutputs["${src}"] ?? {}, ${JSON.stringify(query)});`,
      `    });`,
      `    nodeOutputs["${slug}"] = ${slug};`,
      '',
    ],
    imports: new Set(),
    needsAI: false,
  };
}

function compileIfElseNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
  edges: FlowEdge[],
  nodeMap: Map<string, FlowNodeDefinitions>,
  _allOrder: string[],
): StepCodeResult {
  const condition = String(node.params.expression ?? 'true');
  const src = upstreamSlugs[0] ?? '{}';

  // Find true/false branch targets
  const trueEdge = edges.find((e) => e.source === node.id && e.sourceHandle === 'true_output');
  const falseEdge = edges.find((e) => e.source === node.id && e.sourceHandle === 'false_output');

  const lines = [
    `    // Node: ${node.label ?? node.id} (core.if_else)`,
    `    const ${slug}_condition = (() => {`,
    `      const data = nodeOutputs["${src}"] ?? {};`,
    `      return resolveTemplate(\`\${${escapeTemplate(condition)}}\`, data) === "true";`,
    `    })();`,
    '',
  ];

  if (trueEdge) {
    const trueTarget = nodeMap.get(trueEdge.target);
    if (trueTarget) {
      lines.push(`    // True branch → ${trueTarget.label ?? trueTarget.id}`);
    }
  }
  if (falseEdge) {
    const falseTarget = nodeMap.get(falseEdge.target);
    if (falseTarget) {
      lines.push(`    // False branch → ${falseTarget.label ?? falseTarget.id}`);
    }
  }

  lines.push(
    `    nodeOutputs["${slug}"] = nodeOutputs["${src}"];`,
    `    branchConditions["${slug}"] = ${slug}_condition;`,
    '',
  );

  return { lines, imports: new Set(), needsAI: false };
}

function compileHttpRequestNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const url = String(node.params.url ?? '""');
  const method = String(node.params.method ?? 'GET').toUpperCase();

  const dataRef = upstreamSlugs.length === 1 ? `nodeOutputs["${upstreamSlugs[0]}"]` : '{}';

  const lines = [
    `    // Node: ${node.label ?? node.id} (http.request)`,
    `    const ${slug} = await step.do("${slug}", {`,
    `      retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },`,
    `    }, async () => {`,
    `      const incomingData = ${dataRef};`,
    `      const resolvedUrl = resolveTemplate(\`${escapeTemplate(url)}\`, incomingData);`,
  ];

  if (method === 'GET' || method === 'HEAD') {
    lines.push(`      const res = await fetch(resolvedUrl, { method: "${method}" });`);
  } else {
    const body = node.params.body ? String(node.params.body) : '';
    lines.push(
      `      const res = await fetch(resolvedUrl, {`,
      `        method: "${method}",`,
      body
        ? `        body: JSON.stringify(resolveTemplate(\`${escapeTemplate(body)}\`, incomingData)),`
        : `        body: JSON.stringify(incomingData),`,
      `        headers: { "Content-Type": "application/json" },`,
      `      });`,
    );
  }

  lines.push(
    `      if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);`,
    `      return res.json();`,
    `    });`,
    `    nodeOutputs["${slug}"] = ${slug};`,
    '',
  );

  return { lines, imports: new Set(), needsAI: false };
}

function compileTemplateStringNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const template = String(node.params.template ?? '');
  const src = upstreamSlugs[0] ?? '{}';

  return {
    lines: [
      `    // Node: ${node.label ?? node.id} (core.template_string)`,
      `    const ${slug} = await step.do("${slug}", async () => {`,
      `      return resolveTemplate(\`${escapeTemplate(template)}\`, nodeOutputs["${src}"] ?? {});`,
      `    });`,
      `    nodeOutputs["${slug}"] = ${slug};`,
      '',
    ],
    imports: new Set(),
    needsAI: false,
  };
}

function compileAgentNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const taskPrompt = String(node.params.taskPrompt ?? '');
  const systemPrompt = node.params.systemPrompt ? String(node.params.systemPrompt) : null;
  const model = String(node.params.model ?? 'gpt-4o-mini');
  const maxIterations = Number(node.params.maxIterations ?? 10);
  const dataRef = upstreamSlugs.length === 1 ? `nodeOutputs["${upstreamSlugs[0]}"]` : '{}';

  const messages: string[] = [];
  if (systemPrompt) {
    messages.push(
      `        { role: "system" as const, content: resolveTemplate(\`${escapeTemplate(systemPrompt)}\`, incomingData) },`,
    );
  }
  messages.push(`        { role: "user" as const, content: resolvedPrompt },`);

  const lines = [
    `    // Node: ${node.label ?? node.id} (AGENT — iterative tool loop)`,
    `    const ${slug} = await step.do("${slug}", async () => {`,
    `      const incomingData = ${dataRef};`,
    `      const resolvedPrompt = resolveTemplate(\`${escapeTemplate(taskPrompt)}\`, incomingData);`,
    `      const client = new OpenAI({ apiKey: (this as any).env?.OPENAI_API_KEY ?? "" });`,
    `      // Agent iterative loop (max ${maxIterations} iterations)`,
    `      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [`,
    ...messages,
    `      ];`,
    `      for (let i = 0; i < ${maxIterations}; i++) {`,
    `        const completion = await client.chat.completions.create({`,
    `          model: "${model}",`,
    `          messages,`,
    `          // TODO: wire tools from agent's enabledTools config`,
    `        });`,
    `        const choice = completion.choices[0]?.message;`,
    `        if (!choice) break;`,
    `        messages.push(choice);`,
    `        if (choice.tool_calls && choice.tool_calls.length > 0) {`,
    `          // TODO: execute tool calls and append results`,
    `          break; // For now, stop on tool call`,
    `        }`,
    `        if (choice.content) return choice.content;`,
    `      }`,
    `      return messages[messages.length - 1]?.content ?? "";`,
    `    });`,
    `    nodeOutputs["${slug}"] = ${slug};`,
    '',
  ];

  return { lines, imports: new Set(), needsAI: true };
}

function compileGenericActionNode(
  node: FlowNodeDefinitions,
  slug: string,
  upstreamSlugs: string[],
): StepCodeResult {
  const dataRef = upstreamSlugs.length === 1 ? `nodeOutputs["${upstreamSlugs[0]}"]` : '{}';

  return {
    lines: [
      `    // Node: ${node.label ?? node.id} (${node.type})`,
      `    // ⚠️  Action "${node.type}" has no native Cloudflare compiler — using passthrough`,
      `    const ${slug} = await step.do("${slug}", async () => {`,
      `      const incomingData = ${dataRef};`,
      `      // TODO: implement ${node.type} for Cloudflare Workers runtime`,
      `      return incomingData;`,
      `    });`,
      `    nodeOutputs["${slug}"] = ${slug};`,
      '',
    ],
    imports: new Set(),
    needsAI: false,
  };
}

/** Escape backticks and ${} in strings that will be placed inside template literals. */
function escapeTemplate(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// ── Branch-aware ordering ──────────────────────────────────────────────────

/**
 * Determine whether a node sits inside a conditional branch
 * and return the branch condition variable + truthy/falsy direction.
 */
interface BranchGuard {
  conditionVar: string;
  negate: boolean;
}

function getBranchGuard(
  nodeId: string,
  edges: FlowEdge[],
  nodeMap: Map<string, FlowNodeDefinitions>,
): BranchGuard | null {
  // Walk backward to find an if-else parent connected via sourceHandle
  const incomingEdge = edges.find(
    (e) =>
      e.target === nodeId &&
      (e.sourceHandle === 'true_output' || e.sourceHandle === 'false_output'),
  );
  if (!incomingEdge) {
    return null;
  }
  const parentNode = nodeMap.get(incomingEdge.source);
  if (!parentNode || !isIfElseType(parentNode.type)) {
    return null;
  }

  const parentSlug = nodeSlug(parentNode);
  return {
    conditionVar: `branchConditions["${parentSlug}"]`,
    negate: incomingEdge.sourceHandle === 'false_output',
  };
}

// ── Main compiler ──────────────────────────────────────────────────────────

export interface CompileInput {
  definition: FlowlibDefinition;
  flowId: string;
  flowName: string;
  version: number;
  target?: CompileTarget;
  credentialStrategy?: 'env' | 'inline';
}

export function compileFlow(input: CompileInput): CompileResult {
  const {
    definition,
    flowId,
    flowName,
    version,
    target = 'agent-workflow',
    credentialStrategy: _credentialStrategy = 'env',
  } = input;

  const warnings: string[] = [];
  const errors: string[] = [];
  const allImports = new Set<string>();
  const credentialRefs: string[] = [];
  let usesAI = false;
  let hasBranching = false;

  const { nodes, edges } = definition;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Topological sort
  let order: string[];
  try {
    order = topologicalSort(nodes, edges);
  } catch (err) {
    return {
      success: false,
      files: [],
      warnings,
      errors: [(err as Error).message],
      metadata: {
        flowId,
        flowName,
        version,
        nodeCount: nodes.length,
        actionIds: [],
        credentialRefs: [],
        usesAI: false,
        hasBranching: false,
        compiledAt: new Date().toISOString(),
      },
    };
  }

  // Compile each node in order
  const bodyLines: string[] = [];
  const actionIds: string[] = [];

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }

    const slug = nodeSlug(node);
    const upstreamSlugs = getUpstreamSlugs(nodeId, edges, nodeMap);
    actionIds.push(node.type);

    // Track credentials
    if (node.params.credentialId) {
      credentialRefs.push(String(node.params.credentialId));
    }

    // Branch guard wrapping
    const guard = getBranchGuard(nodeId, edges, nodeMap);

    let result: StepCodeResult;

    // Dispatch via predicate helpers so both `core.X` and `primitives.X`
    // variants are handled. Fixed-string types (`core.jq`, `http.request`,
    // text) stay as direct comparisons since they have no SDK alias.
    if (isTriggerManualType(node.type)) {
      result = compileTriggerManualNode(node, slug);
    } else if (isOutputType(node.type)) {
      result = compileOutputNode(node, upstreamSlugs);
    } else if (isModelType(node.type)) {
      result = compileModelNode(node, slug, upstreamSlugs);
    } else if (isIfElseType(node.type)) {
      hasBranching = true;
      result = compileIfElseNode(node, slug, upstreamSlugs, edges, nodeMap, order);
    } else if (isAgentType(node.type)) {
      result = compileAgentNode(node, slug, upstreamSlugs);
    } else if (node.type === 'core.jq') {
      result = compileJqNode(node, slug, upstreamSlugs);
    } else if (node.type === 'core.template_string' || node.type === 'core.text') {
      result = compileTemplateStringNode(node, slug, upstreamSlugs);
    } else if (node.type === 'http.request') {
      result = compileHttpRequestNode(node, slug, upstreamSlugs);
    } else {
      warnings.push(
        `Action "${node.type}" (node "${node.label ?? node.id}") has no native compiler — emitting passthrough`,
      );
      result = compileGenericActionNode(node, slug, upstreamSlugs);
    }

    if (result.needsAI) {
      usesAI = true;
    }
    for (const imp of result.imports) {
      allImports.add(imp);
    }

    // Wrap in branch guard if needed
    if (guard) {
      const condition = guard.negate ? `!${guard.conditionVar}` : guard.conditionVar;
      bodyLines.push(`    if (${condition}) {`);
      bodyLines.push(...result.lines.map((l) => `  ${l}`));
      bodyLines.push(`    }`);
      bodyLines.push('');
    } else {
      bodyLines.push(...result.lines);
    }
  }

  // ── Assemble the full file ────────────────────────────────────────────

  const className = toPascalCase(flowName) + 'Workflow';

  const fileLines: string[] = [
    `// ============================================================`,
    `// Auto-generated by @flowlib/cloudflare-agents`,
    `// Flow: ${flowName} (v${version})`,
    `// Compiled: ${new Date().toISOString()}`,
    `//`,
    `// DO NOT EDIT — regenerate with \`flowlib compile --target cloudflare\``,
    `// ============================================================`,
    '',
  ];

  // Imports — both targets use WorkflowEntrypoint
  fileLines.push(
    `import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';`,
  );

  if (usesAI) {
    fileLines.push(`import OpenAI from 'openai';`);
  }

  for (const imp of allImports) {
    fileLines.push(imp);
  }
  fileLines.push('');

  // Generate typed Env interface
  const envBindings: string[] = [];
  if (target === 'agent-workflow') {
    envBindings.push(`  FlowAgent: DurableObjectNamespace;`);
  }
  envBindings.push(`  FLOW_WORKFLOW: Workflow;`);
  if (usesAI) {
    envBindings.push(`  OPENAI_API_KEY: string;`);
  }
  for (const credRef of new Set(credentialRefs)) {
    const envName = `CREDENTIAL_${credRef.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
    envBindings.push(`  ${envName}: string;`);
  }
  fileLines.push(
    `// ── Types ─────────────────────────────────────────────────────`,
    '',
    `interface Env {`,
    ...envBindings,
    `}`,
    '',
    `type FlowInputs = Record<string, unknown>;`,
    '',
  );

  // Runtime helpers
  fileLines.push(
    `// ── Runtime helpers ────────────────────────────────────────────`,
    '',
    `/**`,
    ` * Resolve Flowlib template expressions: \`{{ expr }}\``,
    ` * In the Cloudflare runtime we evaluate simple property access.`,
    ` */`,
    `function resolveTemplate(template: string, data: Record<string, unknown>): string {`,
    `  return template.replace(/\\{\\{\\s*(.+?)\\s*\\}\\}/g, (_match, expr: string) => {`,
    `    const keys = expr.trim().split('.');`,
    `    let val: unknown = data;`,
    `    for (const k of keys) {`,
    `      if (val == null || typeof val !== 'object') return '';`,
    `      val = (val as Record<string, unknown>)[k];`,
    `    }`,
    `    return val == null ? '' : String(val);`,
    `  });`,
    `}`,
    '',
  );

  // JQ stub if needed
  if (actionIds.includes('core.jq')) {
    fileLines.push(
      `/**`,
      ` * Minimal JQ stub — for full JQ support, add jq-wasm or compile`,
      ` * your JQ queries to JS at build time.`,
      ` */`,
      `function jqTransform(data: unknown, query: string): unknown {`,
      `  if (query === '.') return data;`,
      `  // Simple path access: .foo.bar`,
      `  if (/^\\.[a-zA-Z_][a-zA-Z0-9_.]*$/.test(query)) {`,
      `    const keys = query.slice(1).split('.');`,
      `    let val: unknown = data;`,
      `    for (const k of keys) {`,
      `      if (val == null || typeof val !== 'object') return null;`,
      `      val = (val as Record<string, unknown>)[k];`,
      `    }`,
      `    return val;`,
      `  }`,
      `  // For complex JQ expressions, use jq-wasm at runtime`,
      `  throw new Error(\`Complex JQ query not supported in compiled mode: \${query}\`);`,
      `}`,
      '',
    );
  }

  // Workflow class — both targets use WorkflowEntrypoint with proper types
  fileLines.push(
    `// ── Compiled Workflow ──────────────────────────────────────────`,
    '',
    `export class ${className} extends WorkflowEntrypoint<Env, FlowInputs> {`,
    `  async run(event: WorkflowEvent<FlowInputs>, step: WorkflowStep) {`,
  );

  fileLines.push(
    `    const inputs = event.payload;`,
    `    const nodeOutputs: Record<string, unknown> = {};`,
  );

  if (hasBranching) {
    fileLines.push(`    const branchConditions: Record<string, boolean> = {};`);
  }

  fileLines.push(`    let outputs: unknown = {};`, '');

  // Node execution body
  fileLines.push(...bodyLines);

  // Return
  fileLines.push(`    return outputs;`, `  }`, `}`, '');

  const metadata: CompileMetadata = {
    flowId,
    flowName,
    version,
    nodeCount: nodes.length,
    actionIds: [...new Set(actionIds)],
    credentialRefs: [...new Set(credentialRefs)],
    usesAI,
    hasBranching,
    compiledAt: new Date().toISOString(),
  };

  return {
    success: errors.length === 0,
    files: [{ path: 'src/workflow.ts', content: fileLines.join('\n') }],
    warnings,
    errors,
    metadata,
  };
}

// ── Project scaffolder ─────────────────────────────────────────────────────

export function scaffoldProject(
  compileResult: CompileResult,
  options: {
    projectName?: string;
    flowName: string;
    target?: CompileTarget;
  },
): GeneratedFile[] {
  const projectName = options.projectName ?? toKebabCase(options.flowName) + '-worker';
  const files: GeneratedFile[] = [...compileResult.files];

  // package.json
  const deps: Record<string, string> = {
    wrangler: '^4.0.0',
  };
  if (compileResult.metadata.usesAI) {
    deps['openai'] = '^4.0.0';
  }
  if (options.target === 'agent-workflow') {
    deps['agents'] = '^0.0.1';
  }

  files.push({
    path: 'package.json',
    content: JSON.stringify(
      {
        name: projectName,
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'wrangler dev',
          deploy: 'wrangler deploy',
        },
        dependencies: deps,
        devDependencies: {
          typescript: '^5.8.0',
          '@cloudflare/workers-types': '^4.0.0',
        },
      },
      null,
      2,
    ),
  });

  // wrangler.jsonc
  const wranglerConfig: Record<string, unknown> = {
    name: projectName,
    main: 'src/index.ts',
    compatibility_date: new Date().toISOString().split('T')[0],
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: true },
  };

  if (options.target === 'agent-workflow') {
    wranglerConfig.durable_objects = {
      bindings: [{ name: 'AGENT', class_name: 'FlowAgent' }],
    };
    wranglerConfig.workflows = [
      {
        name: toKebabCase(options.flowName) + '-workflow',
        binding: 'FLOW_WORKFLOW',
        class_name: compileResult.metadata.flowName
          ? toPascalCase(compileResult.metadata.flowName) + 'Workflow'
          : 'FlowWorkflow',
      },
    ];
    wranglerConfig.migrations = [
      {
        tag: 'v1',
        new_sqlite_classes: ['FlowAgent'],
      },
    ];
  } else {
    wranglerConfig.workflows = [
      {
        name: toKebabCase(options.flowName) + '-workflow',
        binding: 'FLOW_WORKFLOW',
        class_name: toPascalCase(options.flowName) + 'Workflow',
      },
    ];
  }

  files.push({
    path: 'wrangler.jsonc',
    content: JSON.stringify(wranglerConfig, null, 2),
  });

  // tsconfig.json for Workers
  files.push({
    path: 'tsconfig.json',
    content: JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ESNext'],
          types: ['@cloudflare/workers-types'],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  });

  // Entry point (src/index.ts)
  const className = toPascalCase(options.flowName) + 'Workflow';

  if (options.target === 'agent-workflow') {
    files.push({
      path: 'src/index.ts',
      content: [
        `import { Agent, routeAgentRequest } from 'agents';`,
        `export { ${className} } from './workflow';`,
        '',
        `interface Env {`,
        `  FlowAgent: DurableObjectNamespace;`,
        `  FLOW_WORKFLOW: Workflow;`,
        compileResult.metadata.usesAI ? `  OPENAI_API_KEY: string;` : '',
        `}`,
        '',
        `export class FlowAgent extends Agent<Env> {`,
        `  async onRequest(request: Request): Promise<Response> {`,
        `    const url = new URL(request.url);`,
        '',
        `    if (url.pathname === '/run' && request.method === 'POST') {`,
        `      const body = await request.json() as Record<string, unknown>;`,
        `      const instance = await this.env.FLOW_WORKFLOW.create({`,
        `        id: crypto.randomUUID(),`,
        `        params: body,`,
        `      });`,
        `      return Response.json({ id: instance.id, status: await instance.status() });`,
        `    }`,
        '',
        `    if (url.pathname === '/status' && url.searchParams.has('id')) {`,
        `      const id = url.searchParams.get('id')!;`,
        `      const instance = await this.env.FLOW_WORKFLOW.get(id);`,
        `      return Response.json({ status: await instance.status() });`,
        `    }`,
        '',
        `    return new Response('Not found', { status: 404 });`,
        `  }`,
        `}`,
        '',
        `export default {`,
        `  async fetch(request: Request, env: Env): Promise<Response> {`,
        `    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 });`,
        `  },`,
        `} satisfies ExportedHandler<Env>;`,
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } else {
    files.push({
      path: 'src/index.ts',
      content: [
        `export { ${className} } from './workflow';`,
        '',
        `interface Env {`,
        `  FLOW_WORKFLOW: Workflow;`,
        compileResult.metadata.usesAI ? `  OPENAI_API_KEY: string;` : '',
        `}`,
        '',
        `export default {`,
        `  async fetch(request: Request, env: Env): Promise<Response> {`,
        `    const url = new URL(request.url);`,
        '',
        `    if (url.pathname === '/run' && request.method === 'POST') {`,
        `      const body = await request.json() as Record<string, unknown>;`,
        `      const instance = await env.FLOW_WORKFLOW.create({ params: body });`,
        `      return Response.json({ id: instance.id, status: 'started' });`,
        `    }`,
        '',
        `    if (url.pathname === '/status' && url.searchParams.has('id')) {`,
        `      const instance = await env.FLOW_WORKFLOW.get(url.searchParams.get('id')!);`,
        `      const status = await instance.status();`,
        `      return Response.json(status);`,
        `    }`,
        '',
        `    return new Response('Not found', { status: 404 });`,
        `  },`,
        `} satisfies ExportedHandler<Env>;`,
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  return files;
}

// ── String utils ───────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toKebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}
