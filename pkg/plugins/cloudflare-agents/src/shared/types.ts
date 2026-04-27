// ============================================================================
// @flowlib/cloudflare-agents — shared types (browser-safe, no runtime code)
// ============================================================================

/**
 * Target runtime for the compiled output.
 */
export type CompileTarget = 'agent-workflow' | 'standalone-workflow';

/**
 * Options passed to the flow compiler.
 */
export interface CompileFlowOptions {
  /** Flow ID to compile */
  flowId: string;
  /** Specific version to compile (defaults to latest) */
  version?: number | 'latest';
  /** Target output format */
  target?: CompileTarget;
  /**
   * How to resolve credentials in the compiled output.
   * - 'env' — reference Cloudflare env bindings (e.g., `env.OPENAI_API_KEY`)
   * - 'inline' — embed credential values directly (NOT recommended for production)
   */
  credentialStrategy?: 'env' | 'inline';
}

/**
 * Result of compiling a flow to Cloudflare-compatible code.
 */
export interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** The generated TypeScript source file(s) */
  files: GeneratedFile[];
  /** Human-readable warnings (non-fatal) */
  warnings: string[];
  /** Human-readable errors (fatal) */
  errors: string[];
  /** Metadata about the compiled flow */
  metadata: CompileMetadata;
}

/**
 * A single generated file.
 */
export interface GeneratedFile {
  /** Relative path within the output project (e.g., 'src/workflow.ts') */
  path: string;
  /** File content */
  content: string;
}

/**
 * Metadata about the compiled flow.
 */
export interface CompileMetadata {
  flowId: string;
  flowName: string;
  version: number;
  nodeCount: number;
  /** Action IDs used by the flow */
  actionIds: string[];
  /** Credential IDs referenced (need env bindings) */
  credentialRefs: string[];
  /** Whether the flow contains AI model/agent nodes */
  usesAI: boolean;
  /** Whether the flow has branching (if-else) */
  hasBranching: boolean;
  compiledAt: string;
}

/**
 * Full scaffolded Cloudflare project output.
 */
export interface ScaffoldResult {
  success: boolean;
  files: GeneratedFile[];
  warnings: string[];
  errors: string[];
}

/**
 * Options for scaffolding a full deployable project.
 */
export interface ScaffoldOptions extends CompileFlowOptions {
  /** Project name (used in wrangler.jsonc and package.json) */
  projectName?: string;
  /** Include package.json and wrangler.jsonc */
  includeConfig?: boolean;
}

/**
 * Compilation status record (stored in plugin table).
 */
export interface CompilationRecord {
  id: string;
  flowId: string;
  flowVersion: number;
  status: 'success' | 'failed';
  target: CompileTarget;
  warnings: string[];
  errors: string[];
  metadata: CompileMetadata;
  createdAt: string;
}
