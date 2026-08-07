---
sidebar_position: 3
sidebar_label: Query Optimization
---

# Query Optimization

Efficient list and lookup patterns for BunSane **0.6.x**. Use this as the default guide for AI agents and app authors.

Also see: [List queries](../query-lists.md) · [QSP](../qsp.md) · [Configuration](../configuration.md)

## Query basics

```typescript
import { Query } from "bunsane/query";

const users = await new Query()
  .with(UserTag)
  .with(EmailComponent)
  .take(20)
  .exec();
```

## Building patterns

### Multiple component requirements

```typescript
// Entities that have ALL of these components
const verifiedUsers = await new Query()
  .with(UserTag)
  .with(EmailComponent)
  .with(VerifiedTag)
  .exec();
```

### Filtering by field values

```typescript
const users = await new Query()
  .with(
    EmailComponent,
    Query.filters(Query.filter("value", Query.filterOp.EQ, "john@example.com"))
  )
  .take(1)
  .exec();
```

### Multiple filters on the same component

Same-component filters are **coalesced into one predicate group** (0.6.x) and pushed into membership INTERSECT branches where possible.

```typescript
const products = await new Query()
  .with(
    ProductInventoryComponent,
    Query.filters(
      Query.filter("quantity", Query.filterOp.GT, 0),
      Query.filter("sku", Query.filterOp.LIKE, "PROD-%")
    )
  )
  .take(50)
  .exec();
```

### Exclusion

```typescript
const activeUsers = await new Query()
  .with(UserTag)
  .without(SoftDeletedTag)
  .take(50)
  .exec();
```

:::note
`.without()` always uses the **legacy** path. It is never covered by [QSP](../qsp.md).
:::

## Filter operators

| Operator | Description |
|----------|-------------|
| `EQ` | Equals |
| `NEQ` | Not equals |
| `GT` / `GTE` / `LT` / `LTE` | Comparisons (numeric fields should be indexed) |
| `LIKE` | Pattern (`John%` can use btree prefix; `%John%` usually cannot) |
| `IN` / `NOT_IN` | Membership in array |

## Pagination and sorting (do this)

### Preferred list page — `take` + `hasNextPage`

Explicit `.take(N)` fetches `LIMIT N+1`, trims to N, and sets `hasNextPage` so you **do not need** a second exact `.count()` for “load more” UIs.

```typescript
const q = new Query()
  .with(OrderStatusComponent, statusFilters)
  .with(OrderInfoComponent)
  .with(OrderTimelineComponent)
  .sortBy(OrderTimelineComponent, "createdAt", "DESC")
  .take(20);

const items = await q.exec();
const { hasNextPage, routed, surface, archetype } = q.getLastRouteInfo();
// hasNextPage: true if another page exists
// routed/surface: QSP diagnostics when BUNSANE_QSP=route
```

Framework default LIMIT (when you never call `.take`) does **not** enable `hasNextPage`.

### Sorted deep pages — `sortedCursor` (not plain `cursor`)

```typescript
// Page 1
const page1 = await new Query()
  .with(ProfileComponent)
  .sortBy(ProfileComponent, "createdAt", "DESC")
  .take(20)
  .exec();

const last = page1[page1.length - 1]!;
const profile = await last.get(ProfileComponent);
const token = Query.encodeSortedCursor(profile!.createdAt, last.id);

// Page 2 — keeps sort-driven / QSP keyset path
const page2 = await new Query()
  .with(ProfileComponent)
  .sortBy(ProfileComponent, "createdAt", "DESC")
  .take(20)
  .sortedCursor(token)
  .exec();
```

:::danger Wrong API
`.sortBy(...).cursor(entityId)` **throws** at exec (0.6.x). Plain `cursor(id)` pages by **entity id order**, not sort order. Use `sortedCursor` for sorted lists, or drop `sortBy` to page by id only.
:::

### When you need exact totals

```typescript
// Expensive on large filtered multi-component sets — full second scan
const totalCount = await new Query().with(UserTag).count();
```

Prefer `hasNextPage` for infinite scroll. On QSP, set `BUNSANE_QSP_COUNT=n_plus_1` or `estimate` for list UIs.

### Avoid deep OFFSET

```typescript
// Works but degrades as offset grows
.take(20).offset(page * 20)
```

Prefer `sortedCursor` for large sorted tables.

## Optimization strategies

### 1. Index filter and sort fields

```typescript
@Component
export class EmailComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}
```

Numeric indexed fields use a partial expression index; the engine restates the numeric predicate so the planner can use it (0.6.x).

### 2. Tags vs QSP

