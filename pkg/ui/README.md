<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/ui</h1>

<p align="center">
  React flow editor and dashboard for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs"><strong>Quick Start</strong></a>
</p>

---

A single React component that gives you a complete workflow editor, execution viewer, credential manager, and AI assistant. Built with React Flow, Tailwind CSS, and Radix UI.

## Install

```bash
npx flowlib-cli init
```

Or install manually:

```bash
npm install @flowlib/ui
```

## Usage

`<Flowlib>` takes a single `config` prop — the same object you pass to the backend
(`createFlowlibRouter(config)` / `defineConfig({...})`). The frontend reads only the
fields it needs (`apiPath`, `frontendPath`, `theme`, `plugins`) and ignores the rest,
so one `flowlib.config.ts` can be shared across backend and frontend.

```tsx
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';

function App() {
  return (
    <Flowlib
      config={{
        apiPath: 'http://localhost:3000/flowlib',
        frontendPath: '/flowlib',
        theme: 'dark',
      }}
    />
  );
}
```

Or import the shared config object directly:

```tsx
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';
import { flowlibConfig } from '../flowlib.config';

function App() {
  return <Flowlib config={flowlibConfig} />;
}
```

This renders the full Flowlib UI — flow list, drag-and-drop editor, execution monitoring, and credential management.

Plugins go inside `config.plugins` (frontend surfaces resolve automatically via each
plugin package's `browser` export, so no server code is bundled):

```tsx
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';

<Flowlib config={{ apiPath: '/api/flowlib', frontendPath: '/flowlib', plugins: [auth(), rbac()] }} />;
```

## Props

| Prop               | Type            | Default | Description                                                                |
| ------------------ | --------------- | ------- | -------------------------------------------------------------------------- |
| `config`           | `FlowlibConfig` | —       | Required. Shared config object — reads `apiPath`, `frontendPath`, `theme`, `plugins`. |
| `reactQueryClient` | `QueryClient`   | —       | Bring your own React Query client.                                         |
| `useMemoryRouter`  | `boolean`       | `false` | Use `MemoryRouter` instead of `BrowserRouter` (useful for testing).        |
| `apiClient`        | `ApiClient`     | —       | Pre-configured API client (e.g. demo mode). Overrides `config.apiPath`.    |

## CSS Scoping

All styles are scoped under a `.flowlib` CSS class. Flowlib won't interfere with your app's existing styles.

## FlowlibShell

For plugin UIs that render outside the main app (e.g. sign-in pages), use `FlowlibShell` to get just the CSS scope without routing or layout:

```tsx
import { FlowlibShell } from '@flowlib/ui';
import '@flowlib/ui/styles';

<FlowlibShell theme="dark">
  <YourCustomUI />
</FlowlibShell>;
```

## License

[MIT](../../LICENSE)
