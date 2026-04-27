<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">Next.js App Router Example</h1>

<p align="center">
  Self-contained Next.js 15 example with Invect.
</p>

---

Mounts the Invect backend as a catch-all API route and the React flow editor as a page — no separate backend needed.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002) to see the app. The Invect UI is mounted at `/flowlib`.

## Vercel Cron

For production Vercel deployments, this example includes a dedicated Invect maintenance route at `/api/flowlib/cron` plus a `vercel.json` cron entry.

That single Invect cron is used to:

- poll pending batch jobs
- resume flows paused for batch completion
- fail stale flow runs
- execute due Invect cron triggers
