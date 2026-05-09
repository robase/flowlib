import * as path from 'node:path';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * Entrypoint loaded by `runTests` inside the spawned VSCode.
 *
 * VSCode `require()`s this file in its extension host and awaits the returned
 * promise — resolve = green, reject = red. We discover compiled test files
 * under `out/test/**` and feed them to mocha.
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 60_000,
  });

  // Compiled test root is `<pkg>/out/test`. This file lives at
  // `<pkg>/out/test/suite/index.js` after `tsc`.
  const testsRoot = path.resolve(__dirname, '..');
  const files = await glob('**/*.test.js', { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}
