/**
 * Runtime resolver for the action catalogue.
 *
 * Two sources:
 *   - **static** — `webview/static-action-catalogue.json`, generated at build
 *     time from `@flowlib/actions` (see `scripts/build-action-catalogue.ts`).
 *     Imported as a JSON module so it inlines into the host bundle (and the
 *     webview bundle) without any runtime fetch.
 *   - **live** — set by L10's `BackendClient` after a successful `GET /actions`
 *     against a connected backend. Empty until the user connects.
 *
 * `snapshot()` returns the live catalogue if present, otherwise the static
 * fallback. Callers (the `FlowEditorProvider#init` payload, the action picker)
 * read this on every send so connect/disconnect transitions are reflected
 * the next time a webview is opened or refreshed.
 */

import type { ActionMetadata } from '@flowlib/ui/flow-canvas';
// JSON module — bundlers inline this. Don't import @flowlib/actions here:
// that pulls Node-only deps the webview can't tolerate.
import staticCatalogue from '../../webview/static-action-catalogue.json';

export class ActionCatalogue {
  private live: ActionMetadata[] | null = null;

  /** Returns the live catalogue if connected; otherwise the static fallback. */
  snapshot(): ActionMetadata[] {
    return this.live ?? (staticCatalogue as ActionMetadata[]);
  }

  setLive(actions: ActionMetadata[]): void {
    this.live = actions;
  }

  clear(): void {
    this.live = null;
  }

  /** True iff a live catalogue is currently in use (i.e. backend connected). */
  isLive(): boolean {
    return this.live !== null;
  }
}
