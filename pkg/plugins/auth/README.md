<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Invect" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/user-auth</h1>

<p align="center">
  Authentication plugin for Invect, powered by Better Auth.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Adds user authentication, session management, and auth UI components to Invect. Built on [Better Auth](https://www.better-auth.com/).

## Install

```bash
pnpm add @flowlib/user-auth better-auth
```

## Backend

The simplest setup — the plugin manages Better Auth internally using Invect's database:

```ts
import { createInvectRouter } from '@flowlib/express';
import { auth } from '@flowlib/user-auth';

const invectRouter = await createInvectRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY,
  plugins: [
    auth({
      globalAdmins: [
        { email: process.env.INVECT_ADMIN_EMAIL!, pw: process.env.INVECT_ADMIN_PASSWORD! },
      ],
    }),
  ],
});

app.use('/flowlib', invectRouter);
```

For full control, provide your own Better Auth instance:

```ts
import { betterAuth } from 'better-auth';
import { auth } from '@flowlib/user-auth';

const betterAuthInstance = betterAuth({
  database: { url: 'file:./auth.db', type: 'sqlite' },
  emailAndPassword: { enabled: true },
});

const invectRouter = await createInvectRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.INVECT_ENCRYPTION_KEY,
  plugins: [auth({ auth: betterAuthInstance })],
});

app.use('/flowlib', invectRouter);
```

Sign-up is disabled in the UI. The initial admin is seeded from `globalAdmins`. Subsequent users are created by admins through the user management UI or API.

## Frontend

```tsx
import { Invect, InvectShell } from '@flowlib/ui';
import { AuthenticatedInvect } from '@flowlib/user-auth/ui';
import '@flowlib/ui/styles';

<AuthenticatedInvect
  apiBaseUrl="/api/flowlib"
  basePath="/flowlib"
  InvectComponent={Invect}
  ShellComponent={InvectShell}
  theme="light"
/>;
```

Or compose manually:

```tsx
import { AuthProvider, AuthGate, SignInPage, UserButton } from '@flowlib/user-auth/ui';

<AuthProvider baseUrl="http://localhost:3000/flowlib">
  <AuthGate fallback={<SignInPage />}>
    <Invect apiBaseUrl="http://localhost:3000/flowlib" />
  </AuthGate>
</AuthProvider>;
```

## Exports

| Entry Point               | Content                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `@flowlib/user-auth`       | Backend plugin (Node.js)                                                                            |
| `@flowlib/user-auth/ui`    | Frontend components — `AuthProvider`, `AuthGate`, `SignInForm`, `UserButton`, `AuthenticatedInvect` |
| `@flowlib/user-auth/types` | Shared types                                                                                        |

## What It Does

**Backend** — Proxies auth routes (sign-in, session, OAuth) at `/plugins/auth/*`. Resolves sessions on every Invect API request. Maps Better Auth roles to Invect RBAC roles.

**Frontend** — `AuthProvider` for session state, `AuthGate` for conditional rendering, `SignInForm` / `UserButton` for auth UI.

## License

[MIT](../../../LICENSE)
