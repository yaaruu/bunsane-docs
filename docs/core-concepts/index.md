---
sidebar_position: 1
sidebar_label: Entity Component
---

# Entity Component

BunSane uses an Entity-Component pattern for data storage. This approach provides flexibility in how data is structured and queried.

## Components

Components are data containers that can be attached to entities. Each component type represents a specific piece of data.

### Defining Components

Create components by extending `BaseComponent` and using the `@Component` decorator:

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

Fields marked with `@CompData` are persisted to the database:

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

Use `{ indexed: true }` for fields that are frequently queried to improve performance.

### Component Methods

Components can include static or instance methods:

```typescript
import Cryptography from "./modules/Cryptography";

@Component
export class PasswordComponent extends BaseComponent {
    @CompData()
    value: string = "";

    static makeHash(value: string) {
        return Cryptography.makeHash(value);
    }
}
```

## Entities

Entities are containers that hold components. Each entity has a unique ID and can have any combination of components attached.

### Creating Entities

Use `Entity.Create()` to create a new entity with components:

```typescript
import { Entity } from "bunsane/core/Entity";

const user = Entity.Create()
    .add(NameComponent, { value: "John Doe" })
    .add(EmailComponent, { value: "john@example.com", verified: false });

await user.save();
```

### Finding Entities

Find an entity by its ID:

```typescript
const user = await Entity.FindById("entity-uuid-here");
```

### Working with Components

Get component data from an entity:

```typescript
const nameComp = await entity.get(NameComponent);
console.log(nameComp?.value);  // "John Doe"
```

Set or update component data:

```typescript
await entity.set(NameComponent, { value: "Jane Doe" });
await entity.save();
```

Add a new component to an entity:

```typescript
entity.add(ProfilePictureComponent, { path: "/uploads/avatar.jpg" });
await entity.save();
```

### Saving Entities

Always call `save()` to persist changes:

```typescript
await entity.save();
```

## Querying Entities

Use the `Query` class to find entities by their components:

```typescript
import { Query } from "bunsane/query";

// Find all entities with a specific component
const users = await new Query()
    .with(EmailComponent)
    .exec();
```

### Filtering

Filter by component field values:

```typescript
// Using filter helper function
import { FieldEqualsFilter } from "./utilities/QueryHelper";

const users = await new Query()
    .with(PhoneComponent, FieldEqualsFilter<PhoneComponent>("value", "+1234567890"))
    .exec();
```

Using Query's built-in filter methods:

```typescript
const users = await new Query()
    .with(
        UserDeviceComponent,
        Query.filters(
            Query.filter("device.unique_id", Query.filterOp.EQ, deviceId),
            Query.filter("verified", Query.filterOp.EQ, true)
        )
    )
    .exec();
```

Available filter operators in `Query.filterOp`:
- `EQ` - Equals
- `NEQ` - Not equals
- `GT` - Greater than
- `GTE` - Greater than or equals
- `LT` - Less than
- `LTE` - Less than or equals
- `LIKE` - Pattern matching
- `IN` - In array
- `NOT_IN` - Not in array

### Multiple Components

Query entities that have multiple components:

```typescript
const results = await new Query()
    .with(WhatsappSessionComponent)
    .with(WhatsappAuthenticatedTag)
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

### Counting Results

```typescript
const count = await new Query()
    .with(OrderComponent)
    .count();
```

## Transactions

Use transactions for operations that require multiple writes:

```typescript
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
    await device.set(UserDeviceComponent, {
        otp_code: "",
        verified: true,
    }, { trx: trx });
    await device.save(trx);

    const user = await Entity.FindById(userId, trx);
    if (!user) {
        throw new Error("User not found");
    }

    const phone = await user.get(PhoneComponent, { trx: trx });
    if (phone) {
        await user.set(PhoneComponent, { ...phone, verified: true }, { trx: trx });
        await user.save(trx);
    }

    return user;
});
```

Pass the transaction object `trx` to entity operations to ensure they run within the same transaction.
