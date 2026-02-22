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
import { BaseComponent, CompData, Component } from "bunsane/core/components";

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

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `indexed` | `boolean` | Creates a database index on this field for faster queries |
| `nullable` | `boolean` | Allows the field to be `null` in the database |

Use `{ indexed: true }` on fields you frequently filter or sort by.

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
import { Entity } from "bunsane/core/Entity";

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

Get a component's data from an entity:

```typescript
const nameComp = await entity.get(NameComponent);
console.log(nameComp?.value);  // "John Doe"
```

The result is `null` if the entity does not have that component.

### Updating Component Data

Update an existing component:

```typescript
await entity.set(NameComponent, { value: "Jane Doe" });
await entity.save();
```

### Adding Components

Attach a new component to an existing entity:

```typescript
entity.add(ProfilePictureComponent, { path: "/uploads/avatar.jpg" });
await entity.save();
```

### Deleting Entities

```typescript
await entity.delete();
```

### Saving

Always call `save()` after making changes. Without it, changes stay in memory only:

```typescript
await entity.save();
```

## Querying Entities

The `Query` class lets you find entities based on which components they have and what data those components contain.

```typescript
import { Query } from "bunsane/query";
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

### Filter Operators

All available operators in `Query.filterOp`:

| Operator | Description |
|----------|-------------|
| `EQ` | Equals |
| `NEQ` | Not equals |
| `GT` | Greater than |
| `GTE` | Greater than or equal |
| `LT` | Less than |
| `LTE` | Less than or equal |
| `LIKE` | Pattern matching (SQL LIKE) |
| `IN` | Value is in array |
| `NOT_IN` | Value is not in array |

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
const users = await new Query()
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(10)
    .offset(20)
    .exec();
```

- `.sortBy(Component, "field", "ASC" | "DESC")` -- sort results
- `.take(n)` -- limit to `n` results
- `.offset(n)` -- skip the first `n` results

### Counting Results

Get a count without loading all entities:

```typescript
const count = await new Query()
    .with(OrderTag)
    .count();
```

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
