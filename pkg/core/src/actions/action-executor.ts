/**
 * Shim — the action executor lives in `@flowlib/actions`. Re-exported here so
 * existing `import { executeActionAsNode } from 'src/actions/action-executor'`
 * call-sites inside core keep working.
 */

export {
  executeActionAsNode,
  executeActionAsTool,
  createToolExecutorForAction,
  coerceJsonStringParams,
} from '@flowlib/actions';
