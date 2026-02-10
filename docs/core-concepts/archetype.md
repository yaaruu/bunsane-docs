---
sidebar_position: 2
sidebar_label: Archetypes
---

# Archetypes

Archetypes define structured views over entities by grouping related components together. They automatically generate GraphQL types and provide a higher-level API for working with data.

## Defining an Archetype

Create an archetype by extending `BaseArcheType` and using the `@ArcheType` decorator:

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

Key points:
- The class name typically ends with `ArcheTypeClass`
- Export a type using `ArcheTypeOwnProperties<T>` for type inference
- Export an instance of the archetype for use in services

## The @ArcheType Decorator

Register the archetype with a name:

```typescript
// Using a string name
@ArcheType("User")
class UserArcheTypeClass extends BaseArcheType { }

// Using an enum for consistency
enum ArchetypeKind {
    User = "User",
    Order = "Order",
    Driver = "Driver",
}

@ArcheType(ArchetypeKind.User)
class UserArcheTypeClass extends BaseArcheType { }
```

## The @ArcheTypeField Decorator

Map components to archetype fields:

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

Use `{ nullable: true }` for optional fields.

## Computed Fields with @ArcheTypeFunction

Add computed fields that resolve dynamically. These fields are calculated at query time and exposed in the GraphQL schema.

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
        const parts = [title, firstName, lastName].filter(Boolean);
        return parts.join(" ");
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

The `returnType` option specifies the GraphQL return type. Common values include `"String"`, `"Int"`, `"Float"`, `"Boolean"`, and custom type names.

## Relations

Archetypes support relationships using relation decorators.

### HasOne

One-to-one relationship:

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

One-to-many relationship:

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

Inverse of HasOne/HasMany:

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

Note: Relations use string identifiers (archetype names) rather than direct class references.

## Creating Entities with Archetypes

Use the `fill()` and `createEntity()` methods:

```typescript
const user = UserArcheType.fill({
    name: "John Doe",
    phone: "+1234567890",
    email: "john@example.com",
}).createEntity();

// Add additional components if needed
user.add(PhoneComponent, { value: "+1234567890", verified: false });

await user.save();
```

## Updating Entities

Use the `updateEntity()` method:

```typescript
const user = await Entity.FindById(userId);
if (!user) {
    throw new Error("User not found");
}

const updated = await UserArcheType.updateEntity(user, {
    name: "Jane Doe",
    domisili: { value: "New City" },
});

await updated.save();
```

## Input Schema

Get a Zod schema for the archetype:

```typescript
// Full schema
const schema = UserArcheType.getZodObjectSchema();

// Input schema with partial/pick for mutations
const updateSchema = UserArcheType.getInputSchema().partial().pick({
    name: true,
    domisili: true,
});
```

## Registering Field Resolvers

In services, register the archetype's field resolvers:

```typescript
class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }
}
```

This enables computed fields (`@ArcheTypeFunction`) to resolve in GraphQL queries.

## GraphQL Integration

Archetypes automatically generate GraphQL types. The `CustomerArcheType` above generates:

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

Use archetypes as output types in GraphQL operations:

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
