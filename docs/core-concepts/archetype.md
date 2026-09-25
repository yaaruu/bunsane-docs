---
sidebar_position: 2
sidebar_label: Archetypes
---

# Archetypes

An archetype groups related components together into a named shape -- like saying "a User is an entity with a name, an email, and a phone number." Archetypes also auto-generate GraphQL types, so you do not have to write schema definitions by hand.

## Why Archetypes?

Without archetypes, you would need to manually specify which components to include every time you return data from a GraphQL operation. Archetypes solve this by giving a name and structure to common entity shapes.

When you define a `User` archetype, BunSane automatically:
- Creates a `User` GraphQL type with fields matching your components
- Creates helper methods for creating and updating entities. GraphQL inputs are per operation, not a `UserInput` type

## Defining an Archetype

```typescript
import { ArcheType, ArcheTypeField, BaseArcheType } from "bunsane";
import type { ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import { NameComponent, EmailComponent, PhoneComponent } from "./components/UserComponent";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(EmailComponent, { nullable: true })
    email!: EmailComponent;

    @ArcheTypeField(PhoneComponent)
    phone!: PhoneComponent;
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
export const UserArcheType = new UserArcheTypeClass();
```

A few things to note:

- **`@ArcheType("User")`** registers the archetype with the name "User" -- this becomes the GraphQL type name
- **`@ArcheTypeField(Component)`** maps a component to a field on the archetype
- **`{ nullable: true }`** marks a field as optional (it may not be present on every entity)
- Export a **type** using `ArcheTypeOwnProperties<T>` for type inference in your services
- Export an **instance** of the archetype for use in service decorators and operations

## The @ArcheType Decorator

The decorator takes a name string that becomes the GraphQL type name:

```typescript
@ArcheType("User")
class UserArcheTypeClass extends BaseArcheType { }

// You can also use an enum for consistency across your codebase
enum ArchetypeKind {
    User = "User",
    Order = "Order",
}

@ArcheType(ArchetypeKind.User)
class UserArcheTypeClass extends BaseArcheType { }
```

## The @ArcheTypeField Decorator

Each field maps a component to the archetype:

```typescript
@ArcheType("Product")
export class ProductArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(ProductInfoComponent)
    info!: ProductInfoComponent;

    @ArcheTypeField(PricingComponent, { nullable: true })
    pricing!: PricingComponent;

    @ArcheTypeField(InventoryComponent, { nullable: true })
    inventory!: InventoryComponent;
}
```

Use `{ nullable: true }` for components that may not exist on every entity of this type.

## Computed Fields (@ArcheTypeFunction)

Add fields that are calculated at query time using `@ArcheTypeFunction`. These appear in the GraphQL schema as regular fields but are resolved by calling a method on the archetype class instead of reading from a component.

### Basic Usage

Decorate a method with `@ArcheTypeFunction` and provide a `returnType`. The method receives the resolved `Entity` and returns a computed value.

```typescript
import { ArcheType, ArcheTypeField, ArcheTypeFunction, BaseArcheType, Entity } from "bunsane";

@ArcheType("Customer")
export class CustomerArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(PersonNameComponent)
    name!: PersonNameComponent;

    @ArcheTypeField(MembershipComponent, { nullable: true })
    membership!: MembershipComponent;

    @ArcheTypeFunction({ returnType: "string" })
    async display_name(entity: Entity) {
        const name = await entity.get(PersonNameComponent);
        if (!name) return "";
        const { firstName, lastName, title } = name;
        return [title, firstName, lastName].filter(Boolean).join(" ");
    }

    @ArcheTypeFunction({ returnType: "boolean" })
    async is_premium(entity: Entity) {
        const membership = await entity.get(MembershipComponent);
        if (!membership) return false;
        return membership.tier === "gold" || membership.tier === "platinum";
    }
}
```

`returnType` is required when the design return type is `Promise` or `Object` (the usual case for an `async` method). Omitting it throws at schema build. It does not fall back to `Any`.

Built-in scalars: `"string"`, `"number"`, `"boolean"`, `"Date"` (or `"date"`). Any other string is an archetype or custom type name. An unknown name throws at schema build.

| `returnType` | GraphQL type |
|---|---|
| `"string"` | `String` |
| `"number"` | `Float` |
| `"boolean"` | `Boolean` |
| `"Date"` | `Date` |
| `"Order"` (a registered archetype) | that type |

### Arguments

`@ArcheTypeFunction` supports GraphQL arguments via the `args` option. Each entry specifies a `name`, a `type` constructor, and an optional `nullable` flag.

```typescript
import { ArcheTypeFunction, Entity } from "bunsane";

@ArcheTypeFunction({
    returnType: "number",
    args: [
        { name: "unit", type: String, nullable: true },
    ],
})
async distance_to(entity: Entity, unit?: string) {
    const location = await entity.get(LocationComponent);
    if (!location) return null;
    const factor = unit === "miles" ? 0.621371 : 1;
    return location.distanceKm * factor;
}
```

Argument `type` values map to GraphQL types as follows:

| `type` value | GraphQL type |
|---|---|
| `String` | `String` |
| `Number` | `Float` |
| `Boolean` | `Boolean` |
| `Date` | `Date` |
| Custom class | Resolved from the type registry |

Arguments with `nullable: false` (the default) are required -- the resolver throws if the argument is missing. Set `nullable: true` for optional arguments.

### How It Differs from @ArcheTypeField

| | `@ArcheTypeField` | `@ArcheTypeFunction` |
|---|---|---|
| Source | Component data | Method on the archetype class |
| GraphQL input | Included in the generated input type | Excluded |
| Arguments | None | `args` option |
| Batching | Loaded with the field DataLoader | Per entity, unless `batch: true` |

