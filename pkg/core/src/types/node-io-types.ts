/**
 * Node I/O Types
 *
 * Generic types for node inputs and outputs. The `OutputVariable`,
 * `OutputVariables`, `StructuredOutput`, and `NodeOutput` types are
 * now canonicalised in `@flowlib/action-kit`; this file re-exports them
 * and keeps the local `NodeInputMapping*` schema + input-data aliases.
 */

import { z } from 'zod/v4';

// =============================================================================
// COMMON NODE INPUT MAPPING TYPES
// =============================================================================

export const NodeInputMappingSchema = z.record(z.string(), z.string());

export type InputMappingConfig = Record<string, string>;

/**
 * Node incoming data is a simple object keyed by upstream node slug.
 * Values are the direct output values from upstream nodes (JSON-parsed if valid).
 *
 * Example: { "fetch_user": { "id": 123, "name": "Alice" }, "get_config": "production" }
 */
export type NodeIncomingDataObject = Record<string, unknown>;

/**
 * Generic input data passed to a node executor's `execute()` method.
 * Always a flat key→value record (slug-keyed incoming data from upstream nodes).
 */
export type NodeInputData = Record<string, unknown>;

// =============================================================================
// OUTPUT TYPES — canonical in @flowlib/action-kit
// =============================================================================

export type {
  OutputVariable,
  OutputVariables,
  StructuredOutput,
  NodeOutput,
} from '@flowlib/action-kit';

import type { NodeOutput } from '@flowlib/action-kit';

/**
 * Union kept as an alias for backwards compatibility — it is simply
 * `NodeOutput` now that output types are no longer per-node-type.
 */
export type NodeOutputs = NodeOutput;
