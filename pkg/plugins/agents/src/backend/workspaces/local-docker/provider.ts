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
 * ## Isolation
 *
 * Everything that runs in here is LLM-directed, so the container is
 * hardened **by default** — a caller that passes no options still gets:
 *
 *   - `--memory 2g`, `--cpus 2`, `--pids-limit 512` — a runaway build or
 *     fork bomb hits a wall instead of the host's OOM killer.
 *   - `--cap-drop=ALL` + `--security-opt=no-new-privileges` — no
 *     capabilities, and no regaining any via setuid binaries.
 *   - Agent commands run as an unprivileged uid (`--user`, default
 *     `1000:1000`), applied on every `docker exec` (see below).
 *   - A dedicated bridge network with inter-container communication off,
 *     so a sandbox can reach the internet (`git clone`, `npm install`)
 *     but not other containers on the host.
 *
 * `runArgs` is appended *after* these, so a caller can still override any
 * scalar flag (docker takes the last occurrence) or extend the set.
 *
 * **Why pid 1 is still root**: docker creates the `-w` workdir owned by
 * root *before* dropping to `--user`, leaving it unwritable — and with
 * `--cap-drop=ALL` not even an `exec -u 0` can chown it back. So the
 * container's keeper process (an idle `tail -f /dev/null`) starts as root
 * purely to `mkdir` + `chmod 1777` the workspace, and every agent-facing
 * `exec` then runs as `user` with an empty capability set. The keeper
 * runs no untrusted input.
 *
 * **Residual risk**: a bridge network with egress can still reach the
 * host's link-local range, including the cloud metadata endpoint
 * (169.254.169.254). Docker offers no per-container route filtering
 * without granting NET_ADMIN (which we drop). Deployments on a cloud VM
 * should either set `network: 'none'` when the agent needs no egress, run
 * with IMDSv2 required, or block the range at the host firewall.
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
import { createLocalDockerHandle, shQuote } from './handle';

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
  /** `--memory` limit. Default `2g`. */
  memory?: string;
  /** `--cpus` limit. Default `2`. */
  cpus?: string;
  /** `--pids-limit`. Default `512`. */
  pidsLimit?: number;
  /**
   * `uid:gid` agent commands run as. Default `1000:1000` (the `node` /
   * `ubuntu` user in the usual base images). Set to `null` to run as the
   * image's own user — only do that for an image that is already
   * non-root, or the agent gets root inside the container.
   */
  user?: string | null;
  /**
   * Network mode:
   *   - `'isolated'` (default) — a dedicated `--internal`-less bridge with
   *     `enable_icc=false`: egress works, other containers don't.
   *   - `'none'` — no network at all. The strongest option; breaks
   *     `git clone`, `npm install`, and any network-using agent command.
   *   - `'bridge'` / any other string — passed to `--network` verbatim.
   */
  network?: 'isolated' | 'none' | 'bridge' | (string & {});
  /** Name of the network created for `network: 'isolated'`. */
  networkName?: string;
  /**
   * Extra `docker run` args, appended after the hardening defaults so
   * they win on conflict (e.g. `['--memory', '8g']` to raise the cap, or
   * `['--cap-add', 'NET_RAW']` to add back a capability).
   */
  runArgs?: string[];
}

/** Docker names allow `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; sanitise the rest. */
function sanitise(part: string): string {
  return part.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

const DEFAULT_MEMORY = '2g';
const DEFAULT_CPUS = '2';
const DEFAULT_PIDS_LIMIT = 512;
const DEFAULT_USER = '1000:1000';
const DEFAULT_NETWORK_NAME = 'flowlib-agents';

/** True when `runArgs` already sets `--network`, which docker accumulates. */
function hasNetworkArg(runArgs: string[]): boolean {
  return runArgs.some((a) => a === '--network' || a === '--net' || a.startsWith('--network='));
}

export function localDockerWorkspace(options: LocalDockerWorkspaceOptions): WorkspaceProvider {
  const image = options.image;
  const workspaceDir = options.workspaceDir ?? '/workspace';
  const prefix = options.containerNamePrefix ?? 'flowlib-ws';
  const dockerPath = options.dockerPath ?? 'docker';
  const shell = options.shell ?? 'sh';
  const memory = options.memory ?? DEFAULT_MEMORY;
  const cpus = options.cpus ?? DEFAULT_CPUS;
  const pidsLimit = options.pidsLimit ?? DEFAULT_PIDS_LIMIT;
  const user = options.user === null ? undefined : (options.user ?? DEFAULT_USER);
  const network = options.network ?? 'isolated';
  const networkName = options.networkName ?? DEFAULT_NETWORK_NAME;
  const runArgs = options.runArgs ?? [];

  const containerName = (auth: Pick<AgentsAuthContext, 'orgId'>, workspaceId: string): string =>
    `${prefix}-${sanitise(auth.orgId ?? 'default')}-${sanitise(workspaceId)}`;

  /**
   * Create the dedicated bridge on first use. `enable_icc=false` blocks
   * container-to-container traffic while leaving egress intact — which
   * `git clone` needs. Idempotent: a concurrent/previous create just
   * reports "already exists", and any other failure surfaces on `run`.
   */
  let networkReady: Promise<void> | undefined;
  async function ensureNetwork(): Promise<void> {
    const res = await runDocker(dockerPath, [
      'network',
      'create',
      '--driver',
      'bridge',
      '--opt',
      'com.docker.network.bridge.enable_icc=false',
      networkName,
    ]);
    if (res.exitCode !== 0 && !/already exists/i.test(res.stderr)) {
      throw new Error(`docker network create ${networkName} failed: ${res.stderr.trim()}`);
    }
  }

  /** The hardening flags every container boots with. */
  async function hardeningArgs(): Promise<string[]> {
    const args = [
      '--memory',
      memory,
      '--cpus',
      cpus,
      '--pids-limit',
      String(pidsLimit),
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
    ];
    // Docker *accumulates* repeated `--network` rather than taking the
    // last one, so an explicit caller flag replaces ours instead of
    // stacking with it.
    if (!hasNetworkArg(runArgs)) {
      if (network === 'isolated') {
        networkReady ??= ensureNetwork();
        await networkReady;
        args.push('--network', networkName);
      } else {
        args.push('--network', network);
      }
    }
    return args;
  }

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
    // Not found — boot it. The keeper runs as root just long enough to
    // create a workspace dir the unprivileged exec user can write to
    // (docker's own `-w` would leave it root-owned and, under
    // `--cap-drop=ALL`, unfixable), then idles so later `docker exec`s
    // have something to attach to.
    const q = shQuote(workspaceDir);
    const run = await runDocker(dockerPath, [
      'run',
      '-d',
      '--name',
      name,
      ...(await hardeningArgs()),
      ...runArgs,
      image,
      shell,
      '-c',
      `mkdir -p ${q} && chmod 1777 ${q} && exec tail -f /dev/null`,
    ]);
    if (run.exitCode !== 0) {
      throw new Error(`docker run (${image}) failed: ${run.stderr.trim()}`);
    }
  }

  const handleFor = (workspaceId: string, name: string): WorkspaceHandle =>
    createLocalDockerHandle({
      workspaceId,
      container: name,
      workspaceDir,
      dockerPath,
      shell,
      user,
    });

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
