---
sidebar_position: 5
sidebar_label: List queries
---

# List queries

How to build a **filter + sort + page + hydrate** endpoint. `Query` has no `.limit()`; page size is `.take(n)`.

Related: [Query aggregates](./query-aggregates.md) · [QSP](./qsp.md) · [Read models](./read-models.md) · [Query optimization](./ai-guide/query-optimization.md)

Index-ordered sorts and tie order below are (0.9, unreleased). Multi-key `sortedCursor` is (0.8+).

## Default shape

```typescript
import { Query, FilterOp } from "bunsane";

const q = new Query()
  .with(StatusComp, Query.filters(Query.filter("status", FilterOp.EQ, status)))
  .with(InfoComp)
  .sortBy(InfoComp, "createdAt", "DESC")
  .take(pageSize);

const items = await q.populate().exec();
const info = q.getLastRouteInfo();
```

Chain `.populate()`. Calling it and ignoring the return value still loads rows, but TypeScript keeps every component optional.

| Prefer | Avoid |
|--------|--------|
| `.take(n)` and `hasNextPage` | `.count()` on every load-more request |
| One indexed sort key + `sortedCursor` | Deep `.offset(10000)` |
| `@CompData({ indexed: true })` on filter and sort fields | Sorting a field with no key index |
| `.populate()` or `.eagerLoadComponents([...])` | `await entity.get(C)` in a loop |
| Batched `@ArcheTypeFunction({ batch: true })` | A query per parent row |

Build filters with `Query.filter` / `Query.filters` so the field name stays a key of that component. `.with(Ctor, { filters })` rejects names that are not keys (0.7+).

## Which sorts stop at the limit

A **single-key** `.sortBy(Ctor, field)` walks a key index and stops at `.take(n)` when that field has a key index: `@CompData({ indexed: true })` on a scalar, or `@IndexedField("btree" | "numeric")`. The scan is two index-ordered branches (non-null keys, then NULL keys, or the reverse when `nullsFirst` is true).

