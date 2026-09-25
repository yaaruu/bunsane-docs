---
sidebar_position: 1
sidebar_label: Entities & Components
---

# Entities & Components

This page is your reference for BunSane's data model: how to define components, create entities, query data, and use transactions.

## Components

Components are data containers that you attach to entities. Each component type becomes its own table in PostgreSQL.

### Defining Components

Create a component by extending `BaseComponent` and marking it with `@Component`:

```typescript
import { BaseComponent, CompData, Component } from "bunsane";

@Component
export class NameComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

@Component
export class EmailComponent extends BaseComponent {
    @CompData()
    value: string = "";

    @CompData()
    verified: boolean = false;
}
```

### The @CompData Decorator

Fields marked with `@CompData()` are persisted to the database. Fields without it are ignored.

```typescript
@Component
export class ProfileComponent extends BaseComponent {
    @CompData()
    firstName: string = "";

    @CompData()
    lastName: string = "";

    @CompData({ indexed: true })
    username: string = "";

    @CompData()
    createdAt: Date = new Date();
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `indexed` | `boolean` | `false` | On a field with no `arrayOf`, creates a key index (`bk_…` on `(data->>'field', entity_id)`). Not a GIN index (0.9, unreleased). `arrayOf` fields still get GIN. An object field does not; use `@IndexedField("gin")` for that. |
| `nullable` | `boolean` | `false` | Allows the field to be omitted |
| `arrayOf` | constructor | — | Element type for an array field |

Index fields you filter or sort by. A sort on a field with no key index scans the table. See [List queries](../query-lists.md).

`emitDecoratorMetadata` is required. BunSane reads `design:type` so a `Date` field is revived from a valid ISO string on `get()`, reload, and `Query.populate()` (0.7+). An invalid string is left as a string so a later `save()` can reject it.

### Component Methods

Components can include helper methods:

```typescript
@Component
export class PasswordComponent extends BaseComponent {
    @CompData()
    value: string = "";

    static async makeHash(plaintext: string): Promise<string> {
        return await Bun.password.hash(plaintext);
    }
}
```

### Tags

A Tag is a component with no data fields. Tags are used to label entities by type:

```typescript
@Component
export class UserTag extends BaseComponent {}

@Component
export class OrderTag extends BaseComponent {}
```

Tags are essential for queries -- they let you find "all users" or "all orders" without needing to know which specific data components are attached.

## Entities

An entity is a container that holds components. Each entity has a unique UUID and can have any combination of components attached.

### Creating Entities

Use `Entity.Create()` to create a new entity and chain `.add()` calls to attach components:

```typescript
import { Entity } from "bunsane";

const user = Entity.Create()
    .add(UserTag, {})
    .add(NameComponent, { value: "John Doe" })
    .add(EmailComponent, { value: "john@example.com", verified: false });

await user.save();
```

The entity is not written to the database until you call `.save()`.

### Finding Entities

Look up an entity by its ID:

```typescript
const user = await Entity.FindById("entity-uuid-here");
```

Returns `null` if no entity with that ID exists.

### Reading Component Data

`get()` returns a snapshot. Mutating the object does not change the entity. Call `set()` and `save()` to persist a change.

```typescript
const nameComp = await entity.get(NameComponent);
console.log(nameComp?.value);  // "John Doe"
```

`null` means the component is **absent** (0.7+): empty entity id, a pending or already-saved removal, or the database confirmed zero rows. A pool, SQL, timeout, or admission failure throws `ComponentLoadError`. It does not return `null`.

```typescript
import { ComponentLoadError, ComponentMissingError } from "bunsane/core/Entity";

try {
    const name = await entity.get(NameComponent);
    if (!name) {
        // confirmed absence
    }
} catch (err) {
    if (err instanceof ComponentLoadError) {
        // infrastructure failure — do not treat this as "missing"
    }
}

// Absence after a successful load throws ComponentMissingError.
const required = await entity.getOrThrow(NameComponent);
```

`getInstanceOf` returns the component instance, or `null`. `has()` is an in-memory check only. `hasPersisted()` (0.7+) asks the database. A pending or already-saved `remove()` makes `hasPersisted()` return `false` without reloading the row.

### Updating Component Data

`set()` loads the component, then assigns. If it is missing, `set()` adds it.

```typescript
await entity.set(NameComponent, { value: "Jane Doe" });
await entity.save();
```

### Removing a Component

`remove()` returns `true` and deletes the row on the next `save()`, even when this session has not loaded the component (0.7+). It returns `false` only when this session already saved that deletion.

```typescript
entity.remove(ProfilePictureComponent);
await entity.save();
```

`add()` and `remove()` hook failures do not fail the call.

### Deleting Entities

```typescript
await entity.delete();       // soft delete
await entity.delete(true);   // force
```

### Saving

Changes stay in memory until `save()`. A single `save()` goes through `saveMany`: one admission, one transaction, 500-row chunks.

```typescript
await entity.save();
await Entity.saveMany([first, second]);
```

A dirty save bumps `entities.updated_at` and the changed component row's `updated_at`. `created_at` is kept. Dirty flags clear as soon as the save's own statements succeed, including read-model sync — a second `save()` in the same transaction is an update, not a duplicate insert. A rollback of that transaction (opened through `db` / `getDb()` / `dbTransaction`) restores the flags, so a retried `save()` reissues every statement.

Pass a caller-owned transaction as `save(trx)`. That handle takes no extra admission permit. Pass `{ trx }` into `get` and `set`. `FindById` takes the transaction as a second argument: `Entity.FindById(id, trx)`.

## Querying Entities

The `Query` class lets you find entities based on which components they have and what data those components contain.

```typescript
import { FilterOp, Query } from "bunsane";
```

### Basic Query

Find all entities that have a specific component:

```typescript
const users = await new Query()
    .with(EmailComponent)
    .exec();
