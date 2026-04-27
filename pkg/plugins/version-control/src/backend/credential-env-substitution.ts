/**
 * Credential-env substitution for committed flow files.
 *
 * Emitted `.flow.ts` files carry raw credential ids (`credentialId: "cred_openai_abc"`)
 * in both the human-readable section and the `/* @flowlib-definition *\/`
 * footer. Raw ids are DB-instance-specific UUIDs — committing them means the
 * file isn't portable across Flowlib instances, and seeing `cred_xxx` in a PR
 * diff trips the "is this a leaked secret?" instinct even though the ID
 * itself isn't secret.
 *
 * This helper rewrites the human-readable section only — the JSON footer
 * stays untouched and authoritative, so pulls continue to work without any
 * reverse transform on the receiving end:
 *
 *   credentialId: "cred_openai_abc"  →  credentialId: "{{env.OPENAI_ABC_CREDENTIAL}}"
 *
 * The env-name derivation strips `cred_` / `cred-` prefixes, drops trailing
 * digit runs (`_123`, `-abc_123`), uppercases, and appends `_CREDENTIAL`.
 * Callers that want different naming can pass `options.deriveEnvName`.
 */

const FOOTER_START = '/* @flowlib-definition';

export interface SubstitutionOptions {
  /** Override the default env-name derivation from credential id. */
  deriveEnvName?: (credentialId: string) => string;
}

/**
 * Replace raw `credentialId: "cred_xxx"` occurrences in the human-readable
 * section of an emitted `.flow.ts` file with `{{env.NAME}}` template refs.
 *
 * The JSON footer (everything from `/* @flowlib-definition` onward) is left
 * untouched. If no footer is present, the whole content is treated as
 * human-readable.
 */
export function substituteCredentialEnvs(
  content: string,
  options: SubstitutionOptions = {},
): string {
  const deriveEnvName = options.deriveEnvName ?? defaultDeriveEnvName;

  // Split on the footer marker — the substitution only applies to the
  // section before it. Preserves the footer verbatim.
  const footerIdx = content.indexOf(FOOTER_START);
  const human = footerIdx === -1 ? content : content.slice(0, footerIdx);
  const footer = footerIdx === -1 ? '' : content.slice(footerIdx);

  const rewritten = human.replace(
    // Matches `credentialId: "cred_xxx"` or `credentialId: 'cred_xxx'`.
    // Already-substituted `{{env.XXX}}` values are skipped (start with `{{`).
    // The value can appear in either the agent tool's params, a node's
    // params, or the model action — all stored as string literals by the
    // emitter so a single regex catches every site.
    /(\bcredentialId:\s*)(["'])((?!\{\{)[^"'\s]+)\2/g,
    (_match, prefix: string, quote: string, value: string) => {
      const envName = deriveEnvName(value);
      return `${prefix}${quote}{{env.${envName}}}${quote}`;
    },
  );

  return rewritten + footer;
}

/**
 * Default env-name derivation.
 *
 *   "cred_openai_abc"   → "OPENAI_ABC_CREDENTIAL"
 *   "cred_openai_abc_7" → "OPENAI_ABC_CREDENTIAL"
 *   "cred-anthropic"    → "ANTHROPIC_CREDENTIAL"
 *   "openai-prod-1"     → "OPENAI_PROD_CREDENTIAL"
 *   ""                  → "CREDENTIAL"
 */
export function defaultDeriveEnvName(credentialId: string): string {
  const stripped = credentialId
    .replace(/^cred[_-]?/i, '')
    .replace(/[_-]?\d+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return stripped ? `${stripped}_CREDENTIAL` : 'CREDENTIAL';
}
