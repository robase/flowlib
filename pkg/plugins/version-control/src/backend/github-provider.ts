// =============================================================================
// GitHub Provider — implements GitProvider using the GitHub REST API
//
// Crypto note: ported from `node:crypto` (createHmac, timingSafeEqual, createSign)
// to WebCrypto so this runs unchanged on Cloudflare Workers / Deno / Bun.
// HMAC verification uses `crypto.subtle.verify` (constant-time by spec).
// GitHub-App JWT signing uses `crypto.subtle.sign` with a PKCS#8 RSA key.
// =============================================================================

import type {
  BranchComparison,
  BranchComparisonFile,
  CreatePullRequestOptions,
  CreateTreeCommitOptions,
  GitBranchInfo,
  GitCommitResult,
  GitFileContent,
  GitFileUpdateOptions,
  GitProvider,
  GitPullRequestInfo,
  GitPullRequestResult,
  GitTreeEntry,
  TreeCommitResult,
} from './git-provider';
import { StaleHeadError } from './git-provider';
import type { GitProviderAuth } from '../shared/types';

interface GitHubProviderOptions {
  auth: GitProviderAuth;
}

// ─── WebCrypto helpers (module-scoped, no per-call allocation) ─────────

const encoder = new TextEncoder();

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // base64url = base64 with - / _ in place of + / and no `=` padding.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      // Sentinel — caller treats a single 0xFF byte as "invalid hex".
      return new Uint8Array([0xff]);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Import a PKCS#8 PEM private key as a WebCrypto `CryptoKey` for RS256 signing.
 *
 * GitHub Apps return PKCS#8 (`-----BEGIN PRIVATE KEY-----`) directly. PKCS#1
 * (`-----BEGIN RSA PRIVATE KEY-----`) is not natively importable via WebCrypto —
 * Node would accept it, but Workers don't, so we surface a clear error with the
 * conversion command rather than papering over it.
 */
async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const trimmed = pem.trim();
  if (trimmed.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    throw new Error(
      'GitHub App private key is in PKCS#1 format (BEGIN RSA PRIVATE KEY). ' +
        'WebCrypto requires PKCS#8 — convert with: ' +
        '`openssl pkcs8 -topk8 -nocrypt -in rsa.pem -out pkcs8.pem` ' +
        'and re-upload the resulting key.',
    );
  }
  const match = trimmed.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!match) {
    throw new Error(
      'GitHub App private key is not a valid PEM (expected `-----BEGIN PRIVATE KEY-----`).',
    );
  }
  const base64 = match[1].replace(/\s+/g, '');
  const der = base64ToBytes(base64);
  // Detach to a fresh ArrayBuffer so the type aligns with `BufferSource`
  // (rejects SharedArrayBuffer-backed views in WebCrypto's TS types).
  const derBuffer = der.slice().buffer;
  return crypto.subtle.importKey(
    'pkcs8',
    derBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    /* extractable */ false,
    ['sign'],
  );
}

/** Copy `bytes` into a fresh ArrayBuffer view that satisfies `BufferSource`. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/**
 * Create a GitHub provider instance.
 *
 * Uses the GitHub REST API directly (no Octokit dependency).
 * Supports PAT, GitHub App, and Flowlib credential-based auth.
 */
