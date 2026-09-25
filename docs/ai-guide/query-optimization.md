---
sidebar_position: 3
sidebar_label: Query Optimization
---

# Query Optimization

How to list, page, and aggregate without a full scan. These rules match `main` (0.8.0 plus unreleased 0.9 key indexes).

Also see: [List queries](../query-lists.md) · [Query aggregates](../query-aggregates.md) · [Read models](../read-models.md) · [QSP](../qsp.md) · [Configuration](../configuration.md) · [Upgrading](../upgrading.md)

```typescript
import { Entity, FilterOp, Query, or } from "bunsane";
```

`Query.filterOp` is the same object as `FilterOp`.

## A bounded list

```typescript
const users = await new Query()
  .with(UserTag)
  .with(EmailComponent)
  .take(20)
  .exec();
```

There is no `.limit()` on `Query`. `.take(n)` is the limit. Read-model queries use `.limit()` — that is a different API.

Unsorted multi-component pages and `count()` drive from one leaf and probe the others with `EXISTS`. They do not use `INTERSECT`.

## Filters

Pass filters as `{ filters }` or as `Query.filters(...)`, which returns that object. Build each clause with `Query.filter` so the field name stays a literal.

```typescript
const users = await new Query()
  .with(
    EmailComponent,
    Query.filters(Query.filter("value", FilterOp.EQ, "john@example.com")),
  )
  .take(1)
  .exec();

const inStock = await new Query()
  .with(ProductInventoryComponent, {
    filters: [
      Query.filter("quantity", FilterOp.GT, 0),
      Query.filter("sku", FilterOp.LIKE, "PROD-%"),
    ],
  })
  .take(50)
  .exec();
```

`.with()` rejects a field name that is not a key of that component (0.7+). An unregistered component throws.

`.without()` excludes a component. It never routes to [QSP](../qsp.md).

```typescript
const active = await new Query()
  .with(UserTag)
  .without(SoftDeletedTag)
  .take(50)
  .exec();
```

`or()` matches any branch. OR does not route to QSP. Cannot combine with `groupBy`.

```typescript
const either = await new Query()
  .with(UserTag)
  .with(or([
    { component: EmailComponent, filters: [Query.filter("value", FilterOp.EQ, email)] },
    { component: PhoneComponent, filters: [Query.filter("number", FilterOp.EQ, phone)] },
  ]))
  .take(20)
  .exec();
```

### Operators

| Operator | Use |
|----------|-----|
| `EQ` `NEQ` | Equality. `EQ` on an indexed scalar uses the key index. |
| `GT` `GTE` `LT` `LTE` | Ranges. Index the field. |
| `LIKE` `ILIKE` | Patterns. A leading `%` will not seek a key index. `ILIKE` does not route to QSP. |
| `IN` `NOT_IN` | Lists. Empty `IN` is SQL `FALSE`. Empty `NOT_IN` is SQL `TRUE`. A non-array throws. |
| `IS_NULL` `IS_NOT_NULL` | Missing key, JSON `null`, or `''`. Pass `null` as the value. |
| `CONTAINS` `CONTAINED_BY` `HAS_ANY` `HAS_ALL` | JSON array containment. Needs a GIN index, not a key index. Not a QSP op. |

Boolean filters compare JSON text (`data->>'f' = 'true'`). `"yes"`, `"1"`, and `"t"` do not match (0.7+).

Numeric filters compare `bunsane_num_v1(data->>'f')`. Non-numeric text is NULL, not a cast error (0.9, unreleased). You do not restate a regex predicate, and there is no `idx_*_numeric` index to maintain.

## Pagination

### `take` + `hasNextPage`

On the legacy path, explicit `.take(N)` fetches N+1 rows, trims to N, and sets `getLastRouteInfo().hasNextPage`. The default limit does not. A QSP-routed exec (`surface: 'rm'`) always sets `hasNextPage`, including when the only limit is the default cap, because the `rm_` fetch uses limit+1. You do not need a second `.count()` for a load-more UI.

```typescript
const q = new Query()
  .with(OrderStatusComponent)
  .with(OrderInfoComponent)
  .with(OrderTimelineComponent)
  .sortBy(OrderTimelineComponent, "createdAt", "DESC")
  .take(20);

const items = await q.exec();
const { hasNextPage, routed, surface, entitySortPlan } = q.getLastRouteInfo();
```

