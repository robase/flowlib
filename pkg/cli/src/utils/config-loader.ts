/**
 * Config Loader
 *
 * Resolves and loads the user's Invect configuration file to discover
 * plugins and their schemas. Uses jiti for runtime TypeScript loading
 * Discovers and loads the user's flowlib.config.ts file.
 *
 * Search order:
 *   1. Explicit --config path
 *   2. flowlib.config.ts / flowlib.config.js in cwd
 *   3. src/flowlib.config.ts
 *   4. lib/flowlib.config.ts
 *   5. config/flowlib.config.ts
 *   6. Inline config in common framework files
 */

import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';

/**
 * Minimal config shape — we only need plugins + database
 * for schema generation. We don't need the full Zod-validated config.
 */
interface ResolvedConfig {
  /** The resolved backend plugins extracted from unified plugin definitions */
  plugins: Array<{
    id: string;
    name?: string;
    schema?: Record<string, unknown>;
    actions?: unknown[];
    [key: string]: unknown;
  }>;
  /** Base database configuration */
  database?: {
    connectionString: string;
    type: 'postgresql' | 'sqlite' | 'mysql';
    name?: string;
  };
  /**
   * Optional schema transforms (e.g., multi-tenant column injection).
   *
   * Plumbed straight through to `mergeSchemas` — the loader does not validate
   * the shape so the consumer (`@flowlib/core`) can evolve the contract.
   */
  schemaTransforms: unknown[];
  /** Raw config object */
  raw: Record<string, unknown>;
  /** Path to the config file that was loaded */
  configPath: string;
}

const CONFIG_FILENAMES = ['flowlib.config.ts', 'flowlib.config.js', 'flowlib.config.mjs'];

const CONFIG_DIRECTORIES = ['.', 'src', 'lib', 'config', 'utils'];

/**
 * Find the flowlib config file.
 */
export function findConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = path.resolve(process.cwd(), explicitPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    return null;
  }

  // Search known locations
  for (const dir of CONFIG_DIRECTORIES) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.resolve(process.cwd(), dir, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

// =============================================================================
// TSConfig path alias resolution
// =============================================================================

/**
 * Strip JSON comments (// and /* ... *​/) for parsing tsconfig.json.
 */
function stripJsonComments(jsonString: string): string {
  return jsonString
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m))
    .replace(/,(?=\s*[}\]])/g, '');
}

/**
 * Resolve TSConfig path aliases from tsconfig.json/jsconfig.json.
 * Follows `references` for monorepo setups (with circular reference protection).
 */
