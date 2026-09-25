---
sidebar_position: 4
---

# Database

BunSane stores entities and components in PostgreSQL. `App.init()` creates the tables and indexes below. You do not write migrations for those objects.

This page describes `main`. Key indexes are (0.9, unreleased). npm `latest` is still 0.6.1. See [Upgrading](./upgrading.md).

## Connection

Set `DB_CONNECTION_URL`, or `POSTGRES_HOST` + `POSTGRES_USER` + `POSTGRES_DB`. The URL wins when both are set.

```bash title=".env"
DB_CONNECTION_URL="postgres://username:password@localhost:5432/myapp"
```

The database must exist before the process starts. Pool size, timeouts, and admission are in [Configuration](./configuration.md).

## Tables BunSane creates

| Object | When | What it holds |
|--------|------|----------------|
| `entities` | Every boot | `id` (UUID), `created_at`, `updated_at`, `deleted_at` (`timestamptz`) |
| `components` | Every boot | One JSONB row per component. LIST-partitioned by `type_id` unless `BUNSANE_PARTITION_STRATEGY=hash` |
| `bunsane_num_v1(text)` | Every boot | Immutable numeric-or-NULL cast. Never replaced in place |
| `m3_<name>`, `m3_readmodel_state` | A `@ReadModel` class is registered | Cross-entity rows. See [Read models](./read-models.md) |
| `projection_state`, `rm_<name>` | `BUNSANE_QSP` is `shadow` or `route` | Optional list accelerator. The table name is lowercased (`OrderList` → `rm_orderlist`). See [QSP](./qsp.md) |
| `bunsane_locks` | First postgres-lease lock | Scheduler / `withLock` leases. Not created when the lock backend is `in-process` |

`entity_components` is not created. Membership is `components` (`UNIQUE (entity_id, type_id)`).

`entities` also gets `idx_entities_deleted_null` (`id` where `deleted_at IS NULL`) and, on `main`, key indexes on `created_at` and `updated_at`.

Adding a component or a field does not require a hand-written migration. Register the class before `init()` (import it from your app entry). A component registered after boot still receives its key indexes.

## Key indexes

A **key index** is a btree named `bk_<slug>_<hash>` on `((key), entity_id)`. It is not partial (`WHERE deleted_at IS NULL` is applied by the query, not the index), so the planner keeps expression statistics. One index serves `=`, ranges, both sort directions, both `NULL` placements, and keyset pages.

| Marker | Index |
|--------|--------|
| `@CompData({ indexed: true })` on a scalar | Key index. Text, enum, boolean, and `Date` use `(data->>'field')`. A `number` field uses `(bunsane_num_v1(data->>'field'))` |
| `@CompData({ indexed: true })` on an array or object | GIN on `(data->'field')` with `jsonb_path_ops`. Not a sort key |
| `@CompositeIndex(["status", "total"])` | `(status, total, entity_id)` on that component. Equality on the leading fields, sort or range on the next. Exported from `"bunsane"`. At least two fields; an unknown field fails boot |
| `entities.created_at` / `updated_at` | Key indexes for `sortByCreatedAt` / `sortByUpdatedAt`. Values are UTC milliseconds |

`@IndexedField` is not on the root barrel. Import it from `bunsane/core/decorators/IndexedField`. The default type is `"gin"`, not `"btree"`.

| `@IndexedField(...)` | What boot creates |
|----------------------|-------------------|
| `"btree"` | Key index on `(data->>'field', entity_id)`. `isDateField` is recorded only; the expression stays text |
| `"numeric"` | Key index on `bunsane_num_v1(data->>'field')`. Non-numeric text is NULL, not a cast error (0.9, unreleased) |
| `"gin"` | `USING GIN ((data->'field') jsonb_path_ops)`. Not a sort key. An explicit `"gin"` on a field that also has a key index is kept |
| `"hash"` | `USING HASH ((data->>'field'))`. Equality only |
| `"fulltext"` | `USING GIN (to_tsvector('english', data->'field'))`. Not a sort key |

```typescript
import { BaseComponent, Component, CompData, CompositeIndex } from "bunsane";
import { IndexedField } from "bunsane/core/decorators/IndexedField";

@CompositeIndex<Order>(["status", "total"])
@Component
class Order extends BaseComponent {
  @CompData({ indexed: true }) status: string = "open";
  @CompData({ indexed: true }) total: number = 0;
  @CompData({ arrayOf: String })
  @IndexedField("gin")
  tags: string[] = [];
}
```

Put `@CompositeIndex` above `@Component`.

### Index reconciler

`database/indexReconciler.ts` runs from `App.init()`:

