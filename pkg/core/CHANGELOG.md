# @flowlib/core

## 0.0.6

### Patch Changes

- [#12](https://github.com/robase/flowlib/pull/12) [`8c079ae`](https://github.com/robase/flowlib/commit/8c079aeb68ef33409c96d6db762aed5715a39399) Thanks [@robase](https://github.com/robase)! - # Deprecate the legacy `Flowlib` class — use `createFlowlib()` instead

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

- Updated dependencies []:
  - @flowlib/action-kit@0.0.6
  - @flowlib/actions@0.0.6
  - @flowlib/db@0.0.6
  - @flowlib/layouts@0.0.6
  - @flowlib/sdk@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [[`7d4db0c`](https://github.com/robase/flowlib/commit/7d4db0c537d77410bc76d968a1ecd7da672da5c8)]:
  - @flowlib/db@0.0.5
  - @flowlib/action-kit@0.0.5
  - @flowlib/actions@0.0.5
  - @flowlib/layouts@0.0.5
  - @flowlib/sdk@0.0.5

## 0.0.4

### Patch Changes

- version control overhaul

- Updated dependencies []:
  - @flowlib/action-kit@0.0.4
  - @flowlib/actions@0.0.4
  - @flowlib/layouts@0.0.4
  - @flowlib/sdk@0.0.4

## 0.0.3

### Patch Changes

- [#7](https://github.com/robase/flowlib/pull/7) [`4dee9d6`](https://github.com/robase/flowlib/commit/4dee9d67222426ee5ce16ab1c8a87f1b33144870) Thanks [@robase](https://github.com/robase)! - fix: ci test ([#7](https://github.com/robase/flowlib/issues/7))

- Updated dependencies []:
  - @flowlib/action-kit@0.0.3
  - @flowlib/actions@0.0.3
  - @flowlib/layouts@0.0.3
  - @flowlib/sdk@0.0.3

## 0.0.2

### Patch Changes

- [`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe) Thanks [@robase](https://github.com/robase)! - welcome flowlib!

- Updated dependencies [[`32eff5d`](https://github.com/robase/flowlib/commit/32eff5d0d9ddf8f2d4e7045a5c5d0066c85d09fe)]:
  - @flowlib/action-kit@0.0.2
  - @flowlib/actions@0.0.2
  - @flowlib/layouts@0.0.2
  - @flowlib/sdk@0.0.2

## 0.0.12

### Patch Changes

- Pre release

- Updated dependencies []:
  - @flowlib/action-kit@0.0.2
  - @flowlib/actions@0.0.2
  - @flowlib/layouts@0.0.12
  - @flowlib/sdk@0.0.2

## 0.0.11

### Patch Changes

- debug nextjs

- Updated dependencies []:
  - @flowlib/layouts@0.0.11

## 0.0.10

### Patch Changes

- fix db tables

- Updated dependencies []:
  - @flowlib/layouts@0.0.10

## 0.0.9

### Patch Changes

- audit packages

- Updated dependencies []:
  - @flowlib/layouts@0.0.9

## 0.0.8

### Patch Changes

- fix frontend api

- Updated dependencies []:
  - @flowlib/layouts@0.0.8

## 0.0.7

### Patch Changes

- fix dynamic imports

- Updated dependencies []:
  - @flowlib/layouts@0.0.7

## 0.0.6

### Patch Changes

- secure-exec -> quickjs revert

- Updated dependencies []:
  - @flowlib/layouts@0.0.6

## 0.0.5

### Patch Changes

-

- Updated dependencies []:
  - @flowlib/layouts@0.0.5

## 0.0.4

### Patch Changes

- fix: nextjs imports

- Updated dependencies []:
  - @flowlib/layouts@0.0.4

## 0.0.3

### Patch Changes

- fix core exports issue

- Updated dependencies []:
  - @flowlib/layouts@0.0.3

## 0.0.2

### Patch Changes

- fix cli commands, replace quickjs wasm with secure-exec

- Updated dependencies []:
  - @flowlib/layouts@0.0.2
