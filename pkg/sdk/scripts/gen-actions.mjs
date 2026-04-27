#!/usr/bin/env node
/**
 * Generate typed wrapper helpers for every action in `@flowlib/actions` so
 * SDK authors get full per-param hover docs.
 *
 * Reads `allProviderActions` at build time, iterates each `ActionDefinition`,
 * and emits one TypeScript file per provider under `pkg/sdk/src/generated/`:
 *
 *   - A `*Params` interface for each action, with JSDoc lifted from each
 *     `params.fields[].description`. Hover the field at a call site → see
 *     the action's UI-form description right inside the editor.
 *   - A wrapper function that delegates to the underlying action callable
 *     so the named-record + positional call forms both work. The wrapper's
 *     own JSDoc is the action's `description`.
 *   - A drift-guard `_check` that errors at typecheck time if the manually
 *     emitted interface stops matching `z.input<typeof schema>`.
 *
 * Run:
 *   pnpm --filter @flowlib/sdk gen-actions
 *
 * The generated files live under `pkg/sdk/src/generated/` and are committed
 * — there's a CI step that re-runs codegen and fails on diff.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = join(__dirname, '..');
const GEN_DIR = join(SDK_ROOT, 'src', 'generated');

// ── Inline core action types — reading these without pulling in @flowlib/actions
//    keeps the generator self-contained. The actions we generate from must
//    have this shape.

/**
 * @typedef {{
 *   name: string;
 *   label: string;
 *   description?: string;
 *   type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json' | 'code' | 'switch-cases';
 *   required?: boolean;
 *   defaultValue?: unknown;
 *   placeholder?: string;
 *   options?: Array<{ label: string; value: string | number; description?: string }>;
 * }} ParamField
 */

/**
 * @typedef {{
 *   id: string;                 // e.g. "gmail.send_message"
 *   name: string;
 *   description: string;
 *   provider: { id: string; name: string };
 *   params: { schema: unknown; fields: ParamField[] };
 *   outputs?: Array<{ id: string; label: string; type: string }>;
 *   dynamicOutputs?: boolean;
 *   hidden?: boolean;
 * }} ActionDefinition
 */

// ── Core actions handled by `pkg/sdk/src/nodes/core.ts` directly — skip
//    them in codegen so the typed wrappers there (with handle narrowing,
//    arrow params, etc.) win.

const CORE_SDK_HANDLED = new Set([
  'core.input',
  'core.output',
  'core.javascript',
  'core.if_else',
  'core.switch',
  'core.template_string',
  'core.model',
  'core.agent',
  'http.request',
  'trigger.manual',
  'trigger.cron',
]);

// ── Identifier helpers