`@CompositeIndex(["status", "total"])` makes `status = …` plus `sortBy(..., "total")` index-eligible on that component. Equality must cover every field before the sort field. See [Database](./database.md#key-indexes).

These are not index-ordered end to end:

- A sort field with no key index. The engine scans and keeps the top N. In `NODE_ENV=development` you get one warning per component field: `sortBy(Component, "field") has no key index`. It does not throw. Add `@CompData({ indexed: true })` or a composite index.
- `sortByCreatedAt` / `sortByUpdatedAt` **with** `.with()`, OR, or `.without()`. See [Entity timestamps](#entity-timestamps).
- Multi-key `.sortBy` calls. They stay a leaf-driven `ORDER BY expr1, expr2, …, entity_id LIMIT n`. Give the leading equality fields a composite index when that list is hot.

Unsorted multi-component pages and `.count()` use a driving leaf plus `EXISTS`, not `INTERSECT`.

## Order rules

Ties break by entity id **in the sort direction** (0.9, unreleased). A `DESC` sort breaks ties with `entity_id DESC`. Multi-key sorts use the last key's direction. The same rule applies to component sorts, entity timestamps, OR plus sort, and QSP `rm_` routes.

Missing keys sort as NULL. Default is NULLS LAST (`nullsFirst` defaults to `false`). Pass `true` as the fourth argument of `.sortBy`, or the second of `.sortByCreatedAt` / `.sortByUpdatedAt`, to put missing values first.

```typescript
.sortBy(Order, "total", "DESC", true) // NULLS FIRST
```

Non-numeric text in a numeric field (`"n/a"`, `""`) sorts and filters as NULL (0.9, unreleased). It no longer raises `invalid input syntax for type numeric`.

You cannot mix `.sortBy(Component, …)` with `.sortByCreatedAt()` / `.sortByUpdatedAt()` in one query. `exec()` throws. Use one or the other.

## Pagination

### hasNextPage

`.take(n)` fetches `n + 1` rows, returns at most `n`, and sets `getLastRouteInfo().hasNextPage`. On the legacy path, a query that never calls `.take()` does not set `hasNextPage`. A [QSP](./qsp.md)-routed `exec()` does: the default cap is applied before routing, and the `rm_` fetch uses `limit + 1`, so an unbounded covered query can report `hasNextPage: true` when more than `BUNSANE_DEFAULT_QUERY_LIMIT` rows match.

### sortedCursor

Use this for any sorted page, including entity timestamps. The token width must match the number of sort keys (0.8+). A single-key token from an older client still decodes. `sortedCursor` without a sort throws. A malformed token throws `Invalid sorted cursor token`. `'before'` is valid for one key and for several keys.

`exec()` does not attach the sort value. You pass it to `encodeSortedCursor`. For a component sort, `.populate()` and read `componentData[<class name>]`. For `sortByCreatedAt` / `sortByUpdatedAt`, read `entities.created_at` or `entities.updated_at` for that id — the entity object does not carry it — and pass the `Date`. A `Date` is stored as an ISO string, which matches the millisecond key.

Single key:

```typescript
const page1 = await new Query()
  .with(Order)
  .sortBy(Order, "total", "DESC")
  .take(20)
  .populate()
  .exec();
const last = page1[page1.length - 1]!;
const token = Query.encodeSortedCursor(last.componentData.Order.total, last.id);

await new Query()
  .with(Order)
  .sortBy(Order, "total", "DESC")
  .take(20)
  .sortedCursor(token) // default direction is "after"
  .exec();
```

Several keys, mixed direction, previous page. Populate page 1 the same way, then:

```typescript
const token = Query.encodeSortedCursor(
  [last.componentData.Order.total, last.componentData.Order.status],
  last.id,
);

await new Query()
  .with(Order)
  .sortBy(Order, "total", "DESC")
  .sortBy(Order, "status", "ASC")
  .take(20)
  .sortedCursor(token, "before")
  .exec();
```

Encode keys in the same order as the `.sortBy` / `.sortByCreatedAt` / `.sortByUpdatedAt` calls. `null` is a missing sort value. `encodeSortedCursor([], id)` throws. A keyset cursor clears offset; do not also pass `.offset()`.

### cursor(id)

`.cursor(id)` pages by entity id. It throws at `exec()` when the query has `.sortBy`, `.sortByCreatedAt`, or `.sortByUpdatedAt`. Use `sortedCursor`.

```typescript
await new Query().with(UserTag).cursor(lastId, "after").take(20).exec();
```

`'before'` is the previous id page. There is no sort, so id order is the page order.

### count

`.count()` ignores `.take()`, offset, and sort. It is a cardinality scan. Call it when the UI needs a total, and cache the result if the filter is large. `.estimatedCount(component)` reads `pg_class.reltuples`. A missing row or SQL `NULL` falls back to an exact count. An unanalyzed table (`reltuples = -1`) is returned as `-1`; it does not fall back.

## Entity timestamps

```typescript
await new Query()
  .sortByCreatedAt("DESC")
  .take(20)
  .exec();
```

`sortByCreatedAt` and `sortByUpdatedAt` need no `.with()`. Every page orders by UTC milliseconds. Sub-millisecond ties fall through to entity id (0.9, unreleased). Dirty saves set `entities.updated_at` to `NOW()` (0.7+), so `sortByUpdatedAt` is last modification, not creation order.

| Shape | Plan (`entitySortPlan`) |
|-------|-------------------------|
| No `.with()`, no OR, no `.without()` | `'index'` — walks the `entities` key index and stops at the limit |
| Single timestamp key plus membership, and the page fills **or** the probe window is exhausted | `'probe'` |
| Single key, window not exhausted and page short; estimate over the cap; `OFFSET > 0`; or both `sortByCreatedAt` and `sortByUpdatedAt` with membership | `'fallback'` — hash join plus top-N |

The probe is single-key only. Its window is `min(cap, max(64, ceil(4 × pageLimit / componentShare)))`. `cap` is `BUNSANE_ENTITY_SORT_PROBE` (default 5000). Invalid values fail boot (0.9, unreleased). A short page is still `'probe'` when that window ran out of entities. Fallback after a probe runs only when the window was not exhausted and the page did not fill.

`sortByCreatedAt().with(X)` when X's rows are clustered in time stays on the 0.8 plan plus about 10% (changelog, 1M entities). Use [QSP](./qsp.md) for that list.

These sorts exclude soft-deleted entities (`deleted_at IS NULL`), including when combined with `.with()`, OR, or `.without()` (0.9, unreleased). `.cursor(id)` with either method throws.

## Unbounded exec

`BUNSANE_DEFAULT_QUERY_LIMIT` defaults to 10000. `0` disables the cap. A query with no `.take()` that fills the cap sets `getLastRouteInfo().truncatedByDefaultLimit`.

Under `NODE_ENV=development` that call **throws** after the fetch. Any other `NODE_ENV`, including unset, logs one process warning and returns the capped rows. Add `.take(n)`.

## getLastRouteInfo

```typescript
q.getLastRouteInfo();
// {
//   routed: boolean,
//   surface: "rm" | "legacy",
//   archetype?: string,
//   hasNextPage?: boolean,
//   truncatedByDefaultLimit?: boolean,
//   entitySortPlan?: "index" | "probe" | "fallback",
// }
```

`entitySortPlan` is set only for `sortByCreatedAt` / `sortByUpdatedAt` (0.9, unreleased). `routed` / `surface` / `archetype` describe a [QSP](./qsp.md) decision. On the legacy path, `hasNextPage` is set only after an explicit `.take(n)`. A routed `rm_` exec also sets it when the applied limit (including the default cap) was exceeded.

## Hydration and N+1

| Layer | Symptom | Fix |
|-------|---------|-----|
| Membership SQL | One slow statement | Key index on the sort field, one sort key, or [QSP](./qsp.md) for a stable multi-component set |
| Hydrate | Slow after ids return | `.populate()` or `.eagerLoadComponents([Profile, Email])` |
| GraphQL relations | Statements grow with page size | Request DataLoaders (attached by the app). Do not `new Query()` per parent |
| Computed fields | One query per parent | `@ArcheTypeFunction({ batch: true })` (0.8+): `(parents, ctx, args?) => Map<entityId, value>` |

If `dbQueryCount` grows with page size while the list SQL is fine, you have N+1, not a bad membership plan.

```typescript
const users = await new Query()
  .with(UserTag)
  .eagerLoadComponents([ProfileComponent, EmailComponent])
  .take(50)
  .exec();
```

Relation and field resolvers are attached at schema build. You do not call `registerFieldResolvers`.

## Tags and other entity types

Empty tag components (no `@CompData`) are valid membership markers on the legacy path:

```typescript
new Query().with(UserTag).with(AdminTag).without(BannedTag);
```

They are not projected, so a `.with(Tag)` prevents [QSP](./qsp.md) routing. QSP also refuses OR, `.without`, ILIKE, and multi-key sorts.

There is no join across entity types on `Query` or on QSP. Page the parent, then one child query with `FilterOp.IN` on the parent ids, and merge in the service. A stored join is a [read model](./read-models.md).

## Checklist

- [ ] Every filter and sort field is `@CompData({ indexed: true })`, or the sort is `sortByCreatedAt` / `sortByUpdatedAt`
- [ ] "Filter A, sort B" on one component uses `@CompositeIndex(["a", "b"])`
- [ ] Explicit `.take(n)` and `hasNextPage`, or a cached `.count()` you meant to pay for
- [ ] Sorted pages use `sortedCursor`, including `'before'`. No `.cursor(id)` next to a sort
- [ ] Token width matches the sort-key count
- [ ] `.populate()`, `.eagerLoadComponents`, or a batched `@ArcheTypeFunction` for every field the response reads
- [ ] No per-row `new Query()` in a list resolver
- [ ] Development boot shows no unindexed-sort warning for this endpoint
- [ ] Aggregates go to [Query aggregates](./query-aggregates.md) or [Read models](./read-models.md), not `exec()` plus a reduce
- [ ] If the list is a stable multi-component set and entity-timestamp plus membership falls back, consider [QSP](./qsp.md)