You do not call `registerFieldResolvers`. Schema build attaches field, relation, and function resolvers (0.7+). The method remains and is idempotent.

### Batched functions (0.8+)

`batch: true` calls the method once per request with every parent:

```typescript
import { ArcheTypeFunction, Entity } from "bunsane";

@ArcheTypeFunction({ returnType: "number", batch: true })
async openOrderCount(
    parents: readonly Entity[],
    _ctx: unknown,
): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const parent of parents) {
        counts.set(parent.id, await countOpenOrders(parent.id));
    }
    return counts;
}
```

The map is keyed by parent entity id. A missing key on a non-null field throws. Function fields are nullable unless you model them otherwise, so a missing key usually resolves to `null`.

### Generated Schema Example

This archetype definition:

```typescript
import { ArcheType, ArcheTypeField, ArcheTypeFunction, BaseArcheType, Entity } from "bunsane";

@ArcheType("Store")
export class StoreArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(StoreInfoComponent)
    info!: StoreInfoComponent;

    @ArcheTypeFunction({ returnType: "boolean" })
    async is_open(entity: Entity) { ... }

    @ArcheTypeFunction({
        returnType: "number",
        args: [{ name: "unit", type: String, nullable: true }],
    })
    async distance_to(entity: Entity, unit?: string) { ... }
}
```

Weaving an archetype emits an **output** type only. There is no `StoreInput`. GraphQL inputs are per operation (`createStoreInput` from `@GraphQLOperation`). Nested component type names lower-case the first character of the class name. A tag with no `@CompData` fields is omitted. Every archetype type includes `id: ID`.

```graphql
type Store {
    id: ID
    info: storeInfoComponent!
    is_open: Boolean
    distance_to(unit: String): Float
}
```

Computed fields are not part of `getInputSchema()`. That method returns a Zod object, not a GraphQL input type.

## Relations

`HasOne`, `HasMany`, `BelongsTo`, and `BelongsToMany` are on the root barrel. The target may be a registered name, the archetype class, or a thunk `() => Class` (0.7+). An unregistered target throws at schema build.

```typescript
import { BelongsTo, HasMany, HasOne } from "bunsane";

@HasOne(() => DriverArcheTypeClass)
driver?: IDriverArcheType;

@HasMany("Order")
orders!: IOrderArcheType[];

@BelongsTo(UserArcheTypeClass, { foreignKey: "device.user_id" })
user!: IUserArcheType;
```

### Foreign key (0.8+)

You may omit `foreignKey` only when exactly one `user_id` or `parent_id` property matches. Zero matches, or several, fail schema build and name the candidates. Set the dotted form yourself: `'<archetypeField>.<prop>'` — the field name on the owning archetype, not the class name.

```typescript
@BelongsTo("User", { foreignKey: "device.user_id" })
user!: IUserArcheType;
```

Search looks at the related archetype for `hasMany`, `hasOne`, and `belongsToMany`, and at this archetype for `belongsTo`.

### Nullability

| Relation | Default | `nullable: false` |
|---|---|---|
| `HasOne` | nullable. A missing child is `null` | non-null |
| `HasMany` / `BelongsToMany` | nullable list | required list |
| `BelongsTo` | non-null | stays non-null; set `nullable: true` to allow null |

`BelongsToMany` requires `through`.

```typescript
@HasOne("Driver") // nullable unless nullable: false
driver?: IDriverArcheType;

@HasMany("User", { foreignKey: "parent_id", nullable: false })
items!: IUserArcheType[];
```

Do not point `foreignKey` at `"id"` unless that property is the real foreign key. The old "scan every partition" lookup is gone.

## Creating Entities with Archetypes

`fill()` expects component data when the field is typed as a component class. A bare string is unwrapped to `{ value }` only when the field's design type is `String`, `Number`, `Boolean`, or `Date`.

```typescript
const user = UserArcheType.fill({
    name: { value: "John Doe" },
    phone: { value: "+1234567890" },
    email: { value: "john@example.com" },
}).createEntity();

await user.save();
```

You can also add extra components after creating:

```typescript
const user = UserArcheType.fill({
    name: { value: "John Doe" },
    phone: { value: "+1234567890" },
}).createEntity();

user.add(PhoneComponent, { value: "+1234567890", verified: false });
await user.save();
```

## Updating Entities

`updateEntity()` writes the same component-shaped payload:

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

const updated = await UserArcheType.updateEntity(user, {
    name: { value: "Jane Doe" },
});

await updated.save();
```

## Input Schemas

`getInputSchema()` returns a Zod object with relations and functions excluded. `withValidation` merges extra Zod fields onto it. Use that for in-process checks.

```typescript
const updateSchema = UserArcheType.getInputSchema().partial().pick({
    name: true,
});
```

Do not pass that Zod object as `@GraphQLOperation` `input` in new code. Zod and string-map inputs still work and log a deprecation warning. Prefer `t.*`. See [Services](./service.md).

## Field Resolvers

Schema build registers computed fields and relations. You do not call `registerFieldResolvers` in the service constructor. If you do, the call is idempotent and skips pairs that are already registered.

## GraphQL Integration

The `Customer` archetype above becomes an output type. Nested component names are lowerCamelCase. There is no `CustomerInput`.

```graphql
type Customer {
    id: ID
    name: personNameComponent!
    membership: membershipComponent
    display_name: String
    is_premium: Boolean
}
```

Use archetypes as the output type in your GraphQL operations:

```typescript
@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async profile(args: {}, context: GraphQLContext) {
    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```

