/**
 * Model resolver — maps `'vendor/model-id'` strings to concrete
 * `LanguageModel` instances using the host-supplied `vendors` map.
 *
 * # Why the host supplies the factories (Workers constraint)
 *
 * Cloudflare Workers disallow runtime resolution of arbitrary module
 * specifiers — the bundler needs to know about every import at build
 * time. Dynamic `import('@ai-sdk/anthropic')` from inside a built
 * library throws `No such module` at runtime even when the host has
 * the package in its `node_modules`, because the library's bundle
 * doesn't reference it statically.
 *
 * The fix: the host statically imports the vendor SDKs it wants and
 * wires factory functions into `aiSdkProvider({ vendors: {...} })`.
 * That gives the host's bundler full visibility into the module
 * graph while keeping this library vendor-agnostic.
 */

import type {
  AiSdkCredential,
  AiSdkProviderOptions,
  AiSdkVendor,
  ParsedModelSpec,
  VendorModelFactory,
} from './types';

/**
 * Parse a model id like `'anthropic/claude-sonnet-4-5'`,
 * `'openrouter/anthropic/claude-sonnet-4-5'`, or `'openai/gpt-5'`.
 *
 * Rule: the first segment before `/` is the vendor. Everything after
 * is the model id as the vendor's SDK expects it (so OpenRouter's
 * `'anthropic/claude-sonnet-4-5'` survives through to OpenRouter's
 * `chat(modelId)` call).
 *
 * Throws on malformed input — callers should validate at the API
 * boundary and surface a 400.
 */
export function parseModelSpec(raw: string): ParsedModelSpec {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('parseModelSpec: model spec must be a non-empty string');
  }
  const slash = raw.indexOf('/');
  if (slash < 0) {
    throw new Error(
      `parseModelSpec: missing vendor prefix in "${raw}" — ` +
        'expected "anthropic/...", "openai/...", "openrouter/...", or "google/..."',
    );
  }
  const vendorStr = raw.slice(0, slash);
  const modelId = raw.slice(slash + 1);
  if (!isKnownVendor(vendorStr)) {
    throw new Error(
      `parseModelSpec: unknown vendor "${vendorStr}" in "${raw}". ` +
        'Known vendors: anthropic, openai, openrouter, google',
    );
  }
  if (modelId.length === 0) {
    throw new Error(`parseModelSpec: missing model id after vendor in "${raw}"`);
  }
  return { vendor: vendorStr, modelId, raw };
}

function isKnownVendor(value: string): value is AiSdkVendor {
  return (
    value === 'anthropic' || value === 'openai' || value === 'openrouter' || value === 'google'
  );
}

/**
 * Resolve a `LanguageModel` instance via the host-supplied vendors
 * map. If the host didn't wire a factory for this vendor we throw a
 * clear "install + wire" error — that's the only failure mode now,
 * since we don't try to dynamically import anything.
 */
export function resolveModel(
  spec: ParsedModelSpec,
  credential: AiSdkCredential,
  vendors: AiSdkProviderOptions['vendors'],
): unknown {
  if (credential.vendor !== spec.vendor) {
    throw new Error(
      `resolveModel: credential vendor "${credential.vendor}" does not match ` +
        `model spec vendor "${spec.vendor}" (model: ${spec.raw}). The credential ` +
        'must be for the same vendor as the model.',
    );
  }
  const factory: VendorModelFactory | undefined = vendors[spec.vendor];
  if (!factory) {
    const installed = Object.keys(vendors).filter((v) => vendors[v as AiSdkVendor]);
    throw new Error(
      `resolveModel: no vendor factory wired for "${spec.vendor}". Add it to the ` +
        `host's \`aiSdkProvider({ vendors: { ${spec.vendor}: ... } })\` config. ` +
        `Currently wired vendors: [${installed.join(', ') || '<none>'}]. ` +
        `Example: \`import { create${capitalise(spec.vendor)} } from '@ai-sdk/${spec.vendor}'\` ` +
        `then wire \`${spec.vendor}: (cred, id) => create${capitalise(spec.vendor)}({ apiKey: cred.apiKey })(id)\`.`,
    );
  }
  return factory(credential, spec.modelId);
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
