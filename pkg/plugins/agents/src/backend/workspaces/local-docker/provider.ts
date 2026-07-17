/**
 * `localDockerWorkspace()` — a `WorkspaceProvider` that runs each
 * workspace as a local Docker container, driven straight from Node via
 * the `docker` CLI. The runtime-portable counterpart to the
 * Cloudflare-only `cloudflare-sandbox` provider: it lets a plain
 * Express/Node host (e.g. `examples/express-drizzle`) give the agent a
 * real shell + filesystem sandbox without any Cloudflare/Workers runtime.
 *
 * Container identity is **deterministic** from `orgId + workspaceId`
 * (like `cloudflare-sandbox`'s `buildSandboxName`), so `resolve()` needs
 * no stored id — it just re-attaches to (or boots) the container by name.
 *
 * Requirements: Docker installed + daemon running; the `image` must have
 * a POSIX shell plus `tail`, `cat`, `mkdir`, and `find` (any standard
 * `*-slim`/`ubuntu`/`node` image qualifies).
 */
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type {
  CreateWorkspaceInput,
  WorkspaceHandle,
  WorkspaceProvider,
  WorkspaceProviderId,
} from '../types';
import { runDocker } from './docker';
import { createLocalDockerHandle } from './handle';

export interface LocalDockerWorkspaceOptions {
  /** Base image, e.g. `'node:24-slim'` or `'ubuntu:24.04'`. */
  image: string;
  /** Working directory inside the container. Default `/workspace`. */
  workspaceDir?: string;
  /** Container name prefix. Default `flowlib-ws`. */
  containerNamePrefix?: string;
  /** Path to the docker binary. Default `docker`. */
  dockerPath?: string;
  /** In-container shell for `exec`. Default `sh`. */
  shell?: string;
  /** Extra `docker run` args (e.g. `['--network', 'none', '--memory', '512m']`). */
  runArgs?: string[];
}

/** Docker names allow `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; sanitise the rest. */
function sanitise(part: string): string {
  return part.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

export function localDockerWorkspace(options: LocalDockerWorkspaceOptions): WorkspaceProvider {
  const image = options.image;
  const workspaceDir = options.workspaceDir ?? '/workspace';
  const prefix = options.containerNamePrefix ?? 'flowlib-ws';
  const dockerPath = options.dockerPath ?? 'docker';
  const shell = options.shell ?? 'sh';
  const runArgs = options.runArgs ?? [];

  const containerName = (auth: Pick<AgentsAuthContext, 'orgId'>, workspaceId: string): string =>
    `${prefix}-${sanitise(auth.orgId ?? 'default')}-${sanitise(workspaceId)}`;

  /** Re-attach to a running container, start a stopped one, or boot one. */
  async function ensureContainer(name: string): Promise<void> {
    const inspect = await runDocker(dockerPath, ['inspect', '-f', '{{.State.Running}}', name]);
    if (inspect.exitCode === 0) {
      if (inspect.stdout.trim() === 'true') {
        return; // already running
      }
      const started = await runDocker(dockerPath, ['start', name]);
      if (started.exitCode !== 0) {
        throw new Error(`docker start ${name} failed: ${started.stderr.trim()}`);
      }
      return;
    }
    // Not found — boot it. `-w` creates the workdir; `tail -f /dev/null`
    // keeps the container alive so later `docker exec`s can attach.
    const run = await runDocker(dockerPath, [
      'run',
      '-d',
      '--name',
      name,
      '-w',
      workspaceDir,
      ...runArgs,
      image,
      'tail',
      '-f',
      '/dev/null',
    ]);
    if (run.exitCode !== 0) {
      throw new Error(`docker run (${image}) failed: ${run.stderr.trim()}`);
    }
  }

  const handleFor = (workspaceId: string, name: string): WorkspaceHandle =>
    createLocalDockerHandle({ workspaceId, container: name, workspaceDir, dockerPath, shell });

  return {
    id: 'local-docker' as WorkspaceProviderId,
    name: 'Local Docker Sandbox',
    async create(input: CreateWorkspaceInput): Promise<WorkspaceHandle> {
      const name = containerName(input.auth, input.workspaceId);
      await ensureContainer(name);
      return handleFor(input.workspaceId, name);
    },
    async resolve(workspaceId: string, auth: AgentsAuthContext): Promise<WorkspaceHandle> {
      const name = containerName(auth, workspaceId);
      await ensureContainer(name);
      return handleFor(workspaceId, name);
    },
    async destroy(workspaceId: string, auth: AgentsAuthContext): Promise<void> {
      const name = containerName(auth, workspaceId);
      await runDocker(dockerPath, ['rm', '-f', name]);
    },
  };
}
