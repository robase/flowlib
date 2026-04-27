# D1 Transaction Audit (PR 3/14)

Audit of database transaction usage in `pkg/core/src/services/` to evaluate
risk under Cloudflare D1's limited transaction support.

D1 does **not** support multi-statement interactive transactions in the
classic SQL sense. The closest primitive is `db.batch([...])`, which executes
a list of prepared statements atomically as a single implicit transaction.
Drizzle's `drizzle-orm/d1` adapter exposes a `batch` API that maps onto this,
but `db.transaction(async (tx) => { ... })` (the interactive callback form)
is **not supported** on D1 and will throw at runtime.

## Findings

`grep -rn '\.transaction(' pkg/core/src/services/` returns **no matches**.

There are no service-layer callers of `.transaction(...)` in the current
core. Transactions are defined at the adapter abstraction layer only:

- `pkg/core/src/database/adapter.ts:89,138` — `transaction()` declared on the
  `FlowlibAdapter` / `RawFlowlibAdapter` interfaces. **Risk:** any future
  adapter consumer that calls `.transaction()` will fail at runtime on D1.
- `pkg/core/src/database/adapters/kysely-adapter.ts:323-329` — Kysely-backed
  implementation calls `dbInstance.transaction().execute(...)`. **Risk:** if
  this adapter is ever used with a D1-backed Kysely dialect, the call will
  fail. Today the Kysely adapter is not wired to D1, so this is latent.
- `pkg/core/src/database/adapter-factory.ts:341-343` — factory wiring that
  forwards `transaction()` to the underlying raw adapter. **Risk:** this is
  a passthrough; it inherits the risk of whichever raw adapter sits behind
  it. With D1, the raw adapter would need to either reject `.transaction()`
  with a clear error or shim it onto `db.batch()` for the limited cases
  where a sequence of independent statements is acceptable.

## Recommendations (follow-up work, out of scope for PR 3)

1. Decide whether the D1 driver should throw a typed error when something
   eventually calls `connection.driver.transaction(...)`, or whether to
   provide a `batch()`-based shim for the limited atomic-write use case.
2. Add a smoke test that exercises `createDatabaseDriver({ driver: 'd1', ... })`
   in a Workers-like environment (e.g. `@cloudflare/workers-types` +
   `miniflare`) to catch regressions.
3. When introducing transactional service code in the future, gate it
   behind a capability check on the active driver type rather than calling
   `.transaction()` unconditionally.

## Conclusion

PR 3 (D1 driver) ships safely against the current `pkg/core/src/services/`
surface — no service today depends on transactional semantics. The latent
risk lives in the adapter layer, where the Kysely adapter and any future
service that calls `adapter.transaction(...)` would be incompatible with
D1 until either a shim or a capability check is added.
