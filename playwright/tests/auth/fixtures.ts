/**
 * Fixtures for auth-flow Playwright tests.
 *
 * Each Playwright worker gets its own Express + Flowlib server (via
 * playwright/test-support/auth-test-server.ts) backed by a disposable SQLite
 * database. Browser requests to the shared Vite frontend's `/flowlib/*`
 * routes are intercepted and forwarded to the worker-local server, so
 * sign-in / profile / api-key / sessions UI runs against a real backend
 * — no `_authMock` fixture; the real auth gate is exercised.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname is .../playwright/tests/auth, so the playwright dir is two levels up.
const serverCwd = path.resolve(__dirname, '../..');
const serverScript = path.join(serverCwd, 'test-support/auth-test-server.ts');
const sharedOrigin = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';

export const ADMIN_EMAIL = 'admin@auth-test.local';
export const ADMIN_PASSWORD = 'admin-pw-1234';

interface AuthServerFixture {
  apiBase: string;
  serverUrl: string;
}

// Resolve tsx's CLI entry from our node_modules so we can invoke it via
// `node <tsx-cli> ...` — that avoids depending on `pnpm` / `tsx` being
// somewhere on PATH at spawn time, which isn't always true under Playwright.
const requireFromHere = createRequire(import.meta.url);
const tsxCli = requireFromHere.resolve('tsx/cli');

async function spawnAuthServer(workerIndex: number): Promise<{
  fixture: AuthServerFixture;
  cleanup: () => Promise<void>;
}> {
  const dbFile = path.join(os.tmpdir(), `flowlib-auth-${workerIndex}-${Date.now()}.db`);

  const child: ChildProcess = spawn(process.execPath, [tsxCli, serverScript], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: '0',
      TEST_DB_PATH: dbFile,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      TRUSTED_ORIGIN: sharedOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Auth test server timeout.\nstderr:\n${stderr.join('')}`));
    }, 60_000);

    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const match = stdoutBuffer.match(/LISTENING:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number.parseInt(match[1], 10));
      }
    });

    child.on('exit', (code: number | null) => {
      clearTimeout(timeout);
      reject(new Error(`Auth test server exited with code ${code}.\nstderr:\n${stderr.join('')}`));
    });
  });

  const serverUrl = `http://127.0.0.1:${port}`;

  // Health check before handing over.
  const deadline = Date.now() + 30_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${serverUrl}/health`);
      lastStatus = res.status;
      if (res.ok) {
        break;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (lastStatus !== 200) {
    throw new Error(`Auth server /health never returned 200 (last: ${lastStatus}).`);
  }

  const cleanup = async () => {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3_000);
      child.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbFile + suffix);
      } catch {
        // already gone
      }
    }
  };

  return {
    fixture: { apiBase: `${serverUrl}/flowlib`, serverUrl },
    cleanup,
  };
}

export type AuthWorkerFixtures = {
  authServer: AuthServerFixture;
  apiBase: string;
};

export type AuthTestFixtures = {
  _routeInterception: void;
  /** Sign in as the seeded admin and wait for the dashboard to render. */
  signInAsAdmin: () => Promise<void>;
};

