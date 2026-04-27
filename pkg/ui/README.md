<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/ui</h1>

<p align="center">
  React flow editor and dashboard for Invect.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Docs</strong></a> · <a href="https://flowlib.dev/docs/quick-start"><strong>Quick Start</strong></a>
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

```tsx
import { Invect } from '@flowlib/ui';
import '@flowlib/ui/styles';

function App() {
  return <Invect apiBaseUrl="http://localhost:3000/flowlib" />;
}
```

This renders the full Invect UI — flow list, drag-and-drop editor, execution monitoring, and credential management.

## Props

| Prop               | Type                     | Default                        | Description                       |
| ------------------ | ------------------------ | ------------------------------ | --------------------------------- |
| `apiBaseUrl`       | `string`                 | `http://localhost:3000/flowlib` | Backend API URL                   |
| `basePath`         | `string`                 | `/flowlib`                      | Base path for routing             |
| `plugins`          | `InvectFrontendPlugin[]` | `[]`                           | Frontend plugins (RBAC, etc.)     |
| `reactQueryClient` | `QueryClient`            | —                              | Bring your own React Query client |

## CSS Scoping

All styles are scoped under a `.flowlib` CSS class. Invect won't interfere with your app's existing styles.

## InvectShell

For plugin UIs that render outside the main app (e.g. sign-in pages), use `InvectShell` to get just the CSS scope without routing or layout:

```tsx
import { InvectShell } from '@flowlib/ui';
import '@flowlib/ui/styles';

<InvectShell theme="dark">
  <YourCustomUI />
</InvectShell>;
```

## License

[MIT](../../LICENSE)
