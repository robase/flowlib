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
  /** Hard timeout — the process is killed and `exitCode` set to 124. */
  timeoutMs?: number;
  /** Max stdout/stderr buffer (default 16 MiB). */
  maxBuffer?: number;
}

/**
 * Run `docker <args>`. Rejects only when the binary can't be spawned
 * (e.g. Docker not installed / daemon down); a non-zero command exit
 * resolves with the captured `exitCode`.
 */
export function runDocker(
  dockerPath: string,
  args: string[],
  options: RunDockerOptions = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      dockerPath,
      args,
      { timeout: options.timeoutMs ?? 0, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          // ENOENT / spawn failures have a string code → the binary is
          // missing; surface as a real rejection with a clear message.
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
