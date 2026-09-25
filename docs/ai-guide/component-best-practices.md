---
sidebar_position: 2
sidebar_label: Component Best Practices
---

# Component Best Practices

How to shape components so queries stay index-driven. Import decorators from the root barrel:

```typescript
import { BaseComponent, Component, CompData, CompositeIndex } from "bunsane";
```

`IndexedField` is not on the barrel: `import { IndexedField } from "bunsane/core/decorators/IndexedField"`.

## Keep components flat

A component is one JSONB document on that component's partition, not a table column and not a nested object. Each `@CompData()` field is a key inside `data`. Flat keys can take a key index. Nested objects cannot.

```typescript
// BAD — nested object. No key index, no typed filter.
@Component
export class UserProfileComponent extends BaseComponent {
  @CompData()
  address!: {
    street: string;
    city: string;
    zipCode: string;
  };
}

// GOOD — one component, one concept, flat keys.
@Component
export class AddressComponent extends BaseComponent {
  @CompData()
  street: string = "";

  @CompData()
  city: string = "";

  @CompData({ indexed: true })
  zipCode: string = "";
}
```

Group fields you always read or write together. Split fields that change on a different cadence, or that a list screen never needs.

```typescript
@Component
export class UserDisplayComponent extends BaseComponent {
  @CompData()
  displayName: string = "";

  @CompData()
  avatarUrl: string = "";
}

@Component
export class UserActivityComponent extends BaseComponent {
  @CompData({ indexed: true })
  lastLoginAt: Date = new Date();

  @CompData()
  loginCount: number = 0;
}
```

Give every field a default. `emitDecoratorMetadata` must be on so a `number` field is detected and its key uses `bunsane_num_v1()`. A `Date` is always a text key. There is no date key.

### Tags

An empty component is a membership flag.

```typescript
@Component
export class AdminTag extends BaseComponent {}

@Component
export class SoftDeletedTag extends BaseComponent {}
```

Tags are fine for rare filters. They emit no projected columns, so a `.with(AdminTag)` list is never covered by [QSP](../qsp.md). For a hot list, store the flag as an indexed field on a data component every row has.

## What to index

Index every scalar you filter or sort. A sort on a field with no key index is a full scan plus a top-N sort. In development the engine warns once per component field for that sort (`sortBy(...) has no key index`). An unindexed filter does not warn. Neither throws.

Do not index fields you only display.

### `@CompData({ indexed: true })` — the key index (0.9, unreleased)

On a scalar (`arrayOf` unset) this creates one non-partial index:

```text
bk_<slug>_<hash> ON <leaf> ((<key>), entity_id)
```

It is not a GIN index, and it is not partial (`WHERE deleted_at IS NULL` is not in the definition). One index serves equality, ranges, both sort directions, both NULLS placements, and keyset pages.

| Field type | Key expression |
|------------|----------------|
| `string`, enum, `boolean`, `Date`, object | `(data->>'field')` |
| `number` | `(bunsane_num_v1(data->>'field'))` |
| `arrayOf` | Not a key index. GIN on `(data->'field')`. |

`indexed: true` on an object (no `arrayOf`) is still a text key index. GIN on an object needs `@IndexedField("gin")`. `isDateField` does not change the expression. A `Date` is indexed as text, same as a string. Entity `created_at` / `updated_at` have their own key indexes; you do not add `@CompData` for those.

Non-numeric text in a numeric field (`"n/a"`) is NULL. Sorting or filtering it does not raise `invalid input syntax for type numeric` (0.9, unreleased).

Boolean filters compare JSON text: `data->>'f' = 'true'`. The strings `"yes"`, `"1"`, and `"t"` do not match (0.7+).

```typescript
@Component
export class EmailComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";

  @CompData()
  verified: boolean = false; // display-only — leave unindexed
}
```

You do not also add `@IndexedField("btree")`. `indexed: true` is the key index. Stacking `"btree"` is redundant.

Boot creates missing `bk_` indexes (`CONCURRENTLY` on real PostgreSQL). Tables above `BUNSANE_INDEX_SYNC_MAX_ROWS` (default 100000) build in the background after `init()`. A component registered after boot still gets its indexes. You do not call an ensure-index helper.

### `@CompositeIndex` — equality, then sort (0.9, unreleased)

A single-field key index cannot serve `status = 'paid' ORDER BY total`. Add a composite. It is a class decorator, exported from `"bunsane"`. It needs at least two `@CompData` fields. An unknown name fails boot.

```typescript
import { BaseComponent, Component, CompData, CompositeIndex } from "bunsane";

@CompositeIndex<OrderComponent>(["status", "total"])
@Component
export class OrderComponent extends BaseComponent {
  @CompData({ indexed: true })
  status: string = "open";

  @CompData({ indexed: true })
  total: number = 0;
}
```

