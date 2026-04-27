/**
 * Lazy descriptors for core actions.
 *
 * Mirrors the eager `coreActions` array but defers importing each action
 * module until `load()` is called. Use this in edge-runtime bundles where
 * the eager catalogue exceeds the bundle-size cap.
 *
 * NOTE: the eager `coreActions` export still lives in `./index.ts` for
 * backward compatibility — self-hosted backends should keep using that.
 */

import type { LazyActionDefinition } from '@flowlib/action-kit';

const coreProvider = { id: 'core' };

export const lazyCoreActions: LazyActionDefinition[] = [
  {
    id: 'core.javascript',
    provider: coreProvider,
    load: async () => (await import('./javascript')).javascriptAction,
  },
  {
    id: 'core.input',
    provider: coreProvider,
    load: async () => (await import('./input')).inputAction,
  },
  {
    id: 'core.template_string',
    provider: coreProvider,
    load: async () => (await import('./template-string')).templateStringAction,
  },
  {
    id: 'core.output',
    provider: coreProvider,
    load: async () => (await import('./output')).outputAction,
  },
  {
    id: 'core.if_else',
    provider: coreProvider,
    load: async () => (await import('./if-else')).ifElseAction,
  },
  {
    id: 'core.switch',
    provider: coreProvider,
    load: async () => (await import('./switch')).switchAction,
  },
  {
    id: 'core.model',
    provider: coreProvider,
    load: async () => (await import('./model')).modelAction,
  },
  {
    id: 'core.agent',
    provider: coreProvider,
    load: async () => (await import('./agent')).agentAction,
  },
  {
    id: 'math_eval',
    provider: coreProvider,
    load: async () => (await import('./math-eval')).mathEvalAction,
  },
];
