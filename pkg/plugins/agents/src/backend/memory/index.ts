/**
 * Memory layer barrel.
 *
 * The infra-independent core: the `MemoryAdapter` orchestration + the two
 * ported prompts (extract / reconcile) + the fusion scorer + an in-memory
 * backend. The hosted `VectorizeBackend` (Workers AI + Vectorize + D1
 * FTS) and `PgvectorBackend` implement `MemoryBackend` and slot straight
 * in — they're the only pieces that need provisioned infrastructure.
 */

export * from './types';
export { contentHash } from './hash';
export { scoreAndRank, SEMANTIC_THRESHOLD, type ScoringSignals } from './scoring';
export { extractFacts, buildExtractionPrompt, EXTRACTION_SYSTEM } from './extract';
export { reconcileFact, buildUpdatePrompt, UPDATE_SYSTEM, type MemoryOp } from './reconcile';
export { createInMemoryBackend } from './in-memory-backend';
export {
  createVectorizeBackend,
  ftsEscape,
  type VectorizeLike,
  type VectorizeBackendDeps,
} from './vectorize-backend';
export { createMemoryAdapter, type MemoryAdapterDeps } from './create-memory-adapter';
