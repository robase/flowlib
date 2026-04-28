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

Sync Flowlib flows to GitHub (and other Git providers) as readable `.flow.ts` TypeScript files. Supports push, pull, PR-based publishing, and bidirectional sync.

## Install

```bash
pnpm add @flowlib/version-control
```

## Backend

```ts
import { versionControl } from '@flowlib/version-control';
import { githubProvider } from '@flowlib/version-control/providers/github';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [
    versionControl({
      provider: githubProvider({ auth: process.env.GITHUB_TOKEN! }),
      repo: 'org/my-flows',
    }),
  ],
});

app.use('/flowlib', flowlibRouter);
```

### Options

```ts
versionControl({
  provider: githubProvider({ auth: '...' }), // Git hosting provider
  repo: 'owner/repo', // Default repository (owner/name)
  defaultBranch: 'main', // Target branch
  path: 'flows/', // Directory in the repo for flow files
  mode: 'pr-per-publish', // "direct-commit" | "pr-per-save" | "pr-per-publish"
  syncDirection: 'push', // "push" | "pull" | "bidirectional"
  webhookSecret: '...', // Webhook secret for PR merge events
});
```

## Features

- **Push/pull** — Sync flows to and from a Git repository.
- **PR-based publishing** — Create pull requests for flow changes, merge to deploy.
- **Bidirectional sync** — Keep flows in sync between Flowlib and Git.
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