`surface` is `'rm'` when [QSP](../qsp.md) served the page, otherwise `'legacy'`. `entitySortPlan` is `'index' | 'probe' | 'fallback'` for `sortByCreatedAt` / `sortByUpdatedAt` (0.9, unreleased).

`.count()` ignores pagination. It is a second scan. Use it when the UI needs a total, and cache that total. `estimatedCount` falls back to an exact count — do not treat it as a cheap filtered total.

`.offset()` works and gets slower as the offset grows. Prefer a cursor.

### `sortedCursor`

Use this for every sorted page, including `sortByCreatedAt` / `sortByUpdatedAt`.

```typescript
const page1 = await new Query()
  .with(ProfileComponent)
  .sortBy(ProfileComponent, "createdAt", "DESC")
  .take(20)
  .exec();

const last = page1[page1.length - 1]!;
const profile = await last.get(ProfileComponent);
const token = Query.encodeSortedCursor(profile?.createdAt ?? null, last.id);

const page2 = await new Query()
  .with(ProfileComponent)
  .sortBy(ProfileComponent, "createdAt", "DESC")
  .take(20)
  .sortedCursor(token) // direction defaults to 'after'
  .exec();
```

Rules:

- `.sortedCursor()` without a sort throws.
- The token width must match the number of sort keys (0.8+). A single-key token still decodes. `encodeSortedCursor([])` throws. A malformed token throws.
- `.sortedCursor(token, "before")` pages backward (0.8+). QSP can route `before` and `nullsFirst` when the list is otherwise covered (0.9, unreleased).
- `.cursor(id)` pages by entity id only. It throws if any `sortBy`, `sortByCreatedAt`, or `sortByUpdatedAt` is set. Drop the sort, or switch to `sortedCursor`.
- `.sortBy()` requires a preceding `.with()` of that component, and cannot combine with an entity-timestamp sort.
- Tie order follows the sort direction (0.9, unreleased). A DESC sort breaks equal keys with `entity_id DESC`, not ASC. A cursor issued by 0.8 inside a tie group can skip or repeat that group once.
- Entity timestamp pages use UTC milliseconds on every page. Sub-millisecond ties fall through to entity id (0.9, unreleased).

### Several sort keys (0.8+)

```typescript
const page = await new Query()
  .with(OrderComponent)
  .sortBy(OrderComponent, "status", "ASC")
  .sortBy(OrderComponent, "total", "DESC")
  .take(20)
  .exec();

const last = page[page.length - 1]!;
const row = await last.get(OrderComponent);
const token = Query.encodeSortedCursor(
  [row?.status ?? null, row?.total ?? null],
  last.id,
);

const prev = await new Query()
  .with(OrderComponent)
  .sortBy(OrderComponent, "status", "ASC")
  .sortBy(OrderComponent, "total", "DESC")
  .take(20)
  .sortedCursor(token, "before")
  .exec();
```

The last key's direction is the tie direction. QSP does not cover a multi-key sort. Prefer one sort key when you want the `rm_` route.

## Key indexes (0.9, unreleased)

A single-key sort or filter on a key field walks the index and stops at the limit. That is the list plan you want.

```typescript
import { Component, CompData, CompositeIndex } from "bunsane";

@Component
export class EmailComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}
```

On a scalar, `indexed: true` creates `bk_<slug>_<hash>` = `((key), entity_id)`. It is not partial, and it is not GIN. Text, boolean, and `Date` keys use `(data->>'field')`. Numeric keys use `bunsane_num_v1(data->>'field')`. Details and the `@IndexedField` table: [Component best practices](./component-best-practices.md).

Equality on leading columns plus a sort on the next column needs a composite:

```typescript
@CompositeIndex<OrderComponent>(["status", "total"])
@Component
export class OrderComponent extends BaseComponent {
  @CompData({ indexed: true }) status: string = "open";
  @CompData({ indexed: true }) total: number = 0;
}
```

Measured on PostgreSQL 17, 1M entities (changelog): indexed top-20 sort 50 → 0.8 ms p50, keyset page 60 → 0.7 ms, filter + sort 84 → 1.2 ms.

These plans are not O(limit):

- Sort by a field with no key index. Full scan, then top-N. Development warns once per component field.
- `sortByCreatedAt()` / `sortByUpdatedAt()` **with** `.with()`, `.without()`, or `or()`. An adaptive probe walks entities over a window (`BUNSANE_ENTITY_SORT_PROBE`, default 5000) and falls back to a hash join when the page does not fill. `getLastRouteInfo().entitySortPlan` is `'probe'` or `'fallback'`.
- The accepted residual: `sortByCreatedAt().with(X)` when X is clustered in time stays on the previous plan plus about 10%. Use [QSP](../qsp.md) for that list.