function getPathAliases(cwd: string): Record<string, string> | null {
  let tsConfigPath = path.join(cwd, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    tsConfigPath = path.join(cwd, 'jsconfig.json');
  }
  if (!fs.existsSync(tsConfigPath)) {
    return null;
  }

  try {
    const result = getPathAliasesRecursive(tsConfigPath, new Set());
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function getPathAliasesRecursive(configPath: string, visited: Set<string>): Record<string, string> {
  const resolvedPath = path.resolve(configPath);
  if (visited.has(resolvedPath)) {
    return {};
  }
  visited.add(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    return {};
  }

  let tsConfig: Record<string, unknown>;
  try {
    const text = fs.readFileSync(resolvedPath, 'utf-8');
    tsConfig = JSON.parse(stripJsonComments(text));
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const compilerOptions = tsConfig.compilerOptions as Record<string, unknown> | undefined;
  const paths = compilerOptions?.paths as Record<string, string[]> | undefined;
  const baseUrl = compilerOptions?.baseUrl as string | undefined;
  const configDir = path.dirname(resolvedPath);

  if (paths) {
    for (const [alias, targets] of Object.entries(paths)) {
      if (
        typeof alias === 'string' &&
        alias.endsWith('/*') &&
        Array.isArray(targets) &&
        targets.length > 0
      ) {
        const aliasPrefix = alias.slice(0, -2);
        const targetDir = targets[0]!.replace(/\/\*$/, '');
        const resolvedTarget = baseUrl
          ? path.resolve(configDir, baseUrl, targetDir)
          : path.resolve(configDir, targetDir);
        result[aliasPrefix] = resolvedTarget;
      }
    }
  }

  // Follow references (for monorepo setups)
  const references = tsConfig.references as Array<{ path: string }> | undefined;
  if (references) {
    for (const ref of references) {
      const refPath = path.resolve(configDir, ref.path);
      const refConfigPath = refPath.endsWith('.json')
        ? refPath
        : path.join(refPath, 'tsconfig.json');
      const refAliases = getPathAliasesRecursive(refConfigPath, visited);
      Object.assign(result, refAliases);
    }
  }

  return result;
}

/**
 * Load and resolve the Invect configuration file.
 *
 * Uses jiti for TypeScript/ESM loading with path alias support.
 * Resolves TSConfig path aliases so imports like @/lib/auth work.
 */
export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  // Resolve TSConfig path aliases
  const aliases = getPathAliases(process.cwd()) || {};

  // Use jiti for runtime TypeScript loading
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    // Pass resolved path aliases so @/ imports work
    alias: aliases,
  });

  let configModule: unknown;

  try {
    configModule = await jiti.import(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Common error: import aliases that jiti can't resolve
    if (message.includes('Cannot find module') || message.includes('Cannot resolve')) {
      console.error(pc.red('\n✗ Failed to load config file.'));
      console.error(pc.dim('  If your config uses import aliases (e.g., @/ or ~/),'));
      console.error(pc.dim('  try using relative paths instead, then run the CLI again.'));
      console.error(pc.dim(`\n  Error: ${message}\n`));
    }

    throw new Error(`Failed to load config from ${configPath}: ${message}`);
  }

  // The config module might export the config as default, or as a named export
  const raw = resolveConfigExport(configModule);

  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `Config file at ${configPath} does not export a valid Invect config object.\n` +
        `Expected: export default { database: ..., plugins: [...] }`,
    );
  }

  const config = raw as Record<string, unknown>;
  const rawPlugins = Array.isArray(config.plugins) ? config.plugins : [];

  // Extract backend plugins from unified shape: { id, backend?, frontend? }
  const backendPlugins: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rawPlugins.length; i++) {
    const plugin = rawPlugins[i];
    if (!plugin || typeof plugin !== 'object') {
      console.warn(pc.yellow(`⚠ Plugin at index ${i} is not an object — skipping`));
      continue;
    }
    const def = plugin as Record<string, unknown>;
    if (!('id' in def)) {
      console.warn(pc.yellow(`⚠ Plugin at index ${i} does not have an 'id' property — skipping`));
      continue;
    }
    const backend = def.backend as Record<string, unknown> | undefined;
    if (backend && typeof backend === 'object') {
      backendPlugins.push(backend);
    }
  }

  const validPlugins = backendPlugins.filter(
    (p): p is ResolvedConfig['plugins'][number] => 'id' in p,
  );

  // Surface optional schema transforms (defaults to []).
  const rawTransforms = Array.isArray(config.schemaTransforms) ? config.schemaTransforms : [];

  return {
    plugins: validPlugins,
    database: config.database as ResolvedConfig['database'],
    schemaTransforms: rawTransforms,
    raw: config,
    configPath,
  };
}

/**
 * Resolve the actual config object from various export patterns.
 */
/** @internal — exported for testing */
export function resolveConfigExport(module: unknown): unknown {
  if (!module || typeof module !== 'object') {
    return module;
  }

  const mod = module as Record<string, unknown>;

  // Handle: export default config
  if ('default' in mod) {
    const def = mod.default;
    // Handle double-wrapped: { default: { default: config } }
    if (def && typeof def === 'object' && 'default' in (def as Record<string, unknown>)) {
      return (def as Record<string, unknown>).default;
    }
    return def;
  }

  // Handle: export const config = ...
  if ('config' in mod) {
    return mod.config;
  }

  // Handle: export const invectConfig = ...
  if ('invectConfig' in mod) {
    return mod.invectConfig;
  }

  // Handle: module itself is the config (has database)
  if ('database' in mod || 'plugins' in mod) {
    return mod;
  }

  return mod;
}
