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

## Computed Fields

Add fields that are calculated at query time using `@ArcheTypeFunction`. These appear in the GraphQL schema as regular fields.

```typescript
import { ArcheTypeFunction } from "bunsane/core/ArcheType";
import { Entity } from "bunsane/core/Entity";

@ArcheType("Customer")
export class CustomerArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(PersonNameComponent)
    name!: PersonNameComponent;

    @ArcheTypeField(MembershipComponent, { nullable: true })
    membership!: MembershipComponent;

    @ArcheTypeFunction({
        returnType: "String",
    })
    async display_name(entity: Entity) {
        const name = await entity.get(PersonNameComponent);
        if (!name) return "";

        const { firstName, lastName, title } = name;
        return [title, firstName, lastName].filter(Boolean).join(" ");
    }

    @ArcheTypeFunction({
        returnType: "Boolean",
    })
    async is_premium(entity: Entity) {
        const membership = await entity.get(MembershipComponent);
        if (!membership) return false;
        return membership.tier === "gold" || membership.tier === "platinum";
    }
}
```

The `returnType` option specifies the GraphQL return type. Common values: `"String"`, `"Int"`, `"Float"`, `"Boolean"`.

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
