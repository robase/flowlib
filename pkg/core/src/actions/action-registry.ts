/**
 * Re-exports the Action Registry from `@flowlib/actions`. Kept here so
 * existing `src/actions/action-registry` imports inside `@flowlib/core`
 * (including the `core/` actions that call `actionToNodeDefinition`)
 * continue to resolve.
 */

export {
  ActionRegistry,
  getGlobalActionRegistry,
  initializeGlobalActionRegistry,
  setGlobalActionRegistry,
  resetGlobalActionRegistry,
  actionToNodeDefinition,
} from '@flowlib/actions/registry';