export function githubProvider(options: GitHubProviderOptions): GitProvider {
  let resolvedToken: string | null = null;
  let appTokenExpiresAt: number = 0;

  async function getToken(): Promise<string> {
    // PAT — simple static token
    if (options.auth.type === 'token') {
      return options.auth.token;
    }

    // GitHub App — generate JWT → exchange for installation token
    if (options.auth.type === 'app') {
      // Cache: reuse token if not expired (tokens last 1 hour, refresh 5 min early)
      if (resolvedToken && Date.now() < appTokenExpiresAt - 5 * 60 * 1000) {
        return resolvedToken;
      }

      const jwt = await createAppJwt(options.auth.appId, options.auth.privateKey);

      // Find installation ID (if not provided, get it from the App)
      let installationId = options.auth.installationId;
      if (!installationId) {
        const res = await fetch('https://api.github.com/app/installations', {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
          },
        });
        if (!res.ok) {
          throw new Error(`Failed to list GitHub App installations: ${res.status}`);
        }
        const installations = (await res.json()) as Array<{ id: number }>;
        if (installations.length === 0) {
          throw new Error(
            'GitHub App has no installations. Install the app on a repository first.',
          );
        }
        installationId = installations[0].id;
      }

      // Exchange JWT for installation access token
      const tokenRes = await fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
          },
        },
      );
      if (!tokenRes.ok) {
        throw new Error(`Failed to create installation token: ${tokenRes.status}`);
      }

      const tokenData = (await tokenRes.json()) as { token: string; expires_at: string };
      resolvedToken = tokenData.token;
      appTokenExpiresAt = new Date(tokenData.expires_at).getTime();
      return resolvedToken;
    }

    if (options.auth.type === 'credential') {
      throw new Error(
        'GitHub credential-based auth must be resolved during plugin init. ' +
          'Use { type: "token" } or { type: "app" } for direct configuration.',
      );
    }

    throw new Error(`Unsupported auth type: ${(options.auth as { type: string }).type}`);
  }

  /** Create a JWT for GitHub App authentication (RS256, 10-min expiry). */
  async function createAppJwt(appId: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { iss: appId, iat: now - 60, exp: now + 10 * 60 };

    const b64url = (obj: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(obj)));
    const unsigned = `${b64url(header)}.${b64url(payload)}`;

    const key = await importRsaPrivateKey(privateKey);
    const sigBuffer = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      asBufferSource(encoder.encode(unsigned)),
    );
    const signature = bytesToBase64Url(new Uint8Array(sigBuffer));

    return `${unsigned}.${signature}`;
  }

  async function request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { allowStatuses?: number[] },
  ): Promise<{ status: number; data: T }> {
    const token = await getToken();
    const url = `https://api.github.com${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // 404 is universally tolerated (callers handle "not found" by checking
    // status). Callers can pass `allowStatuses` to also tolerate specific
    // non-OK responses — used by `createTreeCommit` for 422 non-fast-forward
    // ref updates, which are translated to `StaleHeadError` rather than
    // generic API errors.
    const tolerated =
      response.ok ||
      response.status === 404 ||
      (opts?.allowStatuses?.includes(response.status) ?? false);

    if (!tolerated) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    return { status: response.status, data };
  }

  function parseRepo(repo: string): { owner: string; repo: string } {
    const [owner, name] = repo.split('/');
    if (!owner || !name) {
      throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`);
    }
    return { owner, repo: name };
  }

  const provider: GitProvider = {
    id: 'github',
    name: 'GitHub',
    security: {
      authType: options.auth.type,
      supportsAppAuth: true,
      supportsSignedCommits: false,
      signedCommitsConfigured: false,
    },

    async getFileContent(repo: string, path: string, ref?: string): Promise<GitFileContent | null> {
      const { owner, repo: name } = parseRepo(repo);
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const { status, data } = await request<{
        content: string;
        sha: string;
        encoding: string;
      }>('GET', `/repos/${owner}/${name}/contents/${encodeURIComponent(path)}${query}`);

      if (status === 404) {
        return null;
      }

      const content =
        data.encoding === 'base64'
          ? Buffer.from(data.content, 'base64').toString('utf-8')
          : data.content;

      return { content, sha: data.sha };
    },

    async createOrUpdateFile(
      repo: string,
      path: string,
      content: string,
      message: string,
      opts: GitFileUpdateOptions,
    ): Promise<GitCommitResult> {
      const { owner, repo: name } = parseRepo(repo);
      const body: Record<string, unknown> = {
        message,
        content: Buffer.from(content).toString('base64'),
        branch: opts.branch,
      };
      if (opts.sha) {
        body.sha = opts.sha;
      }

      const { data } = await request<{ commit: { sha: string } }>(
        'PUT',
        `/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`,
        body,
      );

      return { commitSha: data.commit.sha };
    },

    async deleteFile(
      repo: string,
      path: string,
      message: string,
      opts: { branch: string; sha: string },
    ): Promise<void> {
      const { owner, repo: name } = parseRepo(repo);
      await request('DELETE', `/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
        message,
        sha: opts.sha,
        branch: opts.branch,
      });
    },

    async createBranch(repo: string, branch: string, fromRef: string): Promise<void> {
      const { owner, repo: name } = parseRepo(repo);

      // Resolve fromRef to a SHA
      const { data: refData } = await request<{ object: { sha: string } }>(
        'GET',
        `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(fromRef)}`,
      );

      await request('POST', `/repos/${owner}/${name}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: refData.object.sha,
      });
    },

    async deleteBranch(repo: string, branch: string): Promise<void> {
      const { owner, repo: name } = parseRepo(repo);
      await request(
        'DELETE',
        `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
      );
    },

    async getBranch(repo: string, branch: string): Promise<GitBranchInfo | null> {
      const { owner, repo: name } = parseRepo(repo);
      const { status, data } = await request<{ commit: { sha: string } }>(
        'GET',
        `/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`,
      );
      if (status === 404) {
        return null;
      }
      return { sha: data.commit.sha };
    },

    async listTree(repo: string, ref: string, opts?: { path?: string }): Promise<GitTreeEntry[]> {
      const { owner, repo: name } = parseRepo(repo);

      // Recursive=1 returns the whole tree at the commit. The ref may be a
      // branch name (resolved server-side) or a commit/tree SHA. GitHub's
      // Trees API doesn't accept a branch name directly — we resolve it
      // first via the branches API to keep the contract simple for callers.
      let treeSha = ref;
      if (!/^[a-f0-9]{40}$/.test(ref)) {
        const branchInfo = await this.getBranch(repo, ref);
        if (!branchInfo) {
          return [];
        }
        treeSha = branchInfo.sha;
      }

      const { status, data } = await request<{
        tree: Array<{ path: string; type: string; sha: string; size?: number }>;
        truncated?: boolean;
      }>('GET', `/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`);

      if (status === 404) {
        return [];
      }

      // GitHub truncates trees > 100k entries or > 7 MB. We don't paginate
      // here — at that size the version-control plugin isn't the right tool.
      // Surface the truncation to logs via the result so callers can warn.
      if (data.truncated) {
        // No structured way to bubble this up via the GitProvider contract.
        // Loggers in the reconciler will note when the entry count is at the
        // GitHub cap, which is the practical signal for this case.
      }

      const pathPrefix = opts?.path
        ? opts.path.endsWith('/')
          ? opts.path
          : `${opts.path}/`
        : null;

      const entries: GitTreeEntry[] = [];
      for (const item of data.tree) {
        const t = item.type === 'blob' ? 'blob' : 'tree';
        if (pathPrefix && !item.path.startsWith(pathPrefix)) {
          continue;
        }
        entries.push({ path: item.path, type: t, sha: item.sha, size: item.size });
      }
      return entries;
    },

    async compareBranches(repo: string, base: string, head: string): Promise<BranchComparison> {
      const { owner, repo: name } = parseRepo(repo);

      // GitHub's compare API: GET /repos/:owner/:repo/compare/:base...:head
      // The `...` (three dots) is "compare" semantics — gives ahead/behind
      // counts AND the file diff in one call.
      const path = `/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      const { status, data } = await request<{
        ahead_by: number;
        behind_by: number;
        files?: Array<{
          filename: string;
          status: string;
          previous_filename?: string;
        }>;
      }>('GET', path);

      if (status === 404) {
        // Branch doesn't exist — return empty comparison rather than throw,
        // so the promotion endpoint can surface a clean "branch not found"
        // error to the caller.
        return { aheadBy: 0, behindBy: 0, files: [] };
      }

      const files: BranchComparisonFile[] = (data.files ?? []).map((f) => {
        // Map GitHub's status strings to our union. Anything we don't
        // recognize falls through as `'changed'` so the contract stays
        // forward-compatible with future GitHub additions.
        const s = f.status;
        const status: BranchComparisonFile['status'] =
          s === 'added' || s === 'modified' || s === 'removed' || s === 'renamed' ? s : 'changed';
        const out: BranchComparisonFile = { path: f.filename, status };
        if (status === 'renamed' && f.previous_filename) {
          out.previousPath = f.previous_filename;
        }
        return out;
      });

      return { aheadBy: data.ahead_by, behindBy: data.behind_by, files };
    },

    async createTreeCommit(repo: string, opts: CreateTreeCommitOptions): Promise<TreeCommitResult> {
      const { owner, repo: name } = parseRepo(repo);

      // 1. Resolve the branch head. If the caller passed an expectedParentSha,
      //    enforce it BEFORE we upload anything — otherwise we'd write blobs
      //    we'd then have to abandon as garbage.
      const branchInfo = await this.getBranch(repo, opts.branch);
      if (!branchInfo) {
        throw new Error(`Branch ${opts.branch} not found in ${repo}`);
      }
      if (opts.expectedParentSha && branchInfo.sha !== opts.expectedParentSha) {
        throw new StaleHeadError(opts.expectedParentSha, branchInfo.sha);
      }
      const parentCommitSha = branchInfo.sha;

      // 2. Get the parent commit's tree SHA — needed as base_tree so deletes
      //    work and unchanged files aren't dropped.
      const { data: parentCommit } = await request<{ tree: { sha: string } }>(
        'GET',
        `/repos/${owner}/${name}/git/commits/${parentCommitSha}`,
      );
      const baseTreeSha = parentCommit.tree.sha;

      // 3. Upload blobs for each file. Done sequentially to keep the failure
      //    semantics simple — parallel uploads would all need to abort on the
      //    first failure, but since unreferenced blobs are GC'd by GitHub it
      //    doesn't change correctness either way.
      const fileResults: { path: string; blobSha: string }[] = [];
      const treeEntries: Array<{
        path: string;
        mode: '100644';
        type: 'blob';
        sha: string;
      }> = [];

      for (const file of opts.files) {
        const { data: blob } = await request<{ sha: string }>(
          'POST',
          `/repos/${owner}/${name}/git/blobs`,
          {
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          },
        );
        fileResults.push({ path: file.path, blobSha: blob.sha });
        treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      // Deletes: the GitHub Trees API removes a path from the new tree when
      // the entry's `sha` is null. `mode` and `type` are still required.
      const deleteEntries: Array<{
        path: string;
        mode: '100644';
        type: 'blob';
        sha: null;
      }> = (opts.deletes ?? []).map((path) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha: null,
      }));

      // 4. Build the new tree.
      const { data: tree } = await request<{ sha: string }>(
        'POST',
        `/repos/${owner}/${name}/git/trees`,
        {
          base_tree: baseTreeSha,
          tree: [...treeEntries, ...deleteEntries],
        },
      );

      // 5. Build the commit pointing at the new tree.
      const commitBody: Record<string, unknown> = {
        message: opts.message,
        tree: tree.sha,
        parents: [parentCommitSha],
      };
      if (opts.author) {
        commitBody.author = opts.author;
      }
      const { data: newCommit } = await request<{ sha: string }>(
        'POST',
        `/repos/${owner}/${name}/git/commits`,
        commitBody,
      );

      // 6. Advance the branch ref. This is the ONLY step that mutates the
      //    branch — until this PATCH lands, the new commit and tree are
      //    constructed but not visible. A failure here means zero files
      //    landed (the atomicity guarantee). A 422 from GitHub indicates
      //    a non-fast-forward — surface as StaleHeadError so callers can
      //    retry with a fresh parent.
      const { status: refStatus } = await request(
        'PATCH',
        `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(opts.branch)}`,
        { sha: newCommit.sha, force: false },
        // Don't throw on 422 — handle it as a stale-head conflict.
        { allowStatuses: [200, 201, 422] },
      );

      if (refStatus === 422) {
        // Re-read branch head to surface the actual current SHA.
        const after = await this.getBranch(repo, opts.branch);
        throw new StaleHeadError(parentCommitSha, after?.sha ?? 'unknown');
      }

      return { commitSha: newCommit.sha, files: fileResults };
    },

    async createPullRequest(
      repo: string,
      opts: CreatePullRequestOptions,
    ): Promise<GitPullRequestResult> {
      const { owner, repo: name } = parseRepo(repo);
      const { data } = await request<{ number: number; html_url: string }>(
        'POST',
        `/repos/${owner}/${name}/pulls`,
        {
          title: opts.title,
          body: opts.body,
          head: opts.head,
          base: opts.base,
          draft: opts.draft ?? false,
        },
      );
      return { number: data.number, url: data.html_url };
    },

    async updatePullRequest(
      repo: string,
      number: number,
      opts: { title?: string; body?: string },
    ): Promise<void> {
      const { owner, repo: name } = parseRepo(repo);
      await request('PATCH', `/repos/${owner}/${name}/pulls/${number}`, opts);
    },

    async getPullRequest(repo: string, number: number): Promise<GitPullRequestInfo> {
      const { owner, repo: name } = parseRepo(repo);
      const { data } = await request<{
        state: string;
        merged: boolean;
        merged_at: string | null;
      }>('GET', `/repos/${owner}/${name}/pulls/${number}`);

      let state: 'open' | 'closed' | 'merged';
      if (data.merged) {
        state = 'merged';
      } else if (data.state === 'closed') {
        state = 'closed';
      } else {
        state = 'open';
      }

      return { state, mergedAt: data.merged_at ?? undefined };
    },

    async closePullRequest(repo: string, number: number, comment?: string): Promise<void> {
      const { owner, repo: name } = parseRepo(repo);
      if (comment) {
        await request('POST', `/repos/${owner}/${name}/issues/${number}/comments`, {
          body: comment,
        });
      }
      await request('PATCH', `/repos/${owner}/${name}/pulls/${number}`, { state: 'closed' });
    },

    async verifyWebhookSignature(
      payload: string,
      signature: string,
      secret: string,
    ): Promise<boolean> {
      // GitHub sends `sha256=<hex>`; strip the prefix and verify constant-time
      // via WebCrypto. Anything that doesn't match the prefix shape is a
      // mismatch by definition.
      if (!signature.startsWith('sha256=')) {
        return false;
      }
      const receivedHex = signature.slice('sha256='.length);
      const expectedBytes = hexToBytes(receivedHex);
      if (expectedBytes.length === 1 && expectedBytes[0] === 0xff && receivedHex.length !== 2) {
        return false;
      }
      const key = await crypto.subtle.importKey(
        'raw',
        asBufferSource(encoder.encode(secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        /* extractable */ false,
        ['verify'],
      );
      return crypto.subtle.verify(
        'HMAC',
        key,
        asBufferSource(expectedBytes),
        asBufferSource(encoder.encode(payload)),
      );
    },
  };

  return provider;
}
