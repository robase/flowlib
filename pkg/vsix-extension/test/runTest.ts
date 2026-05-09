import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Host-side test runner. Boots a real VSCode (downloaded if not cached),
 * tells it to load the extension from this package, and points it at the
 * mocha runner under `./suite`.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite');

  // When this process is spawned inside an existing VSCode extension host
  // (e.g. running tests through the integrated terminal), Electron inherits
  // `ELECTRON_RUN_AS_NODE=1` and refuses every VSCode CLI flag with
  // "bad option: --…". Strip it from our env before `runTests` clones it.
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_PID;
  delete process.env.VSCODE_IPC_HOOK;
  delete process.env.VSCODE_CWD;
  delete process.env.VSCODE_NLS_CONFIG;
  delete process.env.VSCODE_CODE_CACHE_PATH;
  delete process.env.VSCODE_CRASH_REPORTER_PROCESS_TYPE;
  delete process.env.VSCODE_ESM_ENTRYPOINT;
  delete process.env.VSCODE_HANDLES_UNCAUGHT_ERRORS;
  delete process.env.VSCODE_L10N_BUNDLE_LOCATION;

  // Launch VSCode against a fixture workspace so integration tests can
  // open .flow.ts files, expand the sidebar, etc. without polluting the
  // user's actual workspace settings. The fixture lives in the source
  // tree, not the compiled `out/` — resolve from the package root.
  const fixtureWorkspace = path.resolve(extensionDevelopmentPath, 'test', 'fixtures', 'workspace');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-extensions', fixtureWorkspace],
  });
}

main().catch((err) => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
