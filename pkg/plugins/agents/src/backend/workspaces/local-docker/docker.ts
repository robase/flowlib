/**
 * Thin wrapper around the `docker` CLI for the local-docker workspace
 * provider. Uses `node:child_process` `execFile` (argv form — no shell, so
 * no host-side injection) and resolves with `{ stdout, stderr, exitCode }`
 * instead of throwing on non-zero, so command failures surface as exit
 * codes (matching `WorkspaceExecResult`).
 */
import { execFile } from 'node:child_process';

export interface DockerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunDockerOptions {
  /** Data piped to the process's stdin (e.g. file contents for writes). */
  input?: string;
  /**
   * Hard timeout — the process is killed and `exitCode` set to 124.
   * Defaults to {@link DEFAULT_DOCKER_TIMEOUT_MS}; pass `0` to opt out
   * explicitly (a hung `docker` would then leak the calling request).
   */
  timeoutMs?: number;
  /** Max stdout/stderr buffer (default 16 MiB). */
  maxBuffer?: number;
}

/**
 * Default hard timeout for a `docker` invocation. Control-plane calls
 * (`inspect`, `start`, `rm`) finish in well under a second; the ceiling
 * exists so a wedged daemon surfaces as exit 124 instead of hanging the
 * agent turn forever. Long jobs pass an explicit larger `timeoutMs`.
 */
export const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;

/** Node's marker for "the child wrote more than `maxBuffer`". */
const MAXBUFFER_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/**
 * Run `docker <args>`. Rejects only when the binary can't be spawned
 * (e.g. Docker not installed / daemon down) or when output overflows
 * `maxBuffer`; a non-zero command exit resolves with the captured
 * `exitCode`.
 */
export function runDocker(
  dockerPath: string,
  args: string[],
  options: RunDockerOptions = {},
): Promise<DockerResult> {
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = execFile(
      dockerPath,
      args,
      { timeout: options.timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS, maxBuffer },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          // Node reports a maxBuffer overflow with a *string* code too, so
          // it must be split out before the "binary missing" branch below —
          // otherwise a chatty command is misreported as "Docker not
          // installed" and sends the operator debugging the wrong thing.
          if (code === MAXBUFFER_CODE) {
            reject(
              new Error(
                `docker output exceeded the ${maxBuffer}-byte buffer and was truncated ` +
                  `(command: ${dockerPath} ${args[0] ?? ''}). Redirect the command's output to a ` +
                  'file in the workspace and read it back in chunks, or raise `maxBuffer`.',
              ),
            );
            return;
          }
          // Any other string code is a spawn failure (ENOENT, EACCES, …) →
          // the binary is missing or unusable.
          if (typeof code === 'string') {
            reject(
              new Error(
                `docker not available (${code}). Is Docker installed and the daemon running? ` +
                  `(command: ${dockerPath} ${args[0] ?? ''})`,
              ),
            );
            return;
          }
          // `killed` (timeout) → conventional 124; otherwise the exit code.
          const exitCode =
            (error as { killed?: boolean }).killed === true
              ? 124
              : typeof code === 'number'
                ? code
                : 1;
          resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
      },
    );
    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}