`sortByCreatedAt()` **without** a membership filter is index-driven (`entitySortPlan: 'index'`). Combined with `.with()` / `.without()` / `or()`, those sorts also exclude soft-deleted entities (0.9, unreleased).

## Bound every `exec()`

```typescript
// BAD — fills the default cap. Throws in development.
await new Query().with(OrderTag).exec();

// GOOD
await new Query().with(OrderInfoComponent).take(100).exec();
```

`BUNSANE_DEFAULT_QUERY_LIMIT` defaults to 10000. `0` disables it. If a query has no `.take()` and the page fills the cap, `getLastRouteInfo().truncatedByDefaultLimit` is set. `NODE_ENV=development` throws instead (0.7+). Any other `NODE_ENV`, including unset, warns once and returns the truncated page.

Scheduler tasks without `maxEntitiesPerExecution` are capped at 1000 entities. Set the cap, or `.take()` a smaller page, on purpose.

## Prevent N+1

Hydrate in the list query. Do not `get()` a component the list did not load if you can avoid the round trip — and never run a `Query` per row.

```typescript
const users = await new Query()
  .with(UserTag)
  .eagerLoadComponents([ProfileComponent, EmailComponent])
  // .populate() loads every component on the match set.
  // Use the return value: const q = new Query().populate()
  .take(100)
  .exec();

for (const user of users) {
  const profile = await user.get(ProfileComponent); // cache hit when eager-loaded
}
```

`.populate()` marks the same instance loaded. Callers must use the return value or the type still says every component is optional (0.7+).

Inside a GraphQL request, archetype field resolvers use the request DataLoader. A loader `null` is authoritative for an optional component — the resolver does not fall through to another `get()`. Relation loaders reject on a database error. They do not resolve `[]`.

If `dbQueryCount` grows with page size, the missing piece is batching, not a different SQL join:

- `eagerLoadComponents` / `.populate()` for components on the same entity
- `@ArcheTypeFunction({ batch: true })` for a computed field that queries (0.8+). See [Service patterns](./service-patterns.md).
- One child query with `FilterOp.IN`, not a query per parent:

```typescript
const orderIds = orders.map((order) => order.id);
const items = await new Query()
  .with(
    LineItemComponent,
    Query.filters(Query.filter("orderId", FilterOp.IN, orderIds)),
  )
  .take(500)
  .exec();
```

A cross-entity join that you run on every request belongs in a [read model](../read-models.md), not in this loop.

## Aggregates — not `exec()` + reduce

`exec()` hydrates entities. Totals, last-event, and open-row counts are SQL. See [Query aggregates](../query-aggregates.md).

```typescript
const lastOrder = await new Query()
  .with(OrderInfoComponent)
  .with(OrderTimelineComponent)
  .groupBy(OrderInfoComponent, "customerId")
  .maxBy(OrderTimelineComponent, "createdAt");

const total = await new Query()
  .with(OrderAmountComponent)
  .sum(OrderAmountComponent, "amount"); // Promise<number>, 0 if none match

const mean = await new Query()
  .with(OrderAmountComponent)
  .average(OrderAmountComponent, "amount");

const totals = await new Query()
  .with(OrderInfoComponent)
  .with(OrderAmountComponent)
  .groupBy(OrderInfoComponent, "customerId")
  .sumBy(OrderAmountComponent, "amount");

Query.filter("completedAt", FilterOp.IS_NULL, null);
```

`.sum(Ctor, field)` and `.average(Ctor, field)` are scalar totals over the match set. The component must already be in `.with()`. They do not use `.groupBy()`.

`countBy`, `sumBy`, `maxBy`, `minBy`, and `avgIntervalMinutesBy` throw if you skip `.groupBy()`. `sumBy` / `maxBy` / `minBy` also throw if the metric component is not in `.with()`. `maxBy` / `minBy` default to a timestamptz cast. Pass `{ cast: "numeric" }` for numbers.

A join of two entity types is a read model (`m3_*`), not QSP and not `exec()`:

```typescript
import { ReadModel } from "bunsane/core/readmodel";

const paid = await ReadModel(InvoiceReport)
  .where("status", "paid")
  .sum("total");
```

