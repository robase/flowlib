<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">Next.js App Router Example</h1>

<p align="center">
  Self-contained Next.js 15 example with Flowlib.
</p>

---

Mounts the Flowlib backend as a catch-all API route and the React flow editor as a page — no separate backend needed.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002) to see the app. The Flowlib UI is mounted at `/flowlib`.

## Vercel Cron

For production Vercel deployments, this example includes a dedicated Flowlib maintenance route at `/api/flowlib/cron` plus a `vercel.json` cron entry.

That single Flowlib cron is used to:

- poll pending batch jobs
- resume flows paused for batch completion
- fail stale flow runs
- execute due Flowlib cron triggers
