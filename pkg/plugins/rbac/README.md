<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/rbac</h1>

<p align="center">
  Role-based access control plugin for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Adds flow-level permissions, sharing UI, and access control enforcement to Flowlib. Requires [`@flowlib/user-auth`](../auth) for session resolution.

## Install

```bash
pnpm add @flowlib/rbac
```

## Backend

```ts
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [
    auth({ globalAdmins: [{ email: 'admin@example.com', pw: 'secret' }] }), // Must come first
    rbac(),
  ],
});

app.use('/flowlib', flowlibRouter);
```

## Frontend

```tsx
import { Flowlib } from '@flowlib/ui';
import { rbacFrontend } from '@flowlib/rbac/ui';

<Flowlib apiBaseUrl="http://localhost:3000/flowlib" plugins={[rbacFrontend]} />;
```

The plugin contributes sidebar items, an access management page, a flow-level access panel tab, and a share button in the flow editor header.

## Exports

| Entry Point          | Content                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `@flowlib/rbac`       | Backend plugin (Node.js)                                                              |
| `@flowlib/rbac/ui`    | Frontend plugin — `rbacFrontend`, `RbacProvider`, `ShareFlowModal`, `FlowAccessPanel` |
| `@flowlib/rbac/types` | Shared types — `FlowAccessRecord`, `FlowAccessPermission`, etc.                       |

## License

[MIT](../../../LICENSE)
