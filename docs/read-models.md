---
sidebar_position: 8
sidebar_label: Read models
---

# Read models (`@ReadModel`)

Derived tables for **cross-entity** reads. One row per join pair. SQL `WHERE` / `GROUP BY` / `SUM` with no entity hydrate.

Prefix **`m3_`** so they cannot collide with QSP list tables (`rm_*`).

Related: [Query aggregates](./query-aggregates.md) · [QSP](./qsp.md) · [List queries](./query-lists.md)

`ReadModel` and `Project` are not on the root barrel.

## vs QSP vs Query

| | QSP `rm_*` | `@ReadModel` `m3_*` | `Query.groupBy` |
|--|------------|---------------------|-----------------|
| Grain | One row per **entity** | One row per **join pair** | No table — SQL over component partitions |
| Purpose | Covered list id-sets | Cross-entity filter + aggregate | Same-entity aggregate |
| Join | None | Exactly two components on **different** entities | Driving leaf + `EXISTS` on one entity |
| Write | Dual-write on `save` / delete | Same transaction as `Entity.save` / `doDelete` | None |
| Default | Off (`BUNSANE_QSP`) | On when a class is registered | Always |

Do not use QSP as a join store. Do not use `@ReadModel` as a list coverage table. A hot same-entity list belongs on a [key index](./database.md#key-indexes) or on [QSP](./qsp.md).

## Declare

```typescript
import { ReadModel, Project } from "bunsane/core/readmodel";

@ReadModel({
  name: "InvoiceReport", // table m3_invoicereport; default = class name
  from: [InvoiceComponent, CustomerComponent],
  join: { on: "InvoiceComponent.customerId = CustomerComponent.id" },
  refresh: "sync",
  rebuildable: true,
})
class InvoiceReport {
  @Project(InvoiceComponent, "total") total!: number;
  @Project(InvoiceComponent, "status") status!: string;
  @Project(InvoiceComponent, "paidAt") paidAt!: Date;
  @Project(CustomerComponent, "region") region!: string;
}
```

**Join string:** `LeftComp.fkField = RightComp.id`. The right side is the **entity id** of the component on the other entity, not a JSON field named `id`. Identifier-checked. Typed joins are not in this release.

| Option | Meaning |
|--------|---------|
| `name` | Logical name / GraphQL type. Table is `m3_<lowercase name>` |
| `from` | Exactly two component constructors, different entities |
| `join.on` | FK on the left JSON → right `entity_id` |
| `refresh` | `sync` (default) writes through in the save transaction. `async` currently aliases `sync` (no outbox) |
| `rebuildable` | Rebuild from JSONB on shape-hash drift (recommended `true`) |

Import the class from your app entry (same rule as components) so the decorator registers before `init()`.

`App.init()` calls `InitializeReadModels()` after partitions exist: create `m3_*` if missing, rebuild from JSONB on first boot or shape change.

## Read

```typescript
import { ReadModel } from "bunsane/core/readmodel";

const total = await ReadModel(InvoiceReport)
  .where("status", "paid")
  .sum("total"); // number

const byRegion = await ReadModel(InvoiceReport)
  .where("status", "paid")
  .where("paidAt", "gte", start)
  .where("paidAt", "lte", end)
  .groupBy("region")
  .sum("total");
// [{ region: "west", total: 1200 }, ...]

const byDay = await ReadModel(InvoiceReport)
  .where("paidAt", "gte", start)
  .timeBucket("paidAt", "day", -420)
  .sum("total");
// [{ bucket: "2026-07-01", total: ... }, ...]
```

| Method | Notes |
|--------|--------|
| `where(field, value)` | Equality |
| `where(field, op, value)` | `eq` `ne` `gt` `gte` `lt` `lte` `in` |
| `whereIn` / `whereNotIn` | `IN` / `NOT IN` |
| `groupBy(field)` | SQL `GROUP BY` that column |
| `timeBucket(field, "day" \| "week", tzOffsetMinutes?)` | Requires a Date `@Project`. Offset matches `Date.getTimezoneOffset()`: UTC+7 is `-420`. Day buckets are `to_char`; week buckets are `date_trunc('week')` then `to_char` |
| `sum` / `avg` | Numeric `@Project`. With `groupBy` / `timeBucket` → rows; else scalar (`0` when empty) |
| `count` | Scalar |
| `countBy` | Requires `groupBy` or `timeBucket` |
| `orderBy(field, "ASC" \| "DESC")` | Projected field, or `leftEntityId` / `rightEntityId`. A later call for the same column replaces the direction. Anything else throws |
| `limit(n)` | Non-negative integer, capped at 10000 |
| `offset(n)` | Non-negative integer |
| `rows()` | Join-pair rows. Unbounded when you set neither limit nor offset. Does not hydrate entities |
| `listPage()` | Requires `.limit(n)`. Fetches `n + 1`. Returns `{ nodes, hasNextPage }` |

### Ordered pages (0.8+)

`.rows()` and `.listPage()` throw if `.limit()` or `.offset()` is set without `.orderBy(...)`. An unordered page is not stable. Unbounded `.rows()` (no limit, no offset) does not require an order and has no default limit.

Ordered reads append `left_entity_id, right_entity_id` ASC after your keys, unless you already ordered by that column.

```typescript
await ReadModel(InvoiceReport)
  .orderBy("issuedAt", "DESC")
  .limit(50)
  .offset(100)
  .rows();

const page = await ReadModel(InvoiceReport)
  .orderBy("total", "DESC")
  .limit(50)
  .listPage();
// page.nodes, page.hasNextPage
```

Pass the returned `trx` from `db.transaction` when the read must see uncommitted writes in that transaction. A caller-supplied `trx` is not given an extra admission permit.

### Timeouts (0.8+)

`count`, `countBy`, `rows`, `listPage`, `sum`, and `avg` run through the DB gateway. A query that used to run with no deadline can now fail with `DbStatementTimeoutError` or `DbAdmissionTimeoutError` from `bunsane/database/gateway`. Size `DB_REQUEST_TIMEOUT` for the slowest legitimate report. Full rebuilds and `m3_*` DDL use the background lane (`DB_DDL_TIMEOUT`, default 10 minutes).

## GraphQL

Query fields only. There are no read-model mutations.

For a model named `InvoiceReport` with a numeric `total` (0.8+):

```graphql
invoiceReports(
  where: [ReadModelWhere!]
  limit: Int
  offset: Int
  orderBy: String
  direction: String
): InvoiceReportPage!

invoiceReportCount(where: [ReadModelWhere!]): Int!
invoiceReportSum(metric: String, groupBy: String, where: [ReadModelWhere!]): [InvoiceReportAggregate!]!
invoiceReportAvg(metric: String, groupBy: String, where: [ReadModelWhere!]): [InvoiceReportAggregate!]!
```

```graphql
type InvoiceReportPage {
  nodes: [InvoiceReport!]!
  hasNextPage: Boolean!
}
```

The list field is `${name}s` (first letter lowercased). It is not `[InvoiceReport!]!`. Select `nodes { … }`.

| Arg | Default |
|-----|---------|
| `limit` | 1000, capped at 10000 |
| `offset` | 0 |
| `orderBy` | `leftEntityId` |
| `direction` | `ASC` |

The resolver always orders before it limits, so a GraphQL page does not hit the TypeScript "order required" throw. It fetches `limit + 1` and sets `hasNextPage`. `offset + limit` must be ≤ 10000 or the resolver throws. `offset` must be a non-negative integer.

Sum and avg still return a list of aggregate rows. `metric` defaults to the first numeric `@Project`. Resolvers are live.

Clients that selected fields directly on `invoiceReports` must select them under `nodes`. See [Upgrading](./upgrading.md#07--08).

## Lifecycle

- **Write-through** in the same transaction as `Entity.save` / `doDelete`.
- **Shape-hash drift** drops the table and rebuilds from JSONB when `rebuildable` is set.
- Grain is **one row per join pair**, not a daily fact `(outlet, day)`. Bucket a Date column at read time (`timeBucket`).
- No outbox, no multi-instance fan-out, no typed join.

Sibling components that are **not** in `from` (a void tag on the right entity, for example) are not in the table. Filter those ids in the service, or project a field you can `where`.