Empty **tags** (no `@CompData`) are great for legacy membership (`.with(AdminTag)`), but:

- Including a tag in `.with()` **breaks QSP coverage** (tags emit no projected columns).
- For hot QSP lists, use a **list-only archetype** with only data components every row has — see [QSP](../qsp.md).

### 3. Always bound result sets

```typescript
// BAD
await new Query().with(OrderTag).exec();

// GOOD
await new Query().with(OrderInfoComponent).take(100).exec();
```

### 4. Prevent N+1 — hydrate in bulk

```typescript
const users = await new Query()
  .with(UserTag)
  .eagerLoadComponents([ProfileComponent, EmailComponent])
  // or .populate()
  .take(100)
  .exec();

for (const user of users) {
  const profile = await user.get(ProfileComponent); // cache hit if eager-loaded
}
```

If per-request `dbQueryCount` scales with page size, fix batching (eager load / DataLoaders), not INTERSECT SQL.

### 5. Batch related entities

```typescript
const orderIds = orders.map((o) => o.id);
const items = await new Query()
  .with(
    LineItemComponent,
    Query.filters(Query.filter("orderId", Query.filterOp.IN, orderIds))
  )
  .take(500)
  .exec();
```

Do **not** run `new Query()...filter(fk, parent.id)` inside a per-row loop.

### 6. Sort-driven multi-component lists

Fast path: **≥2** `.with` components, **exactly one** `sortBy` on a required component, no OR, no plain `cursor(id)`. Use `sortedCursor` for keyset.

## Common patterns

### Find by unique field

```typescript
async function findUserByEmail(email: string): Promise<Entity | null> {
  const results = await new Query()
    .with(UserTag)
    .with(
      EmailComponent,
      Query.filters(Query.filter("value", Query.filterOp.EQ, email))
    )
    .take(1)
    .exec();
  return results[0] ?? null;
}
```

### Load-more list (no exact count)

```typescript
async function listOrders(pageSize = 20, cursorToken?: string) {
  let q = new Query()
    .with(OrderStatusComponent)
    .with(OrderInfoComponent)
    .with(OrderTimelineComponent)
    .sortBy(OrderTimelineComponent, "createdAt", "DESC")
    .take(pageSize);

  if (cursorToken) q = q.sortedCursor(cursorToken);

  const items = await q.exec();
  const { hasNextPage } = q.getLastRouteInfo();

  let nextCursor: string | undefined;
  if (hasNextPage && items.length > 0) {
    const last = items[items.length - 1]!;
    const tl = await last.get(OrderTimelineComponent);
    nextCursor = Query.encodeSortedCursor(tl!.createdAt, last.id);
  }

  return { items, hasNextPage, nextCursor };
}
```

### Search with optional criteria

```typescript
async function searchUsers(criteria: { email?: string; verified?: boolean }) {
  let query = new Query().with(UserTag);

  if (criteria.email) {
    query = query.with(
      EmailComponent,
      Query.filters(
        Query.filter("value", Query.filterOp.LIKE, `%${criteria.email}%`)
      )
    );
  }
  if (criteria.verified === true) query = query.with(EmailVerifiedTag);
  else if (criteria.verified === false) query = query.without(EmailVerifiedTag);

  return query.take(100).exec();
}
```

ILIKE/`%…%` and `.without` stay on the **legacy** path (not QSP).

## Aggregates and estimates

```typescript
const totalRevenue = await new Query()
  .with(OrderAmountComponent)
  .sum(OrderAmountComponent, "amount");

// Fast approximate — not valid as a precise filtered multi-component total
const approx = await new Query().with(UserTag).estimatedCount(UserTag);
```

## Debugging

```typescript
const plan = await new Query()
  .with(OrderInfoComponent)
  .with(OrderStatusComponent)
  .sortBy(OrderInfoComponent, "orderNumber", "ASC")
  .take(20)
  .explainAnalyze(true);
console.log(plan);

const q = new Query().with(UserTag).take(10);
await q.exec();
console.log(q.getLastRouteInfo()); // { routed, surface, hasNextPage, archetype? }
```

## Summary

| Do | Don't |
|----|-------|
| Explicit `.take(N)` + `hasNextPage` | Exact `.count()` on every infinite-scroll page |
| `sortedCursor` for sorted deep pages | `.sortBy` + `.cursor(id)` (throws) |
| Index filter/sort fields | Filter unindexed JSON paths |
| `eagerLoadComponents` / batch FK `IN` | `entity.get` / nested Query per list row |
| List-only archetype for QSP hot paths | Expect tags / `.without` / multi-archetype joins on QSP |
| Prefer one sort key for list screens | Multi-key sort unless required (slower path) |
