<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/user-auth</h1>

<p align="center">
  Authentication plugin for Flowlib, powered by Better Auth.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Adds user authentication, session management, and auth UI components to Flowlib. Built on [Better Auth](https://www.better-auth.com/).

## Install

```bash
pnpm add @flowlib/user-auth better-auth
```

## Backend

The simplest setup — the plugin manages Better Auth internally using Flowlib's database:

```ts
import { createFlowlibRouter } from '@flowlib/express';
import { auth } from '@flowlib/user-auth';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [
    auth({
      globalAdmins: [
        { email: process.env.FLOWLIB_ADMIN_EMAIL!, pw: process.env.FLOWLIB_ADMIN_PASSWORD! },
      ],
    }),
  ],
});

app.use('/flowlib', flowlibRouter);
```

For full control, provide your own Better Auth instance:

```ts
import { betterAuth } from 'better-auth';
import { auth } from '@flowlib/user-auth';

const betterAuthInstance = betterAuth({
  database: { url: 'file:./auth.db', type: 'sqlite' },
  emailAndPassword: { enabled: true },
});

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [auth({ auth: betterAuthInstance })],
});

app.use('/flowlib', flowlibRouter);
```

Sign-up is disabled in the UI. The initial admin is seeded from `globalAdmins`. Subsequent users are created by admins through the user management UI or API.

## Frontend

```tsx
import { Flowlib, FlowlibShell } from '@flowlib/ui';
import { AuthenticatedFlowlib } from '@flowlib/user-auth/ui';
import '@flowlib/ui/styles';

<AuthenticatedFlowlib
  apiBaseUrl="/api/flowlib"
  basePath="/flowlib"
  FlowlibComponent={Flowlib}
  ShellComponent={FlowlibShell}
  theme="light"
/>;
```

Or compose manually:

```tsx
import { AuthProvider, AuthGate, SignInPage, UserButton } from '@flowlib/user-auth/ui';

<AuthProvider baseUrl="http://localhost:3000/flowlib">
  <AuthGate fallback={<SignInPage />}>
    <Flowlib apiBaseUrl="http://localhost:3000/flowlib" />
  </AuthGate>
</AuthProvider>;
```

## Exports

| Entry Point                | Content                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@flowlib/user-auth`       | Backend plugin (Node.js)                                                                             |
| `@flowlib/user-auth/ui`    | Frontend components — `AuthProvider`, `AuthGate`, `SignInForm`, `UserButton`, `AuthenticatedFlowlib` |
| `@flowlib/user-auth/types` | Shared types                                                                                         |

## What It Does

**Backend** — Proxies auth routes (sign-in, session, OAuth) at `/plugins/auth/*`. Resolves sessions on every Flowlib API request. Maps Better Auth roles to Flowlib RBAC roles.

**Frontend** — `AuthProvider` for session state, `AuthGate` for conditional rendering, `SignInForm` / `UserButton` for auth UI.

## License

[MIT](../../../LICENSE)
