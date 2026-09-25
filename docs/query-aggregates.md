---
sidebar_position: 6
sidebar_label: Query aggregates
---

# Query aggregates

`Query.exec()` returns **entities**. Totals, histograms, last-event, and "still open" counts are a second API on the same membership compiler: SQL `GROUP BY` / `SUM` / `MAX` on JSON fields. No hydrate.

Related: [List queries](./query-lists.md) · [Read models](./read-models.md) · [QSP](./qsp.md)

## When to use which

| Need | API |
|------|-----|
| Page of entities | [List queries](./query-lists.md) — `exec()`, optional [QSP](./qsp.md) |
| Scalar SUM / AVG over the match set | `.sum(C, field)` / `.average(C, field)` |
| Per-key COUNT / SUM / MAX / MIN | `groupBy` + `countBy` / `sumBy` / `maxBy` / `minBy` |
| Day / week buckets | `groupBy(C, dateField, { trunc: "day" \| "week", tzOffsetMinutes })` |
| Blank JSON fields | `FilterOp.IS_NULL` / `IS_NOT_NULL` |
| Average `end − start` in minutes (same component, Date fields) | `avgIntervalMinutesBy(C, start, end)` |
| Join **two entity types**, then aggregate | [`@ReadModel`](./read-models.md) (`m3_*`) |

Do not `.take(n)` and reduce in JavaScript. `groupBy` helpers ignore `.take()`, offset, and sort for the aggregate statement. They cannot combine with OR queries.

## `groupBy`

```typescript
import { Query, FilterOp } from "bunsane";

const counts = await new Query()
  .with(ProductComponent, {
    filters: [Query.filter("sku", FilterOp.LIKE, "gb-%")],
  })
  .groupBy(ProductComponent, "name")
  .countBy();
// [{ name: "Widget", count: 2 }, ...]

const sums = await new Query()
  .with(ProductComponent)
  .groupBy(ProductComponent, "name")
  .sumBy(ProductComponent, "price");
// [{ name: "Widget", price: 25 }, ...]
```

The group field must be on a component already in `.with()`. The metric in `sumBy` / `maxBy` / `minBy` may be a **different component on the same entity**:

```typescript
await new Query()
  .with(OrderTag)
  .without(VoidComponent)
  .with(OrderInfoComponent)
  .with(OrderTimelineComponent)
  .groupBy(OrderInfoComponent, "customerId")
  .maxBy(OrderTimelineComponent, "createdAt");
// [{ customerId: "...", createdAt: Date }, ...]
```

Each helper throws if you skip `.groupBy()`.

### Time buckets

```typescript
.groupBy(EventComponent, "at", { trunc: "day", tzOffsetMinutes: -420 })
.countBy();
```

`trunc` is `"day"` or `"week"`. `tzOffsetMinutes` follows JavaScript `Date.getTimezoneOffset()`: the SQL subtracts that many minutes, then reads the UTC calendar date. UTC+7 is `-420`. `420` is UTC−7. Day buckets use `to_char` of that shifted instant. Week buckets use `date_trunc('week', …)` and then `to_char`. The result key is `bucket` when `trunc` is set, otherwise the field name.

### `maxBy` / `minBy`

Default cast is **timestamptz** (ISO Date JSON). For numbers pass `{ cast: "numeric" }`; for raw JSON text `{ cast: "text" }`.

```typescript
.maxBy(TimelineComponent, "createdAt")
.maxBy(ProductComponent, "price", { cast: "numeric" })
.minBy(ProductComponent, "price", { cast: "numeric" })
```

Numeric casts go through `bunsane_num_v1`. Non-numeric text is NULL and is skipped, not a cast error (0.9, unreleased).

### `avgIntervalMinutesBy`

`AVG(end − start)` in minutes. Both fields on **one** component. Blank timestamps are skipped (`AVG` ignores NULL). `AVG(end) − AVG(start)` is not the same thing.

```typescript
.groupBy(AssignmentComponent, "technicianId")
.avgIntervalMinutesBy(AssignmentComponent, "assignedAt", "completedAt");
// [{ technicianId: "...", avgIntervalMinutes: 45 }, ...]
```

### Scalar sum and average

No `groupBy`. The component must already be in `.with()`. Empty match set returns `0`.

```typescript
const total = await new Query().with(Invoice).sum(Invoice, "amount");
const mean = await new Query().with(Invoice).average(Invoice, "amount");
```

## `IS_NULL` / `IS_NOT_NULL`

Treat a missing key, JSON `null`, and `''` as blank. The filter value is unused; pass `null`.

```typescript
Query.filter("completedAt", FilterOp.IS_NULL, null)
Query.filter("completedAt", FilterOp.IS_NOT_NULL, null)
```

Empty `IN []` is SQL `FALSE`. Empty `NOT IN []` is `TRUE`. A non-array throws. Boolean filters compare JSON text (`data->>'f' = 'true'`). `"yes"`, `"1"`, and `"t"` do not match (0.7+).

## Indexes

Range filters and group membership still scan unless the field has a key index:

```typescript
@CompData({ indexed: true }) createdAt: Date = new Date();
@CompData({ indexed: true }) price: number = 0;
```

A scalar `@CompData({ indexed: true })` creates a `bk_` key index, not a GIN index and not a partial `idx_*_numeric` index (0.9, unreleased). `number` fields use `bunsane_num_v1(data->>'field')`. `Date` fields use the text expression `(data->>'field')` (the ISO string), not a timestamptz btree. Adding `indexed: true` does not rewrite stored JSON; the reconciler builds the index. See [Database](./database.md#key-indexes).

## Cross-entity without `@ReadModel`

`Query` does not join entity A to entity B. Pattern:

1. Collect parent ids (membership + filters).
2. Child query: `filter("parentId", FilterOp.IN, ids)` then `groupBy` / `sumBy`.

For a persistent join table, use [Read models](./read-models.md). Paged reads of that table must be ordered (0.8+).