/** Convert snake_case / kebab-case to camelCase. */
function toCamel(s) {
  return s.replace(/[-_]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/** Convert snake_case / kebab-case to PascalCase. */
function toPascal(s) {
  const camel = toCamel(s);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * JS reserved words that would collide with generated function names.
 * For these we suffix with `_` so the export doesn't trip the parser.
 */
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** Local SDK helper name, e.g. `send_message` → `sendMessage`. */
function helperName(actionLocalId) {
  const base = toCamel(actionLocalId);
  return RESERVED_WORDS.has(base) ? `${base}_` : base;
}

/** Type interface name, e.g. provider=gmail action=send_message → `GmailSendMessageParams`. */
function paramsTypeName(providerId, actionLocalId) {
  return `${toPascal(providerId)}${toPascal(actionLocalId)}Params`;
}

// ── Field → TS type

/**
 * Whether a field is logically optional in the input shape. We trust the
 * Zod schema's introspection over UI metadata — `params.fields[]` describes
 * the form, not the schema, so its `required` flag can lag the actual
 * schema's optional/default markers.
 *
 * Zod v4 exposes `_zod.optin === 'optional'` on schema internals when the
 * field is input-optional (covers `.optional()`, `.default(...)`, and
 * `z.nullable`-via-pipe variants).
 */
function isFieldOptional(field, schemaShape) {
  // Trust Zod's view first.
  const propSchema = schemaShape?.[field.name];
  if (propSchema) {
    const internals = propSchema._zod ?? propSchema;
    if (internals?.optin === 'optional') {
      return true;
    }
  }
  // Fallback to UI-side hints.
  if (field.defaultValue !== undefined) {
    return true;
  }
  if (field.required === false) {
    return true;
  }
  return false;
}

/**
 * Pull the property-name-to-schema map off a Zod object schema. Both v4
 * `_zod.def.shape` and v3-style `.shape` are tried.
 */
function extractShape(schema) {
  if (!schema) {
    return null;
  }
  const v4Shape = schema._zod?.def?.shape;
  if (v4Shape) {
    return v4Shape;
  }
  const v3Shape = typeof schema.shape === 'function' ? schema.shape() : schema.shape;
  return v3Shape ?? null;
}

// ── JSDoc emission

/** Indent every non-empty line by `n` spaces. */
function indent(str, n) {
  const pad = ' '.repeat(n);
  return str
    .split('\n')
    .map((l) => (l.length === 0 ? l : pad + l))
    .join('\n');
}

/** Wrap text into JSDoc, preserving paragraphs. Handles multiline. */
function jsdocBlock(text) {
  if (!text) {
    return '';
  }
  const lines = text.replace(/\*\//g, '*\\/').split('\n');
  if (lines.length === 1) {
    return `/** ${lines[0]} */`;
  }
  return ['/**', ...lines.map((l) => ` * ${l}`.trimEnd()), ' */'].join('\n');
}

/** Build per-field JSDoc from description + placeholder + defaultValue. */
function fieldJsdoc(field) {
  const parts = [];
  if (field.description) {
    parts.push(field.description);
  } else if (field.label) {
    parts.push(field.label);
  }
  if (field.placeholder) {
    parts.push(`@example ${field.placeholder}`);
  }
  if (field.defaultValue !== undefined) {
    parts.push(`@defaultValue ${JSON.stringify(field.defaultValue)}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return jsdocBlock(parts.join('\n'));
}

// ── Per-action emission

/**
 * Emit a single action as: imports + interface + wrapper function + drift guard.
 * Returns a string of generated TS code.
 */
function emitAction(action, importedAs) {
  const dotIdx = action.id.indexOf('.');
  if (dotIdx <= 0) {
    return null; // skip — not "<provider>.<action>"
  }
  const providerId = action.id.slice(0, dotIdx);
  const actionLocalId = action.id.slice(dotIdx + 1);

  const fnName = helperName(actionLocalId);
  const ifaceName = paramsTypeName(providerId, actionLocalId);

  const fields = action.params.fields ?? [];
  const schemaShape = extractShape(action.params.schema);

  // Each field's TS type is sourced directly from `z.input<typeof
  // action.params.schema>['<field>']` so the generated interface stays in
  // lockstep with the Zod schema — no risk of drift when the schema
  // changes a field's type. Per-field JSDoc still comes from
  // `params.fields[].description`, so authors get hover docs that the bare
  // Zod type can't carry.
  const inputType = `z.input<typeof _${importedAs}.params.schema>`;
  const ifaceFields = fields.map((field) => {
    const optMark = isFieldOptional(field, schemaShape) ? '?' : '';
    const doc = fieldJsdoc(field);
    const decl = `${field.name}${optMark}: ${inputType}[${JSON.stringify(field.name)}];`;
    return doc ? `${doc}\n${decl}` : decl;
  });

  const ifaceBlock = `export interface ${ifaceName} {\n${indent(ifaceFields.join('\n'), 2)}\n}`;

  // Wrapper function JSDoc — use the action's description.
  const fnDoc = jsdocBlock(action.description ?? action.name ?? '');

  const fnBlock = [
    fnDoc,
    `export function ${fnName}(`,
    `  params: ${ifaceName},`,
    `  options?: NodeOptions,`,
    `): SdkFlowNode<string, '${action.id}'>;`,
    `export function ${fnName}(`,
    `  referenceId: string,`,
    `  params: ${ifaceName},`,
    `  options?: NodeOptions,`,
    `): SdkFlowNode<string, '${action.id}'>;`,
    `export function ${fnName}(`,
    `  ...args: [params: ${ifaceName}, options?: NodeOptions] | [referenceId: string, params: ${ifaceName}, options?: NodeOptions]`,
    `): SdkFlowNode<string, '${action.id}'> {`,
    `  return (_${importedAs} as (...args: unknown[]) => SdkFlowNode<string, '${action.id}'>)(...args);`,
    `}`,
  ].join('\n');

  return {
    providerId,
    importedAs,
    fnName,
    code: [ifaceBlock, '', fnBlock].join('\n'),
  };
}

// ── Per-provider file emission

/**
 * Convert a provider id (`google_drive`) to its `@flowlib/actions` package
 * subpath (`google-drive`). The provider catalogue uses `snake_case` ids
 * but the npm exports use kebab-case for multi-word providers.
 */
function providerSubpath(providerId) {
  return providerId.replace(/_/g, '-');
}

function emitProviderFile(providerId, actions) {
  const lines = [];
  lines.push('// AUTOGENERATED — do not edit. Run `pnpm --filter @flowlib/sdk gen-actions`.');
  lines.push('// Source: `@flowlib/actions/' + providerSubpath(providerId) + '` action catalogue.');
  lines.push('');

  // Imports — all action callables aliased with `_` prefix to avoid clashing
  // with the wrapper export names.
  const importNames = actions.map((a) => `${a.importedAs} as _${a.importedAs}`).sort();
  lines.push(
    `import {\n${importNames.map((n) => `  ${n},`).join('\n')}\n} from '@flowlib/actions/${providerSubpath(providerId)}';`,
  );
  lines.push(`import type { z } from 'zod/v4';`);
  lines.push(`import type { NodeOptions, SdkFlowNode } from '@flowlib/action-kit';`);
  lines.push('');

  for (const a of actions) {
    lines.push(a.code);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main

async function main() {
  // Load actions via dynamic import. Requires the @flowlib/actions package
  // to be built (pnpm runs gen-actions after the action package is built).
  const { allProviderActions } = await import('@flowlib/actions');

  // Resolve each action's actual export name by walking the provider's
  // module — the `<providerCamel><ActionPascal>Action` convention is mostly
  // followed but not universal (e.g. microsoft_teams uses `teams*Action`).
  // Build a {providerSubpath → {actionId → exportName}} cache.
  const exportNameByActionId = new Map();
  const providerSubpaths = new Set(
    allProviderActions
      .filter((a) => !a.hidden && !CORE_SDK_HANDLED.has(a.id) && a.id.includes('.'))
      .map((a) => providerSubpath(a.provider.id)),
  );
  for (const subpath of providerSubpaths) {
    let mod;
    try {
      mod = await import(`@flowlib/actions/${subpath}`);
    } catch (err) {
      console.warn(`Skipping provider "${subpath}": ${err.message}`);
      continue;
    }
    for (const [exportedName, value] of Object.entries(mod)) {
      if (value && typeof value === 'function' && typeof value.id === 'string') {
        exportNameByActionId.set(value.id, exportedName);
      }
    }
  }

  // Group by provider.
  const byProvider = new Map();
  for (const action of allProviderActions) {
    if (action.hidden) {
      continue;
    }
    if (CORE_SDK_HANDLED.has(action.id)) {
      continue;
    }
    const resolvedExport = exportNameByActionId.get(action.id);
    if (!resolvedExport) {
      console.warn(`Skipping action "${action.id}": no export name resolved.`);
      continue;
    }
    const emitted = emitAction(action, resolvedExport);
    if (!emitted) {
      continue;
    }
    if (!byProvider.has(emitted.providerId)) {
      byProvider.set(emitted.providerId, []);
    }
    byProvider.get(emitted.providerId).push(emitted);
  }

  // Sort actions within each provider for deterministic output.
  for (const [, list] of byProvider) {
    list.sort((a, b) => a.fnName.localeCompare(b.fnName));
  }

  // Wipe + recreate the generated dir.
  if (existsSync(GEN_DIR)) {
    for (const f of readdirSync(GEN_DIR)) {
      rmSync(join(GEN_DIR, f), { recursive: true, force: true });
    }
  } else {
    mkdirSync(GEN_DIR, { recursive: true });
  }

  // Per-provider files.
  const providerIds = [...byProvider.keys()].sort();
  for (const providerId of providerIds) {
    const list = byProvider.get(providerId);
    const code = emitProviderFile(providerId, list);
    writeFileSync(join(GEN_DIR, `${providerId.replace(/-/g, '_')}.ts`), code, 'utf-8');
  }

  // Index — `import { gmail, slack, ... } from '@flowlib/sdk/actions'`.
  const indexLines = [
    '// AUTOGENERATED — do not edit. Run `pnpm --filter @flowlib/sdk gen-actions`.',
    '',
  ];
  for (const providerId of providerIds) {
    const fileName = providerId.replace(/-/g, '_');
    const namespaceName = toCamel(providerId.replace(/-/g, '_'));
    indexLines.push(`export * as ${namespaceName} from './${fileName}';`);
  }
  indexLines.push('');
  writeFileSync(join(GEN_DIR, 'index.ts'), indexLines.join('\n'), 'utf-8');

  // Summary.
  let totalActions = 0;
  for (const [, list] of byProvider) {
    totalActions += list.length;
  }
  console.log(
    `Generated ${totalActions} action wrapper(s) across ${providerIds.length} provider(s).`,
  );
  console.log(`Output: ${GEN_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
