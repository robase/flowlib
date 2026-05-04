---
'@flowlib/core': minor
---

# Deprecate the legacy `Flowlib` class — use `createFlowlib()` instead

The `Flowlib` class in `@flowlib/core` is now marked `@deprecated`. It will continue to work for the foreseeable future (no removal date set), but new code should use `createFlowlib()`:

```diff
- import { Flowlib } from '@flowlib/core';
+ import { createFlowlib } from '@flowlib/core';

- const flowlib = new Flowlib(config);
- await flowlib.initialize();
+ const flowlib = await createFlowlib(config);

- const flow = await flowlib.createFlow({ name: 'My Flow' });
- const flows = await flowlib.listFlows();
+ const flow = await flowlib.flows.create({ name: 'My Flow' });
+ const flows = await flowlib.flows.list();
```

## Why

The legacy class shipped a flat method surface (`flowlib.createFlow()`, `flowlib.listFlows()`, `flowlib.startFlowRun()`, …) that grew to ~50+ methods on a single object. The modern factory groups them into namespaced sub-APIs (`flowlib.flows.*`, `flowlib.runs.*`, `flowlib.credentials.*`, `flowlib.chat.*`, `flowlib.triggers.*`, etc.) so the surface is discoverable without scrolling.

The factory also collapses the two-phase `new Flowlib(config)` → `await initialize()` lifecycle into a single awaitable construction step, removing the "did I forget to call initialize?" footgun.

## Status of consumers

All three framework adapters (`@flowlib/express`, `@flowlib/nestjs`, `@flowlib/nextjs`) already use `createFlowlib()`. The only first-party consumers still on the legacy class are:

- `examples/express-drizzle/seed/run-seed.ts` — example seed script
- Plugin docs/JSDoc that reference it for back-compat

If you're building a new app, use `createFlowlib()`. If you have an existing app on the legacy class, no immediate action is needed — the class will keep working until a future major release announces a removal date.
