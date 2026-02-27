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
- Creates a `UserInput` GraphQL input type for mutations
- Provides helper methods for creating and updating entities

## Defining an Archetype

```typescript
import {
    ArcheType,
    ArcheTypeField,
    BaseArcheType,
    type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
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
import { ArcheType, ArcheTypeField, ArcheTypeFunction, BaseArcheType } from "bunsane/core/ArcheType";
import { Entity } from "bunsane/core/Entity";

@ArcheType("Customer")
export class CustomerArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(PersonNameComponent)
    name!: PersonNameComponent;

    @ArcheTypeField(MembershipComponent, { nullable: true })
    membership!: MembershipComponent;

    @ArcheTypeFunction({ returnType: "String" })
    async display_name(entity: Entity) {
        const name = await entity.get(PersonNameComponent);
        if (!name) return "";
        const { firstName, lastName, title } = name;
        return [title, firstName, lastName].filter(Boolean).join(" ");
    }

    @ArcheTypeFunction({ returnType: "Boolean" })
    async is_premium(entity: Entity) {
        const membership = await entity.get(MembershipComponent);
        if (!membership) return false;
        return membership.tier === "gold" || membership.tier === "platinum";
    }
}
```

### Return Types

The `returnType` option is a GraphQL scalar or type name string. It is inserted verbatim into the generated schema, so the value must be a valid GraphQL type name.

| `returnType` value | GraphQL type |
|---|---|
| `"String"` | `String` |
| `"Int"` | `Int` |
| `"Float"` | `Float` |
| `"Boolean"` | `Boolean` |
| `"Point"` (or any custom name) | Inserted verbatim into the schema |

Always specify `returnType` explicitly. If omitted, BunSane reflects the TypeScript return type -- but async methods reflect as `Promise`, which falls back to `Any` in the generated schema.

### Arguments

`@ArcheTypeFunction` supports GraphQL arguments via the `args` option. Each entry specifies a `name`, a `type` constructor, and an optional `nullable` flag.

```typescript
import { ArcheTypeFunction } from "bunsane/core/ArcheType";
import { Entity } from "bunsane/core/Entity";

@ArcheTypeFunction({
    returnType: "Float",
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
| Source | ECS component data from DB/cache | Method on the archetype class |
| GraphQL input | Included in the generated input type | Excluded from input types |
| Arguments | None | Supported via `args` option |
| DataLoader | Batched automatically | Calls method directly per entity |

### Registering Resolvers

For `@ArcheTypeFunction` (and relations) to resolve in GraphQL, call `registerFieldResolvers()` in your service constructor. See [Registering Field Resolvers](#registering-field-resolvers) below.

### Generated Schema Example

This archetype definition:

```typescript
import { ArcheType, ArcheTypeField, ArcheTypeFunction, BaseArcheType } from "bunsane/core/ArcheType";
import { Entity } from "bunsane/core/Entity";

@ArcheType("Store")
export class StoreArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(StoreInfoComponent)
    info!: StoreInfoComponent;

    @ArcheTypeFunction({ returnType: "Boolean" })
    async is_open(entity: Entity) { ... }

    @ArcheTypeFunction({
        returnType: "Float",
        args: [{ name: "unit", type: String, nullable: true }],
    })
    async distance_to(entity: Entity, unit?: string) { ... }
}
```

Generates this GraphQL schema:

```graphql
type Store {
    info: StoreInfoComponent!
    is_open: Boolean
    distance_to(unit: String): Float
}

input StoreInput {
    info: StoreInfoComponentInput!
}
```

Computed fields do not appear in the input type -- only `@ArcheTypeField` fields are included in the generated `StoreInput`.

## Relations

Archetypes support relationships between entity types.

### HasOne

A one-to-one relationship:

```typescript
import { HasOne } from "bunsane/core/ArcheType";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(ProfileComponent)
    profile!: ProfileComponent;

    @HasOne("Driver", { foreignKey: "user_id", nullable: true })
    driver?: IDriverArcheType;
}
```

### HasMany

A one-to-many relationship:

```typescript
import { HasMany } from "bunsane/core/ArcheType";

@ArcheType("UserListResponse")
export class UserListResponseArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(CountTag)
    totalData!: number;

    @HasMany("User", { foreignKey: "id", nullable: true })
    items!: IUserArcheType[];
}
```

### BelongsTo

The inverse side of HasOne or HasMany:

```typescript
import { BelongsTo } from "bunsane/core/ArcheType";

@ArcheType("UserDevice")
export class UserDeviceArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(UserDeviceComponent)
    device!: UserDeviceComponent;

    @BelongsTo("User", { foreignKey: "device.user_id" })
    user!: IUserArcheType;
}
```

Relations use string identifiers (the archetype name) rather than direct class references.

## Creating Entities with Archetypes

Use `fill()` and `createEntity()` for a shorthand way to create entities:

```typescript
const user = UserArcheType.fill({
    name: "John Doe",
    phone: "+1234567890",
    email: "john@example.com",
}).createEntity();

await user.save();
```

You can also add extra components after creating:

```typescript
const user = UserArcheType.fill({
    name: "John Doe",
    phone: "+1234567890",
}).createEntity();

user.add(PhoneComponent, { value: "+1234567890", verified: false });
await user.save();
```

## Updating Entities

Use `updateEntity()` to update specific components on an existing entity:

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

const updated = await UserArcheType.updateEntity(user, {
    name: "Jane Doe",
});

await updated.save();
```

## Input Schemas

Archetypes can generate Zod schemas for input validation:

```typescript
// Full schema for the archetype
const schema = UserArcheType.getZodObjectSchema();

// Partial schema for update mutations
const updateSchema = UserArcheType.getInputSchema().partial().pick({
    name: true,
});
```

These schemas are useful as inputs to `@GraphQLOperation` decorators (see [Services](./service.md)).

## Registering Field Resolvers

For computed fields (`@ArcheTypeFunction`) and relations to work in GraphQL, register the archetype's field resolvers in your service:

```typescript
class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }
}
```

## GraphQL Integration

The `Customer` archetype defined above automatically generates these GraphQL types:

```graphql
type Customer {
    name: PersonNameComponent!
    membership: MembershipComponent
    display_name: String
    is_premium: Boolean
}

input CustomerInput {
    name: PersonNameComponentInput!
    membership: MembershipComponentInput
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