`ReadModel(T).rows()` and `.listPage()` throw when `.limit()` or `.offset()` is set without `.orderBy()` (0.8+). Unbounded `.rows()` is allowed. The generated GraphQL list field is `${Name}Page { nodes, hasNextPage }`, not a bare list. `offset + limit` must be ≤ 10000. Reads go through the DB gateway and can throw `DbStatementTimeoutError` or `DbAdmissionTimeoutError`.

QSP `rm_*` tables accelerate a covered entity list. They are not an aggregate store.

## QSP, briefly

`BUNSANE_QSP` is read at call time: unset or anything else is `off`; `shadow` projects and checks parity; `route` serves when the projection is READY and the query is covered. `init()` starts the reconcile sweep for `shadow` and `route`. Do not start a second sweep.

A route requires an exact `.with()` set. It refuses OR, `.without()`, `findById`, empty `IN`, operators outside `= != > < >= <= IN NOT IN`, multi-key sorts, and an id cursor combined with a sort. `before` and `nullsFirst` can route (0.9, unreleased). Empty tags and multi-archetype lists are not covered. Full rules: [QSP](../qsp.md).

## Patterns

### One row by a unique field

```typescript
async function findUserByEmail(email: string): Promise<Entity | null> {
  const results = await new Query()
    .with(UserTag)
    .with(
      EmailComponent,
      Query.filters(Query.filter("value", FilterOp.EQ, email)),
    )
    .take(1)
    .exec();
  return results[0] ?? null;
}
```

Index `EmailComponent.value`. Otherwise this is a scan that happens to return one row.

### Load-more

```typescript
async function listOrders(pageSize = 20, cursorToken?: string) {
  let q = new Query()
    .with(OrderStatusComponent)
    .with(OrderTimelineComponent)
    .sortBy(OrderTimelineComponent, "createdAt", "DESC")
    .take(pageSize);

  if (cursorToken) q = q.sortedCursor(cursorToken);

  const items = await q.exec();
  const { hasNextPage } = q.getLastRouteInfo();

  let nextCursor: string | undefined;
  if (hasNextPage && items.length > 0) {
    const last = items[items.length - 1]!;
    const timeline = await last.get(OrderTimelineComponent);
    nextCursor = Query.encodeSortedCursor(timeline?.createdAt ?? null, last.id);
  }

  return { items, hasNextPage: hasNextPage ?? false, nextCursor };
}
```

### Optional criteria

```typescript
async function searchUsers(criteria: { email?: string; verified?: boolean }) {
  let query = new Query().with(UserTag);

  if (criteria.email) {
    query = query.with(
      EmailComponent,
      Query.filters(Query.filter("value", FilterOp.LIKE, `%${criteria.email}%`)),
    );
  }
  if (criteria.verified === true) query = query.with(EmailVerifiedTag);
  else if (criteria.verified === false) query = query.without(EmailVerifiedTag);

  return query.take(100).exec();
}
```

A leading-wildcard `LIKE` and `.without()` stay off QSP. If this search is hot, filter an indexed column with a prefix or equality, and model "unverified" as a value rather than an exclusion.

### Explain a slow page

```typescript
const plan = await new Query()
  .with(OrderInfoComponent)
  .sortBy(OrderInfoComponent, "orderNumber", "ASC")
  .take(20)
  .explainAnalyze(true);
```

If the plan is a seq scan plus a sort, the sort field has no key index. Add `@CompData({ indexed: true })` and let boot reconcile `bk_`.

## Summary

| Do | Don't |
|----|-------|
| `.take(N)` on the legacy path; read `hasNextPage` (QSP sets it too) | Exact `.count()` on every infinite-scroll page |
| `sortedCursor`, including `'before'` | `.cursor(id)` together with any sort (throws) |
| `@CompData({ indexed: true })` on filter and sort fields | Assume `indexed: true` creates GIN, or restate a numeric regex |
| `@CompositeIndex` for equality-then-sort | A single-field index for `status = ? ORDER BY total` |
| QSP for `sortByCreatedAt().with(X)` on a time-clustered component | Expect that residual to be index-driven |
| `eagerLoadComponents`, `IN`, `batch: true` | `entity.get` or a nested `Query` per list row |
| `.sum` / `.average`, or `groupBy` + `sumBy` / `maxBy`, or a read model | `exec()` + `reduce` |
| One sort key when you want QSP | Multi-key sort on an `rm_` route (refused) |
