/**
 * Memory layer — public types.
 *
 * The memory subsystem ports Mem0's extract → reconcile → hybrid-retrieve
 * pattern (see plans/agents/memory-worker-port.md). The intelligence
 * lives in two LLM prompts + a fusion scorer; the storage is a commodity
 * `MemoryBackend` swapped per deployment:
 *   - `InMemoryBackend`  — tests / dev (this package)
 *   - `VectorizeBackend` — hosted (Workers AI embeddings + Vectorize +
 *                          D1 FTS), deferred until the index is provisioned
 *   - `PgvectorBackend`  — self-host, optional
 *
 * `createMemoryAdapter({ backend, embed, llm })` is the orchestration —
 * provider-agnostic, fully unit-testable against `InMemoryBackend`.
 */

/** Scope a memory belongs to / a search is bounded by. */
export interface MemoryScope {
  orgId: string | null;
  /** Owner — a memory with a `userId` is visible only to that user. */
  userId?: string;
  /** Project — a memory with a `projectId` is visible only within it. */
  projectId?: string;
  /** Agent id (reserved; unused in v1 scope matching). */
  agentId?: string;
}

/** A memory as returned to callers. */
export interface MemoryRecord {
  id: string;
  text: string;
  scope: MemoryScope;
  /** Populated on `search` — the fused relevance score in [0, 1]. */
  score?: number;
  metadata?: Record<string, string | number | boolean>;
  createdAt?: string;
}

/** A memory as held by the backend (carries the dedup hash). */
export interface StoredMemory {
  id: string;
  text: string;
  scope: MemoryScope;
  /** Content hash for exact-dup detection before any LLM/embed spend. */
  hash: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
}

/** A distilled, self-contained fact produced by the extraction pass. */
export interface ExtractedFact {
  text: string;
  entities?: string[];
}

/** Embedder — turns text into vectors. Batched; impls add per-item fallback. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** LLM JSON call used by extract + reconcile. Returns parsed JSON. */
export interface MemoryLlm {
  json<T>(args: { system: string; prompt: string }): Promise<T>;
}

/** A semantic-search hit — id + cosine similarity (absolute, [0, 1]). */
export interface SemanticMatch {
  id: string;
  score: number;
}

/** A keyword-search hit — id + raw SQLite-style bm25 (≤ 0, lower = better). */
export interface KeywordMatch {
  id: string;
  bm25Raw: number;
}

/**
 * Storage primitive. `putRecord` / `updateRecord` take the embedding so
 * the backend keeps its vector + keyword indexes in sync with the
 * system-of-record in one call. Concrete backends route these to
 * Vectorize + D1 (+ FTS), pgvector, or an in-memory map.
 */
export interface MemoryBackend {
  putRecord(record: StoredMemory, vector: number[]): Promise<void>;
  getRecord(id: string): Promise<StoredMemory | null>;
  getRecords(ids: string[]): Promise<StoredMemory[]>;
  updateRecord(id: string, patch: { text: string; vector: number[] }): Promise<StoredMemory | null>;
  deleteRecord(id: string): Promise<void>;
  deleteScope(scope: MemoryScope): Promise<void>;
  listByScope(scope: MemoryScope, limit?: number): Promise<StoredMemory[]>;
  existsByHash(hash: string, scope: MemoryScope): Promise<boolean>;
  semanticSearch(vector: number[], scope: MemoryScope, topK: number): Promise<SemanticMatch[]>;
  keywordSearch(text: string, scope: MemoryScope, topK: number): Promise<KeywordMatch[]>;
}

/** Inputs for `MemoryAdapter.add`. */
export interface AddMemoryInput {
  messages: Array<{ role: string; content: string }> | string;
  scope: MemoryScope;
  /** `true` (default) runs the LLM extract+reconcile pipeline; `false` stores raw. */
  infer?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

/** Inputs for `MemoryAdapter.search`. */
export interface SearchMemoryInput {
  query: string;
  scope: MemoryScope;
  topK?: number;
}

/** The public memory surface — what `core.agent` / the agents plugin call. */
export interface MemoryAdapter {
  add(input: AddMemoryInput): Promise<MemoryRecord[]>;
  search(input: SearchMemoryInput): Promise<MemoryRecord[]>;
  get(id: string, scope: MemoryScope): Promise<MemoryRecord | null>;
  getAll(scope: MemoryScope, limit?: number): Promise<MemoryRecord[]>;
  delete(id: string, scope: MemoryScope): Promise<void>;
  deleteAll(scope: MemoryScope): Promise<void>;
}

/** True when a stored memory's scope is visible to a query scope. */
export function scopeMatches(memory: MemoryScope, query: MemoryScope): boolean {
  if (memory.orgId !== query.orgId) {
    return false;
  }
  // A user-owned memory is visible only to that user; an org-global
  // memory (no userId) is visible to everyone in the org.
  if (memory.userId && query.userId && memory.userId !== query.userId) {
    return false;
  }
  if (memory.userId && !query.userId) {
    return false;
  }
  // Same for project scoping.
  if (memory.projectId && query.projectId && memory.projectId !== query.projectId) {
    return false;
  }
  if (memory.projectId && !query.projectId) {
    return false;
  }
  return true;
}
