/**
 * Canonical node-type aliases for the Flowlib primitives.
 *
 * Every primitive has **two** string ids that mean the same thing at runtime:
 *   - `core.X`       — DB-origin (ReactFlow state, seed fixtures, legacy flows)
 *   - `primitives.X` — SDK-origin (emitted by `defineFlow()` / action definitions)
 *
 * Any code that branches on `node.type` must match *both* variants. A plain
 * `type === 'core.X'` check silently skips SDK-origin flows (and vice versa),
 * producing downstream errors that don't name the root cause — e.g. a fan-out
 * validation that trips because a branching node wasn't recognized.
 *
 * Use the exported sets + predicates instead of hard-coded string equality.
 */

export const INPUT_TYPES: ReadonlySet<string> = new Set(['core.input', 'primitives.input']);
export const OUTPUT_TYPES: ReadonlySet<string> = new Set(['core.output', 'primitives.output']);
export const MODEL_TYPES: ReadonlySet<string> = new Set(['core.model', 'primitives.model']);
export const JAVASCRIPT_TYPES: ReadonlySet<string> = new Set([
  'core.javascript',
  'primitives.javascript',
]);
export const IF_ELSE_TYPES: ReadonlySet<string> = new Set(['core.if_else', 'primitives.if_else']);
export const SWITCH_TYPES: ReadonlySet<string> = new Set(['core.switch', 'primitives.switch']);
export const AGENT_TYPES: ReadonlySet<string> = new Set(['core.agent', 'primitives.agent']);

export const isInputType = (t: string): boolean => INPUT_TYPES.has(t);
export const isOutputType = (t: string): boolean => OUTPUT_TYPES.has(t);
export const isModelType = (t: string): boolean => MODEL_TYPES.has(t);
export const isJavascriptType = (t: string): boolean => JAVASCRIPT_TYPES.has(t);
export const isIfElseType = (t: string): boolean => IF_ELSE_TYPES.has(t);
export const isSwitchType = (t: string): boolean => SWITCH_TYPES.has(t);
export const isAgentType = (t: string): boolean => AGENT_TYPES.has(t);

/** Every primitive type alias across all categories. */
export const ALL_PRIMITIVE_TYPES: ReadonlySet<string> = new Set<string>([
  ...INPUT_TYPES,
  ...OUTPUT_TYPES,
  ...MODEL_TYPES,
  ...JAVASCRIPT_TYPES,
  ...IF_ELSE_TYPES,
  ...SWITCH_TYPES,
  ...AGENT_TYPES,
]);