The index is `(status, total, entity_id)`. Leading columns are equality. The next column is the sort or range. Keep the single-field `indexed: true` marks if you also filter or sort those fields alone.

Order matters. `["status", "total"]` does not serve `ORDER BY status` after an equality on `total`.

### `@IndexedField` — GIN, hash, fulltext, explicit numeric

Import from `bunsane/core/decorators/IndexedField`. The default type is `"gin"`, not `"btree"`. A bare `@IndexedField()` is not a sort key.

| Argument | Index now |
|----------|-----------|
| `"btree"` | Key index `(data->>'field', entity_id)`. Prefer `@CompData({ indexed: true })` instead. |
| `"numeric"` | Key index on `bunsane_num_v1(data->>'field')`. Use this when the design type is not `number` but the values are numeric. Non-numeric text is NULL. |
| `"gin"` | `USING GIN ((data->'field') jsonb_path_ops)`. Containment, not sort. An explicit gin on a key field survives boot. |
| `"hash"` | `USING HASH ((data->>'field'))`. Equality only. Not a sort key. |
| `"fulltext"` | `USING GIN (to_tsvector('english', data->'field'))`. Not a sort key. |

GIN is still the right index when:

- the field is an array (`arrayOf`) and you filter with `CONTAINS`, `CONTAINED_BY`, `HAS_ANY`, or `HAS_ALL`
- you need JSONB containment on an object, not equality or sort
- you need the English tsvector (`"fulltext"`)

```typescript
import { IndexedField } from "bunsane/core/decorators/IndexedField";
import { BaseComponent, Component, CompData } from "bunsane";

@Component
export class TagSetComponent extends BaseComponent {
  @IndexedField("gin")
  @CompData({ indexed: true, arrayOf: String })
  tags: string[] = [];
}
```

`indexed: true` plus `arrayOf` already creates that GIN index. Add `@IndexedField("gin")` when you want GIN on a scalar as well as, or instead of, a key index. Do not expect that GIN index to serve `sortBy`.

## Other `@CompData` options

```typescript
@CompData(options?: {
  indexed?: boolean;  // default false. Scalar → bk_ key index. arrayOf → GIN.
  nullable?: boolean; // default false. Stored as optional.
  arrayOf?: any;      // element constructor. Not a key index.
})
```

`nullable: true` marks the field optional in the archetype input schema. It does not change the key index. A missing key, JSON `null`, and `''` are blank to `FilterOp.IS_NULL`.

## Names

| Kind | Pattern | Example |
|------|---------|---------|
| Data | `{Domain}Component` | `EmailComponent` |
| Tag | `{Domain}Tag` | `AdminTag` |
| Status | `{Domain}StatusComponent` | `OrderStatusComponent` |

## Do not store a computed total

```typescript
import { ArcheType, ArcheTypeField, ArcheTypeFunction, BaseArcheType, Entity } from "bunsane";

@ArcheType("Order")
export class OrderArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(OrderAmountComponent)
  amount!: OrderAmountComponent;

  // async methods design-return Promise, so returnType is required.
  // Scalars: "string" | "number" | "boolean" | "Date". Not "Float" or "String".
  @ArcheTypeFunction({ returnType: "number" })
  async total(entity: Entity) {
    const amount = await entity.get(OrderAmountComponent);
    return (amount?.subtotal ?? 0) + (amount?.tax ?? 0);
  }
}
```

A list that calls this once per row is an N+1 if `total` queries other entities. Use `{ batch: true }` and return a `Map` keyed by entity id. See [Service patterns](./service-patterns.md).

Opaque blobs you never filter may stay a string. Do not hide queryable fields inside one.

## Read and write

`get()` returns a snapshot. Mutating it does not mark the entity dirty. Merge into `set()`, then `save()`.

```typescript
const inventory = await product.get(ProductInventoryComponent);
if (!inventory) {
  throw new Error("Product is missing inventory");
}
await product.set(ProductInventoryComponent, {
  ...inventory,
  quantity: inventory.quantity - 1,
});
await product.save();
```

`get()` returns `null` when the component is absent (including a negative-cache tombstone). A database error throws `ComponentLoadError`. It does not return `null`. `has()` is in-memory only. Use `hasPersisted()` for a database check.

`remove()` of a component you have not loaded returns `true`. `save()` deletes the row (0.7+).

## Checklist

- [ ] No nested objects in `@CompData()` fields
- [ ] Fields that change together live on one component
- [ ] Every filtered or sorted scalar has `{ indexed: true }`
- [ ] Equality-then-sort uses `@CompositeIndex`, leading column first
- [ ] Arrays that you contain-filter use GIN (`arrayOf` + `indexed: true`, or `@IndexedField("gin")`)
- [ ] Defaults on every field
- [ ] `emitDecoratorMetadata` is on, so `number` fields use `bunsane_num_v1()`. `Date` stays a text key
- [ ] Hot lists do not depend on empty tags