export const test = base.extend<AuthTestFixtures, AuthWorkerFixtures>({
  authServer: [
    async ({}, use, workerInfo) => {
      const { fixture, cleanup } = await spawnAuthServer(workerInfo.workerIndex);
      await use(fixture);
      await cleanup();
    },
    { scope: 'worker' },
  ],

  apiBase: [
    async ({ authServer }, use) => {
      await use(authServer.apiBase);
    },
    { scope: 'worker' },
  ],

  _routeInterception: [
    async ({ page, authServer }, use) => {
      // Browser hits /api/flowlib/** (Vite frontend's apiPath); the isolated
      // Express server mounts the Flowlib router at /flowlib.
      //
      // Unlike the generic interceptor in test-support/sqlite-isolation.ts,
      // we *preserve* the Origin header — better-auth rejects requests
      // without an Origin matching its trustedOrigins list, and the auth
      // test server is configured to trust the shared Vite origin.
      const browserApiPrefix = `${sharedOrigin}/api/flowlib`;
      const targetApiPrefix = `${authServer.serverUrl}/flowlib`;

      await page.route(`${sharedOrigin}/api/flowlib/**`, async (route) => {
        const request = route.request();
        const requestUrl = request.url();
        if (!requestUrl.startsWith(browserApiPrefix)) {
          await route.fallback();
          return;
        }

        const rewritten = requestUrl.replace(browserApiPrefix, targetApiPrefix);
        const headers = await request.allHeaders();
        const body = request.postDataBuffer();

        delete headers.host;
        delete headers['content-length'];
        // Keep `origin` and `referer` so better-auth's trusted-origin check
        // sees the shared Vite origin we registered as trusted.

        try {
          const response = await fetch(rewritten, {
            method: request.method(),
            headers,
            body: body ? new Uint8Array(body) : undefined,
            redirect: 'manual',
          });

          // Multiple Set-Cookie headers (better-auth emits ~2 — session token
          // + session data cache). Object.fromEntries(response.headers) would
          // collapse them to one. Pull them out via getSetCookie() and add
          // them to the browser context so the cookie jar reflects all of
          // them, then strip Set-Cookie from the fulfilled headers.
          const setCookies = response.headers.getSetCookie?.() ?? [];
          if (setCookies.length > 0) {
            const cookies = setCookies
              .map((raw) => parseSetCookie(raw, sharedOrigin))
              .filter((c): c is NonNullable<typeof c> => c !== null);
            // Add cookies one by one — if any single cookie is malformed
            // (missing url/path), don't let it block the others.
            for (const cookie of cookies) {
              try {
                await page.context().addCookies([cookie]);
              } catch (err) {
                process.stderr.write(
                  `[auth-test] addCookie failed (${cookie.name}): ${err instanceof Error ? err.message : String(err)}\nRaw: ${setCookies[cookies.indexOf(cookie)]}\n`,
                );
              }
            }
          }

          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'set-cookie') {
              responseHeaders[key] = value;
            }
          });

          await route.fulfill({
            status: response.status,
            headers: responseHeaders,
            body: Buffer.from(await response.arrayBuffer()),
          });
        } catch {
          await route.abort('failed');
        }
      });
      await use();
    },
    { auto: true },
  ],

  signInAsAdmin: async ({ page }, use) => {
    await use(async () => {
      await gotoSignIn(page);
      await page.getByLabel('Email').fill(ADMIN_EMAIL);
      await page.getByLabel('Password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await waitForFlowlibDashboard(page);
    });
  },
});

export async function gotoSignIn(page: Page) {
  await page.goto('/flowlib');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
    timeout: 30_000,
  });
}

export async function waitForFlowlibDashboard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Loading flows'))
    .not.toBeVisible({ timeout: 15_000 })
    .catch(() => {});
}

export function uniqueValue(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Minimal Set-Cookie parser. Returns a Playwright-compatible cookie record,
 * or null if the header isn't parseable. Only handles the attributes that
 * matter for our auth flow tests (Path, Domain, Expires, HttpOnly, Secure,
 * SameSite).
 */
type ParsedCookie = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

function parseSetCookie(raw: string, defaultUrl: string): ParsedCookie | null {
  const parts = raw.split(';').map((p) => p.trim());
  const first = parts.shift();
  if (!first) {
    return null;
  }
  const eqIdx = first.indexOf('=');
  if (eqIdx <= 0) {
    return null;
  }
  const cookie: ParsedCookie = {
    name: first.slice(0, eqIdx).trim(),
    value: first.slice(eqIdx + 1).trim(),
  };

  let domain: string | undefined;
  let path: string | undefined;
  for (const attr of parts) {
    const [k, v = ''] = attr.split('=', 2).map((s) => s.trim());
    const key = k.toLowerCase();
    if (key === 'path') {
      path = v;
    } else if (key === 'domain') {
      domain = v;
    } else if (key === 'expires') {
      const ts = Date.parse(v);
      if (!Number.isNaN(ts)) {
        cookie.expires = Math.floor(ts / 1000);
      }
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'samesite') {
      const lower = v.toLowerCase();
      if (lower === 'strict') {
        cookie.sameSite = 'Strict';
      } else if (lower === 'lax') {
        cookie.sameSite = 'Lax';
      } else if (lower === 'none') {
        cookie.sameSite = 'None';
      }
    }
  }

  // Playwright's addCookies needs (domain + path) — passing `url` alone is
  // not always sufficient. Derive a domain from the origin URL when the
  // Set-Cookie has no Domain attribute, and always default Path to "/".
  if (domain) {
    cookie.domain = domain;
  } else {
    try {
      const u = new URL(defaultUrl);
      cookie.domain = u.hostname;
    } catch {
      cookie.url = defaultUrl;
    }
  }
  cookie.path = path ?? '/';

  // SameSite=None requires Secure on real browsers, but not when scoped to
  // localhost. Strip Secure for localhost so the browser actually stores it.
  if (cookie.url?.startsWith('http://')) {
    cookie.secure = false;
  }
  return cookie;
}