- Creates missing `bk_` indexes. On real PostgreSQL the build is `CREATE INDEX CONCURRENTLY` (writes are not blocked). PGlite strips `CONCURRENTLY`.
- Rebuilds invalid indexes.
- Drops a legacy `idx_<leaf>_<field>_btree`, `_btree_date`, `_numeric`, or scalar `_gin` **only after** its `bk_` replacement is valid. QSP's `idx_rm_<lowercase>__cover` (for example `idx_rm_orderlist__cover`) is dropped the same way, after per-column `bk_` indexes exist.
- Does not drop indexes that lack the `bk_` prefix, except those legacy names. An index you created under another name is left alone.

Tables whose `reltuples` estimate is below `BUNSANE_INDEX_SYNC_MAX_ROWS` (default 100000) are indexed during `init()`. Larger tables, and unanalyzed tables bigger than 64 MB, are indexed by a background task after `init()`, under `withLock("bunsane:index-reconcile")`, so only one instance builds. Shutdown does not wait past the grace budget; the next boot repairs an invalid index. Lists stay correct while a background build is running; they are not yet fast.

Invalid values for `BUNSANE_INDEX_SYNC_MAX_ROWS` fail `init()` (0.9, unreleased).

## Transactions

Pass one transaction handle into every read and write that must commit together. The default export is a lazy proxy: `db.transaction`, `db.begin`, and `db.unsafe` forward to the live client. `db === getDb()` is false, and `db instanceof SQL` is false. Use `getDb()` when a library checks identity.

```typescript
import { Entity } from "bunsane";
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
  const fromAccount = await Entity.FindById(fromAccountId, trx);
  const toAccount = await Entity.FindById(toAccountId, trx);
  if (!fromAccount || !toAccount) throw new Error("Missing account");

  const fromBalance = await fromAccount.get(BalanceComponent, { trx });
  if (!fromBalance || fromBalance.amount < amount) {
    throw new Error("Insufficient funds");
  }
  const toBalance = await toAccount.get(BalanceComponent, { trx });

  await fromAccount.set(
    BalanceComponent,
    { amount: fromBalance.amount - amount },
    { trx },
  );
  await fromAccount.save(trx);

  await toAccount.set(
    BalanceComponent,
    { amount: (toBalance?.amount ?? 0) + amount },
    { trx },
  );
  await toAccount.save(trx);

  return { success: true };
});
```

A throw rolls the database transaction back. Pass `trx` into `FindById`, `get` / `set` / `remove` (`{ trx }`), and `save`. Finish every check before the first `save(trx)`.

Dirty flags flip as soon as that save's own statements succeed — `save(trx)` marks the instance clean immediately on your handle, so a second `save()` of the same entity in the same transaction is an update, not a duplicate insert. If the surrounding transaction then rolls back — this callback throwing, or the framework's own transaction failing at `COMMIT` — the in-memory flags are restored (unpersisted/dirty again, removals re-queued; the QSP/read-model rows themselves are already rolled back by Postgres), so a retried `save()` reissues every statement instead of skipping a "clean" entity. This applies to any transaction opened through `db` / `getDb()` / `dbTransaction`, including a `trx.savepoint(...)` taken on one of those. A handle with no tracked end — `sql.reserve()`, or a transaction handle used after it already finished — keeps its flags applied regardless of what happens to the underlying connection.

`db.transaction` is Bun's transaction. It does not take an admission permit. `Entity.save` uses `dbTransaction` from `bunsane/database/gateway` when you do not pass `trx`, so that write gets one permit and can set `statement_timeout`. A `trx` you pass in stays on that handle and takes no extra permit. Use `dbTransaction` for your own multi-statement work when you want the same bound. Do not open a raw `BEGIN`.

`get()` returns `null` when the component is absent. A database error throws `ComponentLoadError` (0.7+). Let that throw leave the callback so the transaction rolls back.

## Raw SQL

Use the proxy's unsafe query when the builder cannot express the statement. Parameters are `$1`, `$2`, never interpolated input.

```typescript
import db from "bunsane/database";

const rows = await db.unsafe(
  "SELECT id FROM entities WHERE deleted_at IS NULL AND id = $1",
  [id],
);
```

There is no `db.query`. Tagged templates (`await db\`SELECT …\``) also work. Prefer [list queries](./query-lists.md) for entity filters and sorts so they hit key indexes.

## Prepared statements and PgBouncer

Bun prepares statements per connection. The framework does not keep a prepared-statement cache (removed in 0.7).

Behind PgBouncer **transaction** pooling, set `DB_DISABLE_PREPARE=true`. A prepared statement created on one backend does not exist on the next, and the write path can wedge. `?prepare=false` in the URL is not reliable. Put `statement_timeout` on the database role; `DB_STATEMENT_TIMEOUT` is ignored behind PgBouncer. Details: [Running behind PgBouncer](./configuration.md#running-behind-pgbouncer).

Do not run the test suite through PgBouncer. `DB_DISABLE_PREPARE=true` serializes object parameters as `"[object Object]"`.
