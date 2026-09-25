---
sidebar_position: 7
sidebar_label: QSP
---

# QSP — Query Surface Planner

Optional accelerator for a hot multi-component **list**. Default is off. With `BUNSANE_QSP` unset or `off`, BunSane does not create `projection_state` or `rm_*` tables and does not dual-write.

Tables are `rm_<lowercase name>` — one row per **entity**. `OrderList` is `rm_orderlist`. They are not a join store and not an aggregate store.

| Need | Use |
|------|-----|
| Filter, sort, and page one component, or an entity timestamp with no membership | A [key index](./database.md#key-indexes). This is the default. A single indexed sort stops at `.take(n)` |
| The same list, but several components, and the legacy plan is still the hot statement | QSP, after the key indexes exist. Best when `.with()` matches a list-only archetype exactly |
| `sortByCreatedAt().with(X)` and X is clustered in time | QSP. That shape stays on the fallback plan (0.9, unreleased) |
| Join two entity types, then `SUM` / `GROUP BY` | [Read models](./read-models.md) (`m3_*`) |
| Same-entity `GROUP BY` | [Query aggregates](./query-aggregates.md) |

Related: [List queries](./query-lists.md) · [Configuration](./configuration.md#query-surface-planner)

## What it does

For an eligible archetype, BunSane maintains `rm_<lowercase name>`: projected `@CompData` fields as real columns, plus `created_at` and `updated_at`. Dual-write on `entity.save()` keeps the row in sync once status is `BACKFILLING`, `SHADOW`, or `READY`. `DISABLED` is skipped.

(0.9, unreleased) Each sortable column has its own `bk_` key index. The legacy covering index `idx_rm_<lowercase>__cover` (`idx_rm_orderlist__cover`) is dropped only after those key indexes are valid. Routed queries use the same ordering and keyset builder as the legacy engine, so NULL placement and `'before'` pages match.

When the query is fully covered and the projection is **READY**, the planner serves entity ids from `rm_*` instead of the legacy membership scan. Uncovered queries, errors, and `BUNSANE_QSP=off` use the legacy compiler. A routed failure falls back. Wrong results are not acceptable; speed is optional.

After `exec()`:

```typescript
q.getLastRouteInfo();
// { routed: true, surface: "rm", archetype: "OrderList", hasNextPage?: boolean }
```

## Modes

`qspMode()` is read per call. `shadow` ↔ `route`, and either → `off`, flip without a redeploy. Turning QSP **on** (`off` → `shadow` or `route`) does not: `InitializeProjections` and the reconcile sweep run only if QSP was active at `App.init()`. Restart the process.

| `BUNSANE_QSP` | Effect |
|---------------|--------|
| unset / `off` | No `rm_` serve, no projection tables, no dual-write |
| `shadow` | Project and compare to legacy. Never serve `rm_` |
| `route` | Serve when the projection is READY and the query is covered |

`App.init()` starts the reconcile sweep for `shadow` and `route` (0.7+). `off` does not. A process that booted with `off` does not grow the sweep if you flip the variable later.

## Environment flags

| Variable | Default | Effect |
|----------|---------|--------|
| `BUNSANE_QSP` | `off` | `off` \| `shadow` \| `route` |
| `BUNSANE_QSP_ARCHETYPES` | empty | CSV of archetype names. **Empty = all eligible** (wide dual-write — scope the first rollout) |
| `BUNSANE_QSP_COUNT` | `exact` | `exact` \| `n_plus_1` \| `estimate`. Prefer `n_plus_1` for list UIs |
| `BUNSANE_QSP_PROMOTE_MIN` | `50` | Clean shadow comparisons before READY (`route` only) |
| `BUNSANE_QSP_BACKFILL_BATCH` | `5000` | Backfill batch size |
| `BUNSANE_QSP_BACKFILL_THROTTLE_MS` | `50` | Sleep between batches |
| `BUNSANE_QSP_HYDRATE` | `off` | When `on`, rebuild fully-columnar components from the `rm_` row |
| `BUNSANE_QSP_HYDRATE_SHADOW` | `off` | Observe hydrate parity without serving. Does not feed READY promotion |
| `BUNSANE_QSP_ENTITIES_ACCEL` | `false` | Reserved. Validated at boot and not read. It does not change routing. |

## Coverage

A query routes only when all of these hold:

1. `BUNSANE_QSP=route`, projection **READY**, archetype in scope.
2. The `.with` component **set exactly equals** the archetype's projected component set.
3. Filters are only `=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT IN`. Empty `IN` / `NOT IN` does not route.
4. At most one sort key, and that field is projected (not a component-id column, not `FILLING`).
5. Cursor is an unsorted id cursor, or a keyset cursor with that single sort. (0.9, unreleased) `'before'` and `nullsFirst` route. They did not on 0.8.
6. No OR, no `.without`, no excluded entity ids, no `withId`.

### Does not route

Results stay correct on the legacy path.

| Shape | Why |
|-------|-----|
| Empty tag in `.with(OrderTag)` | No `@CompData` means no projected columns, so the sets differ |
| Optional components on the list archetype | Entities missing them drop out of `rm_` membership. Use a list-only archetype |
| Multi-archetype / cross-entity | No `rm_A` join `rm_B`. Use a [read model](./read-models.md) or a second query |
| `.without`, OR, ILIKE, spatial | Not covered. There is no `@Spatial` decorator |
| Multi-key sort | `sorts.length > 1` stays legacy. Use `sortedCursor` on the legacy plan |
| Id cursor combined with a sort | Refused. Use `sortedCursor` |

## List-only archetype

GraphQL can still return a rich type. QSP needs a stable list surface: every row has these components, and none of them are empty tags.

```typescript
import { ArcheType, ArcheTypeField, BaseArcheType, Query } from "bunsane";

@ArcheType("OrderList")
export class OrderListArchetypeClass extends BaseArcheType {
  @ArcheTypeField(OrderInfoComponent) info!: OrderInfoComponent;
  @ArcheTypeField(OrderStatusComponent) status!: OrderStatusComponent;
  @ArcheTypeField(OrderPricingComponent) pricing!: OrderPricingComponent;
  @ArcheTypeField(OrderPaymentComponent) payment!: OrderPaymentComponent;
  @ArcheTypeField(OrderTimelineComponent) timeline!: OrderTimelineComponent;
}

export function orderListQuery() {
  return new Query()
    .with(OrderStatusComponent)
    .with(OrderInfoComponent)
    .with(OrderPricingComponent)
    .with(OrderPaymentComponent)
    .with(OrderTimelineComponent)
    .sortBy(OrderTimelineComponent, "createdAt", "DESC");
}
```

The query set must match that archetype exactly. Index the sort field as well; QSP does not replace a missing key index on the legacy fallback.

## Lifecycle

Status is `DISABLED`, `BACKFILLING`, `SHADOW`, or `READY`. There is no `NONE`.

**Unscoped** (`BUNSANE_QSP_ARCHETYPES` empty): the first covered list query calls `ensureProjection`, inserts `projection_state` as `BACKFILLING`, and starts backfill.

**Scoped** (`BUNSANE_QSP_ARCHETYPES=OrderList`): `App.init` creates the `rm_` table and key indexes for each listed archetype. An archetype with **no existing** row gets one inserted `BACKFILLING`, and its backfill starts in the background right away — same as the unscoped path, just at boot instead of on the first query. An existing row keeps its status: `DISABLED` only happens if something sets it explicitly (an operator's rollback), and it survives restarts. A row still `BACKFILLING` because an instance died mid-scan resumes from its watermark on the next boot.

```typescript
import { runBackfill } from "bunsane/database/projection";

await runBackfill("OrderList");
```

You do not need to call `runBackfill` yourself for a new scoped archetype — boot does it. Call it to kick a row that predates this behavior and is stuck `DISABLED`, or to re-run a backfill on demand. `runBackfill` sets `BACKFILLING`, fills `rm_orderlist`, then sets `SHADOW`. It returns without writing if the descriptor was not registered, or if another instance holds the postgres lease `qsp-backfill-OrderList`. That lease is `getDistributedLock()` (the postgres lease table), not `pg_advisory_lock`.

`ProjectionManager.instance.awaitBackfills()` resolves once every backfill this process started has settled — handy in tests and scripts.

1. **SHADOW** still serves legacy and compares id-set, order, and count.
2. **READY** (`route` only): after `BUNSANE_QSP_PROMOTE_MIN` clean comparisons, serves from `rm_`.
3. Rollback: `BUNSANE_QSP=off`. That flip is live. `rm_` tables can be dropped later; they are not the source of truth.

## Hydration

By default QSP accelerates id selection (and the count strategy). Entities still hydrate from `components` unless:

```bash
BUNSANE_QSP_HYDRATE=on
```

Only fully columnar components (every `@CompData` field projected) come from the row. Empty tags never do.

## Reconcile sweep

When `BUNSANE_QSP` is `shadow` or `route`, `App.init()` starts `startReconcileSweep()` (default every 300 seconds) and shutdown stops it (0.7+). The log line is `QSP reconcile sweep started`. Do not start a second sweep from application code.

`off` does not start it. A script that is not an `App` and still needs drift repair may call `startReconcileSweep` from `bunsane/database/projection` and must stop the returned function before exit.

The sweep samples `rm_` rows, recomputes them from `components`, and repairs drift. It runs only on `READY` and `SHADOW`, under the same postgres lease (`qsp-reconcile-<name>`), not an advisory lock.

## First production checklist

1. Confirm the sort and filter fields already have key indexes. QSP is the second step, not the first.
2. Pick one hot list with a stable multi-component set.
3. Declare a list-only archetype (no empty tags, no rare optionals).
4. Align the `Query` builder to that exact set. One sort key.
5. Scope: `BUNSANE_QSP_ARCHETYPES=OrderList`. Restart so `init()` creates `rm_orderlist`, inserts a `BACKFILLING` row, and starts the backfill.
6. Staging: `BUNSANE_QSP=shadow`, `BUNSANE_QSP_COUNT=n_plus_1`. Confirm the sweep started and the backfill reaches `SHADOW` (poll `projection_state`, or `await ProjectionManager.instance.awaitBackfills()`). Do not call `startReconcileSweep` yourself inside `App`.
7. Soak until `qspPlannerMetrics.shadowDivergenceTotal` stays `0` and `shadowComparedTotal` is moving. These counters are in-process, not Prometheus.
8. Flip `BUNSANE_QSP=route` without a restart. Confirm `getLastRouteInfo().routed === true` and `surface === "rm"`.
9. Optional: hydrate shadow, then `BUNSANE_QSP_HYDRATE=on`.
10. Rollback any time: `BUNSANE_QSP=off`.

## Metrics

There is no `qsp_*` Prometheus series. `/metrics` does not include them. Access logs do not carry `surface`.

```typescript
import { qspPlannerMetrics } from "bunsane/query/planner";

qspPlannerMetrics.shadowComparedTotal;   // number
qspPlannerMetrics.shadowDivergenceTotal; // number; must stay 0 before route
qspPlannerMetrics.driftTotal;            // number
qspPlannerMetrics.routeTotal;            // Record<archetype, number>
qspPlannerMetrics.fallbackTotal;         // Record<reason, number>
qspPlannerMetrics.lastDivergences;       // last 100 { archetype, kind, detail, at }
```

Per request, `getLastRouteInfo()` is `{ routed, surface: "rm" | "legacy", archetype? }`. `surface` is never `"entities"`.

Operator detail: [QSP_OPERATIONS.md](https://github.com/yauruu/bunsane/blob/main/docs/QSP_OPERATIONS.md).

Off means legacy. Shadow clean means `rm_` matches legacy. Route means the same results, from `rm_` key indexes, for covered shapes only. Tags, multi-archetype, `.without`, OR, and multi-key sorts stay on legacy.
