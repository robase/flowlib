<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/version-control</h1>

<p align="center">
  Version control plugin for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Sync Flowlib flows to GitHub (and other Git providers) as readable `.flow.ts` TypeScript files. Supports read, write, read-write, and PR-based publishing workflows.

## Install

```bash
pnpm add @flowlib/version-control
```

## Backend

```ts
import { versionControl } from '@flowlib/version-control';
import { githubProvider } from '@flowlib/version-control/providers/github';

const github = githubProvider({
  auth: {
    type: 'app',
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: Number(process.env.GITHUB_APP_INSTALLATION_ID!),
  },
});

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [
    versionControl({
      provider: github,
      repo: 'org/my-flows',
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    }),
  ],
});

app.use('/flowlib', flowlibRouter);
```

### Options

```ts
versionControl({
  provider: githubProvider({ auth: { type: 'app', appId: '...', privateKey: '...' } }),
  repo: 'owner/repo', // Default repository (owner/name)
  defaultBranch: 'main', // Target branch
  path: 'flows/', // Directory in the repo for flow files
  mode: 'pr-per-publish', // "direct-commit" | "pr-per-save" | "pr-per-publish"
  syncDirection: 'write', // "read" | "write" | "read-write"
  webhookSecret: '...', // Webhook secret for PR merge events
});
```

GitHub App authentication is the recommended production path. It scopes access to an installation and can be revoked per repository. Personal access tokens still work for local development:

```ts
githubProvider({ auth: { type: 'token', token: process.env.GITHUB_TOKEN! } });
```

Production instances should also set `webhookSecret`; `/vc/health` reports hardening warnings when webhook HMAC verification or GitHub App auth is missing.

## Features

- **Push/pull** — Sync flows to and from a Git repository.
- **PR-based publishing** — Create pull requests for flow changes, merge to deploy.
- **Read / write sync** — Choose whether an instance reads from Git, writes to Git, or does both.
- **Readable exports** — Flows are serialized as `.flow.ts` TypeScript files.
- **Sync history** — Full audit trail of sync operations with commit SHAs.

## Exports

| Entry Point                                 | Content                  |
| ------------------------------------------- | ------------------------ |
| `@flowlib/version-control`                  | Backend plugin (Node.js) |
| `@flowlib/version-control/providers/github` | GitHub provider          |
| `@flowlib/version-control/types`            | Shared types             |

## License

[MIT](../../../LICENSE)
