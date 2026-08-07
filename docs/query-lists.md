---
sidebar_position: 5
sidebar_label: List queries
---

# List queries

How to build **filter + sort + page + hydrate** endpoints on BunSane 0.6.x without accidental N+1 or slow counts.

For AI-oriented patterns see [Query optimization](./ai-guide/query-optimization.md). For projection tables see [QSP](./qsp.md).

## Default shape

```typescript
import { Query } from "bunsane/query";

const q = new Query()
  .with(StatusComp, Query.filters(Query.filter("status", Query.filterOp.EQ, status)))
  .with(InfoComp, infoFilters)
  .with(TimelineComp)
  .sortBy(TimelineComp, "createdAt", "DESC")
  .take(pageSize); // enables hasNextPage (LIMIT n+1)

const items = await q.exec();
const { hasNextPage, routed, surface, archetype } = q.getLastRouteInfo();
```

| Prefer | Avoid |
|--------|--------|
| Explicit `.take(N)` + `hasNextPage` | `.count()` on every “load more” request |
| One sort key + `sortedCursor` for deep pages | Deep `.offset(10000)` |
| `@CompData({ indexed: true })` on filter/sort fields | Filtering unindexed fields |
| `.eagerLoadComponents([...])` or `.populate()` | `await entity.get(C)` in a loop without eager load |
| Batch children with `IN (ids)` | Nested `new Query()` per parent row |

## Pagination modes

### hasNextPage (recommended for load-more)

When you call **`.take(N)`**, BunSane fetches `N+1` rows, returns at most N, and sets:

```typescript
q.getLastRouteInfo().hasNextPage // boolean | undefined
```

If you never call `.take`, the framework default LIMIT does **not** compute `hasNextPage`.

### sortedCursor (recommended for sorted deep pages)

```typescript
const token = Query.encodeSortedCursor(lastSortValue, lastEntityId);
await new Query()
  /* same .with / .sortBy */
  .take(20)
  .sortedCursor(token)
  .exec();
```

### Plain cursor (unsorted / id order only)

```typescript
await new Query().with(UserTag).cursor(lastId, "after").take(20).exec();
```

**Do not** combine `.cursor(entityId)` with `.sortBy(...)` — it **throws**. Use `sortedCursor` instead.

### Exact count

```typescript
const total = await new Query().with(UserTag).count(); // full cardinality scan
```

Use only when the UI needs total pages. Cache or accept cost on large filtered sets.

## Hydration and N+1

| Layer | Symptom | Fix |
|-------|---------|-----|
| Membership SQL | One slow statement | Indexes, one sort key, [QSP](./qsp.md) for stable shapes |
| Hydrate | Slow after ids return | `eagerLoadComponents` / `populate` |
| GraphQL relations | Queries × page size | Request DataLoaders (`createRequestLoaders` in App) |
| Computed fields | Query per parent in resolvers | Batch by parent ids once |

**Diagnose:** access-log / metrics `dbQueryCount`. If it grows with page size while `EXPLAIN` looks fine, you have N+1, not a bad INTERSECT plan.

```typescript
const users = await new Query()
  .with(UserTag)
  .eagerLoadComponents([ProfileComponent, EmailComponent])
  .take(50)
  .exec();
```

## Tags and multi-component sets

Empty **tag** components (no `@CompData`) work as membership markers on the **legacy** path:

```typescript
new Query().with(UserTag).with(AdminTag).without(BannedTag)
```

For **QSP**, empty tags are **not projected**. Including them in `.with()` prevents routing. Use a [list-only archetype](./qsp.md#list-only-archetype) of data components every row always has.

There is no QSP join across unrelated entity types. Pattern:

1. Page the primary entities.
2. Second query: children filtered by `parentId IN (...)`.
3. Merge in the service.

## Checklist before shipping a list endpoint

- [ ] Filter/sort fields are `@CompData({ indexed: true })` (or entity `sortByCreatedAt` / `sortByUpdatedAt`)
- [ ] Explicit `.take` + `hasNextPage` (or intentional cached exact count)
- [ ] No `cursor(id)` + `sortBy` (use `sortedCursor`)
- [ ] Eager load / populate / loaders for every field the response reads
- [ ] No per-row nested Query in GraphQL list resolvers
- [ ] If using QSP: exact list component set, no empty tags on that path — see [QSP](./qsp.md)