```

### Filtering

Filter by component field values using `Query.filters()` and `Query.filter()`:

```typescript
const users = await new Query()
    .with(
        EmailComponent,
        Query.filters(
            Query.filter("value", Query.filterOp.EQ, "john@example.com")
        )
    )
    .exec();
```

You can combine multiple filters on the same component:

```typescript
const devices = await new Query()
    .with(
        UserDeviceComponent,
        Query.filters(
            Query.filter("device.unique_id", Query.filterOp.EQ, deviceId),
            Query.filter("verified", Query.filterOp.EQ, true)
        )
    )
    .exec();
```

`Query.filterOp` is the same enum as `FilterOp`.

| Operator | Description |
|----------|-------------|
| `EQ`, `NEQ` | Equals / not equals |
| `GT`, `GTE`, `LT`, `LTE` | Ordered comparison |
| `LIKE`, `ILIKE` | Pattern match |
| `IN`, `NOT_IN` | Membership. An empty `IN` is SQL `FALSE`; an empty `NOT IN` is SQL `TRUE` |
| `IS_NULL`, `IS_NOT_NULL` | Blank check (0.7+). JSON null and a missing key both count, because `->>` yields SQL NULL. An empty string counts as blank too |
| `CONTAINS`, `CONTAINED_BY`, `HAS_ANY`, `HAS_ALL` | JSON array membership |

A boolean filter compares the JSON text `data->>'field' = 'true'` (0.7+). The strings `"yes"`, `"1"`, and `"t"` do not match.

There is no `.limit()` on `Query`. Use `.take(n)`. Read-model queries have their own `.limit()` — see [Read models](../read-models.md).

### Multiple Components

Require entities to have several components:

```typescript
const results = await new Query()
    .with(UserTag)
    .with(EmailComponent)
    .exec();
```

### Excluding Components

Find entities that do **not** have a component:

```typescript
const unverified = await new Query()
    .with(UserTag)
    .without(VerifiedTag)
    .exec();
```

### Pagination and Sorting

```typescript
// Preferred list page: explicit take → hasNextPage without a second count()
const q = new Query()
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(10);
const users = await q.exec();
const { hasNextPage } = q.getLastRouteInfo();

// Deep sorted pages: sortedCursor (not plain cursor + sortBy)
const last = users[users.length - 1]!;
const profile = await last.get(ProfileComponent);
const token = Query.encodeSortedCursor(profile!.createdAt, last.id);
const page2 = await new Query()
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(10)
    .sortedCursor(token)
    .exec();
```

| Method | Use |
|--------|-----|
| `.sortBy(Component, "field", "ASC" \| "DESC")` | Sort by a component field (index the field) |
| `.take(n)` | Limit to `n` results; enables `hasNextPage` via LIMIT n+1 |
| `.offset(n)` | Skip rows (degrades on deep pages — prefer `sortedCursor`) |
| `.sortedCursor(token)` | Keyset pagination for **sorted** lists |
| `.cursor(id)` | Id-order pages only — **throws** if combined with `.sortBy()` |

See [List queries](../query-lists.md) for N+1, the default 10000-row cap, and sorted cursors. [QSP](../qsp.md) is an optional list accelerator. Without `.take()`, `exec()` applies that cap and warns once, in every environment, on the first such call — whether or not the cap binds. If the page fills the cap and `NODE_ENV=development`, `exec()` throws. `getLastRouteInfo().truncatedByDefaultLimit` is set in every environment when the cap binds. Other environments do not warn again just because a page was truncated.

`.populate()` returns a new query. Use the return value. Calling it only for the side effect drops the loaded type.

### Counting Results

Exact count is a full cardinality scan — fine for small sets; avoid on every infinite-scroll request:

```typescript
const count = await new Query()
    .with(OrderTag)
    .count();
```

Prefer `hasNextPage` for “load more” UIs.

## Transactions

When you need multiple database operations to succeed or fail together, wrap them in a transaction:

```typescript
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
    // All operations inside use the same transaction
    await device.set(UserDeviceComponent, {
        otp_code: "",
        verified: true,
    }, { trx });
    await device.save(trx);

    const user = await Entity.FindById(userId, trx);
    if (!user) {
        throw new Error("User not found");
    }

    const phone = await user.get(PhoneComponent, { trx });
    if (phone) {
        await user.set(PhoneComponent, { ...phone, verified: true }, { trx });
        await user.save(trx);
    }

    return user;
});
```

Pass the `trx` object to every entity operation inside the transaction. If any operation throws, the entire transaction is rolled back.

`db` is a lazy proxy, not the SQL instance. `db.transaction` still works. Use `getDb()` from `"bunsane/database"` when you need the instance itself (`db === getDb()` is false). Framework writes use `dbTransaction` from `"bunsane/database/gateway"` so admission and `statement_timeout` apply. A `trx` you pass into `save` does not take a second permit. See [Database](../database.md).
