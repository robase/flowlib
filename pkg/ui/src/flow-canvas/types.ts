/**
 * Flow Canvas — Contract C (types-only surface).
 *
 * These types define the headless-editor contract used by the VSCode
 * extension, embedded hosts, and any future non-router, non-REST consumer
 * of the Flowlib flow editor.
 *
 * Everything here MUST be browser-safe. No runtime code, no zod schemas,
 * no `@flowlib/core` runtime imports — see CLAUDE.md "Frontend/backend
 * type separation".
 */

import type { FlowRun, FlowlibDefinition, NodeExecution } from '@flowlib/core/types';
import type { NodeDefinition } from '../types/node-definition.types';

/**
 * Action metadata consumed by the canvas — the per-action shape the node
 * palette, node-config panel, and agent-tool picker all read.
 *
 * For Phase 0 this is an alias of the existing `NodeDefinition` type so
 * the canvas keeps working with the live `/nodes` payload from the REST
 * backend without a codegen step. Contract D in VSCODE_EXTENSION_TASKS
 * uses a slightly different JSON-Schema-based shape; the adapter for
 * that will live in the codegen lane (L7) and convert JSON Schema →
 * `NodeDefinition` at build time.
 */
export type ActionMetadata = NodeDefinition;

/** Per-node visual execution status the canvas can display. */
export type NodeRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/**
 * Known Flowlib theme tokens. Override any subset through
 * `FlowCanvasProps.themeTokens` to retheme the canvas without
 * modifying `<ThemeProvider>`.
 *
 * Consumers (e.g. the VSCode webview) typically map these to host tokens
 * like `var(--vscode-editor-background)`.
 */
export type ThemeTokenName =
  | '--imp-background'
  | '--imp-foreground'
  | '--imp-muted'
  | '--imp-muted-foreground'
  | '--imp-border'
  | '--imp-card'
  | '--imp-card-foreground'
  | '--imp-primary'
  | '--imp-primary-foreground'
  | '--imp-accent'
  | '--imp-accent-foreground'
  | '--imp-destructive'
  | '--imp-destructive-foreground'
  | '--imp-ring'
  // Allow arbitrary --imp-* tokens without losing IntelliSense on the
  // known ones above.
  | (string & {});

/**
 * Public props for {@link FlowCanvas}. Contract C in
 * VSCODE_EXTENSION_TASKS.md §3.2.
 */
export interface FlowCanvasProps {
  /** Flow definition rendered by the canvas. */
  flow: FlowlibDefinition;

  /**
   * Action/node metadata the canvas uses to render the node palette,
   * config panels, and agent-tool selector. In a connected host this
   * comes from the backend; in an offline host it is a static catalogue.
   */
  actions: ActionMetadata[];

  /** When true the canvas renders in a non-editable preview mode. */
  readonly?: boolean;

  /**
   * Called whenever the user makes an edit that mutates the flow
   * definition (drag a node, connect an edge, change a param). The
   * caller is responsible for persisting the new definition.
   */
  onEdit?: (flow: FlowlibDefinition) => void;

  /**
   * Called when the user requests a run from inside the canvas (the Run
   * button on the toolbar). The caller is responsible for executing the
   * flow out-of-band and (optionally) pushing status back via
   * {@link FlowCanvasProps.nodeRunStatus}.
   */
  onRequestRun?: (inputs: Record<string, unknown>) => void;

  /**
   * Called when the user wants to manage credentials — for example by
   * clicking an action's credential picker. The caller typically opens
   * a credential UI in the host (another webview, a browser tab, etc.).
   */
  onOpenCredentialManager?: () => void;

  /**
   * Optional live-status map for in-flight runs. Keys are node IDs.
   * Pass `undefined` (or omit) for static viewing.
   */
  nodeRunStatus?: Record<string, NodeRunStatus>;

  /**
   * Override any `--imp-*` theme token. Values can be any CSS value,
   * e.g. `'var(--vscode-editor-background)'` or `'red'`. Tokens not
   * listed here fall back to the default theme.
   */
  themeTokens?: Partial<Record<ThemeTokenName, string>>;

  /**
   * Optional className applied to the outermost wrapper element.
   * Useful for sizing the canvas inside a constrained parent.
   */
  className?: string;

  /**
   * Recent runs for this flow, newest first. Drives the Runs view list.
   * The host (e.g. VSCode extension) typically refreshes this whenever
   * a new run completes.
   */
  runs?: FlowRun[];

  /**
   * Per-run node-execution lookup. Drives the Runs view's per-node
   * status overlay and the logs panel. Keys are run ids; values are the
   * full node-execution list for that run.
   */
  nodeExecutionsByRun?: Record<string, NodeExecution[]>;

  /**
   * When set, the canvas switches to the Runs view (and selects this run
   * if non-empty). Pass `null` to navigate back to Edit. Externally
   * driven so the host can route programmatically (e.g. clicking a run
   * in the VSCode sidebar).
   */
  viewRunId?: string | null;

  /**
   * Initial mode the canvas opens in. Defaults to `'edit'`. Useful for
   * deep-link integrations that want to open straight into Runs.
   */
  initialMode?: 'edit' | 'runs';
}
