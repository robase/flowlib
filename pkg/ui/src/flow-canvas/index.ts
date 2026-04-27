/**
 * `@flowlib/ui/flow-canvas` — headless flow editor exports.
 *
 * See Contract C in `VSCODE_EXTENSION_TASKS.md` §3.2 and Lane L2 brief.
 *
 * Import the CSS entry from `@flowlib/ui/styles` (shared with `<Invect>`)
 * to pick up Tailwind utilities and theme tokens.
 */

export { FlowCanvas } from './FlowCanvas';
export { FlowCanvasProvider } from './FlowCanvasProvider';
export type { FlowCanvasProps, ActionMetadata, NodeRunStatus, ThemeTokenName } from './types';

// Low-level escape hatches — mostly for the VSCode webview to reuse the
// prop-backed client machinery without re-implementing it.
export { InMemoryApiClient } from './InMemoryApiClient';
export type { InMemoryState, InMemoryCallbacks } from './InMemoryApiClient';
export { invectDefinitionToReactFlowData, reactFlowToInvectDefinition } from './flow-adapter';
