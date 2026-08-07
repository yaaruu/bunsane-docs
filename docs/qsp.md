---
sidebar_position: 6
sidebar_label: QSP (read models)
---

# QSP — Query Surface Planner

**Experimental** accelerator for hot multi-component list queries (BunSane 0.6.x).

Default is **off**. With `BUNSANE_QSP=off`, behavior matches pre-QSP (no projection tables, no dual-write).

Related: [List queries](./query-lists.md) · [Configuration](./configuration.md#query-surface-planner-experimental)

## What it does

For an eligible **archetype**, BunSane maintains a columnar table `rm_<archetype>` (one row per entity, projected `@CompData` fields as real columns) with a covering index. Dual-write on `entity.save()` keeps it in sync.

When a list query is **fully covered** and the projection is **READY**, the planner serves entity ids from a single index scan on `rm_*` instead of multi-partition INTERSECT + EXISTS.

Uncovered queries, errors, and `BUNSANE_QSP=off` always use the **legacy** Query compiler. Routed failures fall back transparently — wrong results are not acceptable; speed is optional.

## Environment flags

| Variable | Default | Effect |
|----------|---------|--------|
| `BUNSANE_QSP` | `off` | `off` \| `shadow` (parity only, never serve) \| `route` (auto-promote and serve) |
| `BUNSANE_QSP_ARCHETYPES` | empty | CSV of archetype names. **Empty = all eligible** (wide blast radius — scope on first rollout) |
| `BUNSANE_QSP_COUNT` | `exact` | `exact` \| `n_plus_1` \| `estimate` — prefer `n_plus_1` for list UIs |
| `BUNSANE_QSP_PROMOTE_MIN` | `50` | Clean shadow comparisons before READY (`route` mode) |
| `BUNSANE_QSP_BACKFILL_BATCH` | `5000` | Backfill batch size |
| `BUNSANE_QSP_BACKFILL_THROTTLE_MS` | `50` | Sleep between batches |
| `BUNSANE_QSP_HYDRATE` | `off` | When `on`, rebuild fully-columnar components from the `rm_` row |
| `BUNSANE_QSP_HYDRATE_SHADOW` | `off` | Observe hydrate parity without serving |

Flip `BUNSANE_QSP` without redeploy (read at query time).

## Coverage rules

A query routes only when **all** hold:

1. `BUNSANE_QSP=route`, projection **READY**, archetype in scope  
2. Query `.with` component **set exactly equals** the archetype’s **projected** component set  
3. Filters only: `=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT IN`  
4. At most one sort key (field must be projected)  
5. Cursor: unsorted id-cursor, or keyset `after` with single sort (not `before`)  
6. No OR, no `.without` / exclusions, no `findById`-only shapes that mark the request uncovered  

### Does **not** route (legacy — still correct)

| Shape | Why |
|-------|-----|
| Empty **tag** in `.with(OrderTag)` | Tags have no `@CompData` → no projected columns → set mismatch |
| Optional rare components on the archetype | Under-count if not every entity has them — use a list-only archetype |
| Multi-archetype / cross-entity joins | No `rm_A ⋈ rm_B` |
| `.without`, OR, ILIKE, spatial | Unsupported for coverage |
| Multi-key sort | Not covered |

## List-only archetype

GraphQL can still return a rich type. QSP needs a **stable list surface**:

```typescript
// QSP list shape — every real order always has these five; no empty tags
@ArcheType("OrderList")
export class OrderListArchetypeClass extends BaseArcheType {
  @ArcheTypeField(OrderInfoComponent) info!: OrderInfoComponent;
  @ArcheTypeField(OrderStatusComponent) status!: OrderStatusComponent;
  @ArcheTypeField(OrderPricingComponent) pricing!: OrderPricingComponent;
  @ArcheTypeField(OrderPaymentComponent) payment!: OrderPaymentComponent;
  @ArcheTypeField(OrderTimelineComponent) timeline!: OrderTimelineComponent;
}

// Query must match that set exactly
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

After exec under `route` + READY:

```typescript
q.getLastRouteInfo();
// { routed: true, surface: 'rm', archetype: 'OrderList', hasNextPage?: boolean }
```

## Lifecycle

`NONE → BACKFILLING → SHADOW → READY`

1. First covered list query (when QSP ≠ off) lazy-creates the projection and starts dual-write + backfill.  
2. **SHADOW**: still serves legacy; compares id-set/order/count to `rm_`.  
3. **READY** (`route` only): after enough clean comparisons (`BUNSANE_QSP_PROMOTE_MIN`), serves from `rm_`.  
4. **Rollback:** set `BUNSANE_QSP=off` — instant legacy; `rm_` tables remain disposable.

## Hydration

By default, QSP accelerates **id selection** (and count strategy). Entities still hydrate from `components` unless:

```bash
BUNSANE_QSP_HYDRATE=on
```

Only fully columnar components (entire `@CompData` surface projectable) come from the row. Empty tags never do.

## Reconcile sweep

```typescript
import { startReconcileSweep } from "bunsane/database/projection";

// App does NOT start this automatically
if (process.env.BUNSANE_QSP === "shadow" || process.env.BUNSANE_QSP === "route") {
  startReconcileSweep(300_000); // every 5 minutes
}
```

Repairs drift (`qsp_drift_total`). Run it in multi-instance production.

## First production checklist

1. Pick one hot list with a stable multi-component set.  
2. Declare a list-only archetype (no empty tags, no rare optionals).  
3. Align the Query builder to that exact set.  
4. Index filter/sort fields.  
5. Scope: `BUNSANE_QSP_ARCHETYPES=OrderList` (example).  
6. Staging: `BUNSANE_QSP=shadow`, `BUNSANE_QSP_COUNT=n_plus_1`, start reconcile.  
7. Soak with zero shadow divergences.  
8. Flip `BUNSANE_QSP=route`; confirm `getLastRouteInfo().routed === true`.  
9. Optional: hydrate shadow, then `BUNSANE_QSP_HYDRATE=on`.  
10. Rollback anytime: `BUNSANE_QSP=off`.

## Metrics (names)

| Metric | Meaning |
|--------|---------|
| `qsp_shadow_divergence_total` | Must be 0 before trusting route |
| `qsp_shadow_compared_total` | Shadow is exercising covered queries |
| `qsp_route_total` | Served from `rm_` |
| `qsp_fallback_total` | Route attempted, fell to legacy |
| `qsp_drift_total` | Reconcile repairs |

## One-line invariant

Off ⇒ legacy. Shadow clean ⇒ `rm_` matches legacy. Route ⇒ same results, one index scan for **covered** shapes. Tags / multi-archetype / without / OR stay on legacy.
