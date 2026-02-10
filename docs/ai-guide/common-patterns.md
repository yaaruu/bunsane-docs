---
sidebar_position: 5
sidebar_label: Common Patterns
---

# Common Patterns

This guide provides reusable code patterns for common scenarios in BunSane applications.

## Entity Patterns

### Create Entity with Multiple Components

```typescript
const user = Entity.Create()
    .add(UserTag, {})
    .add(NameComponent, { value: "John Doe" })
    .add(EmailComponent, { value: "john@example.com", verified: false })
    .add(ProfileComponent, {
        avatarUrl: "",
        bio: "",
        createdAt: new Date(),
    });

await user.save();
```

### Create Using Archetype

```typescript
const user = UserArcheType.fill({
    name: "John Doe",
    email: "john@example.com",
    phone: "+1234567890",
}).createEntity();

await user.save();
```

### Update Entity Components

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

// Get current values
const currentProfile = await user.get(ProfileComponent);

// Update with merged values
await user.set(ProfileComponent, {
    ...currentProfile,
    bio: "Updated bio",
    updatedAt: new Date(),
});

await user.save();
```

#### Entity Method Signatures

The `get()` and `set()` methods accept an optional context parameter for transactions and DataLoader integration:

```typescript
// Method signatures
entity.get<T>(Component, context?: { loaders?: DataLoaders; trx?: Transaction }): Promise<T | null>
entity.set<T>(Component, data, context?: { loaders?: DataLoaders; trx?: Transaction }): Promise<this>
```

See the [Transaction Patterns](#transaction-patterns) section for usage with transactions.

### Update Using Archetype

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

const updated = await UserArcheType.updateEntity(user, {
    name: "Jane Doe",
});

await updated.save();
```

### Add Component to Existing Entity

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

// Add new component
user.add(PremiumTag, {});
user.add(SubscriptionComponent, {
    plan: "premium",
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
});

await user.save();
```

### Check if Entity Has Component

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

const premiumTag = await user.get(PremiumTag);
const isPremium = premiumTag !== null;
```

## Transaction Patterns

### Basic Transaction

```typescript
import db from "bunsane/database";

await db.transaction(async (trx) => {
    const user = await Entity.FindById(userId, trx);
    if (!user) throw new Error("User not found");

    await user.set(BalanceComponent, { amount: 100 }, { trx });
    await user.save(trx);
});
```

### Transaction with Multiple Entities

```typescript
const result = await db.transaction(async (trx) => {
    // Debit source account
    const source = await Entity.FindById(sourceId, trx);
    const sourceBalance = await source.get(BalanceComponent, { trx });

    if (sourceBalance.amount < amount) {
        throw new Error("Insufficient funds");
    }

    await source.set(BalanceComponent, {
        amount: sourceBalance.amount - amount,
    }, { trx });
    await source.save(trx);

    // Credit destination account
    const dest = await Entity.FindById(destId, trx);
    const destBalance = await dest.get(BalanceComponent, { trx });

    await dest.set(BalanceComponent, {
        amount: destBalance.amount + amount,
    }, { trx });
    await dest.save(trx);

    // Create transaction record
    const txRecord = Entity.Create()
        .add(TransactionTag, {})
        .add(TransactionInfoComponent, {
            sourceId,
            destId,
            amount,
            timestamp: new Date(),
        });
    await txRecord.save(trx);

    return txRecord.id;
});
```

### Transaction with Rollback on Error

```typescript
try {
    await db.transaction(async (trx) => {
        // Operations that might fail
        await riskyOperation1(trx);
        await riskyOperation2(trx);

        // If any operation throws, entire transaction rolls back
    });
} catch (error) {
    // Transaction automatically rolled back
    console.error("Transaction failed:", error);
    throw error;
}
```

## Query Patterns

### Find Single by Unique Field

```typescript
async function findUserByEmail(email: string): Promise<Entity | null> {
    const results = await new Query()
        .with(UserTag)
        .with(
            EmailComponent,
            Query.filters(Query.filter("value", Query.filterOp.EQ, email))
        )
        .take(1)
        .exec();

    return results[0] || null;
}
```

### Find with Multiple Conditions

```typescript
async function findActiveUsersByRole(role: string) {
    return await new Query()
        .with(UserTag)
        .with(
            RoleComponent,
            Query.filters(Query.filter("value", Query.filterOp.EQ, role))
        )
        .without(SoftDeletedTag)
        .without(SuspendedTag)
        .exec();
}
```

### Paginated Query with Total Count

```typescript
async function paginatedQuery<T>(
    baseQuery: Query,
    page: number,
    pageSize: number
): Promise<{ items: Entity[]; total: number; pages: number }> {
    const [items, total] = await Promise.all([
        baseQuery
            .take(pageSize)
            .offset(page * pageSize)
            .exec(),
        baseQuery.count(),
    ]);

    return {
        items,
        total,
        pages: Math.ceil(total / pageSize),
    };
}

// Usage
const result = await paginatedQuery(
    new Query().with(UserTag).with(ProfileComponent),
    0,  // page
    20  // pageSize
);
```

### Date Range Query

```typescript
async function findOrdersInDateRange(startDate: Date, endDate: Date) {
    return await new Query()
        .with(OrderTag)
        .with(
            OrderInfoComponent,
            Query.filters(
                Query.filter("createdAt", Query.filterOp.GTE, startDate),
                Query.filter("createdAt", Query.filterOp.LTE, endDate)
            )
        )
        .sortBy(OrderInfoComponent, "createdAt", "DESC")
        .exec();
}
```

### Search Query with Optional Filters

```typescript
interface SearchFilters {
    name?: string;
    email?: string;
    status?: string;
    minPrice?: number;
    maxPrice?: number;
}

async function searchProducts(filters: SearchFilters) {
    let query = new Query().with(ProductTag);

    if (filters.name) {
        query = query.with(
            ProductNameComponent,
            Query.filters(
                Query.filter("value", Query.filterOp.LIKE, `%${filters.name}%`)
            )
        );
    }

    if (filters.status) {
        query = query.with(
            ProductStatusComponent,
            Query.filters(
                Query.filter("value", Query.filterOp.EQ, filters.status)
            )
        );
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
        const priceFilters = [];
        if (filters.minPrice !== undefined) {
            priceFilters.push(
                Query.filter("amount", Query.filterOp.GTE, filters.minPrice)
            );
        }
        if (filters.maxPrice !== undefined) {
            priceFilters.push(
                Query.filter("amount", Query.filterOp.LTE, filters.maxPrice)
            );
        }
        query = query.with(PriceComponent, Query.filters(...priceFilters));
    }

    return await query.take(100).exec();
}
```

## Archetype Patterns

### Basic Archetype Definition

```typescript
import {
    ArcheType,
    ArcheTypeField,
    BaseArcheType,
    type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(EmailComponent)
    email!: EmailComponent;

    @ArcheTypeField(ProfileComponent, { nullable: true })
    profile!: ProfileComponent;
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
export const UserArcheType = new UserArcheTypeClass();
```

### Archetype with Computed Fields

```typescript
import { ArcheTypeFunction } from "bunsane/core/ArcheType";
import { Entity } from "bunsane/core/Entity";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(ProfileComponent, { nullable: true })
    profile!: ProfileComponent;

    @ArcheTypeFunction({ returnType: "String" })
    async displayName(entity: Entity) {
        const name = await entity.get(NameComponent);
        const profile = await entity.get(ProfileComponent);

        if (profile?.nickname) {
            return profile.nickname;
        }
        return name?.value || "Anonymous";
    }

    @ArcheTypeFunction({ returnType: "Boolean" })
    async isComplete(entity: Entity) {
        const name = await entity.get(NameComponent);
        const email = await entity.get(EmailComponent);
        const profile = await entity.get(ProfileComponent);

        return !!(name?.value && email?.value && profile?.bio);
    }
}
```

### Archetype with Relations

```typescript
import { HasOne, HasMany, BelongsTo } from "bunsane/core/ArcheType";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @HasOne("Driver", { foreignKey: "user_id", nullable: true })
    driver?: IDriverArcheType;

    @HasMany("Order", { foreignKey: "user_id", nullable: true })
    orders!: IOrderArcheType[];
}

@ArcheType("Order")
export class OrderArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(OrderInfoComponent)
    info!: OrderInfoComponent;

    @BelongsTo("User", { foreignKey: "info.user_id" })
    user!: IUserArcheType;
}
```

## Validation Patterns

### GraphQL Input Schema

> **Important:** The GraphQL schema generator can only infer **simple Zod types**. Complex validation chains (`.min()`, `.max()`, `.email()`, `.regex()`, `.transform()`) are NOT supported.

**Correct approach:** Use simple scalar types in the input schema, then validate manually inside the resolver.

```typescript
// ✅ CORRECT: Simple scalars in input schema
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        name: z.string(),
        email: z.string(),
        phone: z.string().optional(),
    }),
    output: UserArcheType,
})
async createUser(args: { name: string; email: string; phone?: string }, context: GraphQLContext) {
    // Validate inside resolver
    if (args.name.length < 2 || args.name.length > 100) {
        return new GraphQLError("Name must be between 2-100 characters", {
            extensions: { code: "BAD_USER_INPUT" }
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
        return new GraphQLError("Invalid email format", {
            extensions: { code: "BAD_USER_INPUT" }
        });
    }

    // Proceed with validated data
    const user = Entity.Create()
        .add(UserTag, {})
        .add(NameComponent, { value: args.name })
        .add(EmailComponent, { value: args.email });
    await user.save();
    return user;
}

// ❌ WRONG: Complex validation in input schema (won't be inferred)
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        name: z.string().min(2).max(100),  // ❌ Not supported
        email: z.string().email(),          // ❌ Not supported
    }),
    output: UserArcheType,
})
```

### Using ArcheType for Complex Inputs

For complex inputs based on archetypes, use `getInputSchema()` or `withValidation()`:

```typescript
// ✅ CORRECT: ArcheType handles schema generation properly
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.getInputSchema(),
    output: UserArcheType,
})
async createUser(args: IUserArcheType, context: GraphQLContext) {
    const user = UserArcheType.fill(args).createEntity();
    await user.save();
    return user;
}

// ✅ CORRECT: ArcheType with custom field validation
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.withValidation({
        "info.role": z.enum([...Object.keys(UserRole)] as [string, ...string[]]),
    }),
    output: UserArcheType,
})
```

### Enum Definition and Usage

Define enums using the `@Enum()` decorator:

```typescript
import { Enum } from "bunsane/core/metadata";

@Enum()
export class OrderStatus {
    static PENDING = "pending";
    static PROCESSING = "processing";
    static SHIPPED = "shipped";
    static DELIVERED = "delivered";
    static CANCELLED = "cancelled";
}
```

Use enums in Zod validation with `Object.keys()`:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        orderId: z.string(),
        status: z.enum([...Object.keys(OrderStatus)] as [string, ...string[]]),
    }),
    output: OrderArcheType,
})
async updateOrderStatus(args: { orderId: string; status: string }, context: GraphQLContext) {
    // args.status will be one of: "PENDING", "PROCESSING", "SHIPPED", etc.
}
```

### ArcheType with Custom Field Validation

Use `ArcheType.withValidation()` to add custom validators to archetype fields:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: OrderArcheType.withValidation({
        "info.status": z.enum([...Object.keys(OrderStatus)] as [string, ...string[]]),
        "info.quantity": z.number().min(1, "Quantity must be at least 1"),
    }),
    output: OrderArcheType,
})
async createOrder(args: IOrderArcheType, context: GraphQLContext) {
    const order = OrderArcheType.fill(args).createEntity();
    await order.save();
    return order;
}
```

## Soft Delete Pattern

### Components

```typescript
@Component
export class SoftDeletedTag extends BaseComponent {}

@Component
export class DeletedAtComponent extends BaseComponent {
    @CompData({ indexed: true })
    value: Date = new Date();

    @CompData()
    deletedBy: string = "";
}
```

### Soft Delete Operation

```typescript
async function softDelete(entityId: string, deletedBy: string) {
    const entity = await Entity.FindById(entityId);
    if (!entity) throw new Error("Entity not found");

    entity.add(SoftDeletedTag, {});
    entity.add(DeletedAtComponent, {
        value: new Date(),
        deletedBy,
    });

    await entity.save();
}
```

### Query Excluding Soft Deleted

```typescript
async function listActiveUsers() {
    return await new Query()
        .with(UserTag)
        .without(SoftDeletedTag)  // Exclude soft deleted
        .exec();
}
```

### Restore Soft Deleted

```typescript
async function restore(entityId: string) {
    const entity = await Entity.FindById(entityId);
    if (!entity) throw new Error("Entity not found");

    // Remove soft delete markers
    await entity.remove(SoftDeletedTag);
    await entity.remove(DeletedAtComponent);

    await entity.save();
}
```

## Logging Pattern

```typescript
import { logger as MainLogger } from "bunsane/core/Logger";

class OrderService extends BaseService {
    private logger = MainLogger.child({ service: "OrderService" });

    @GraphQLOperation({
        type: "Mutation",
        input: CreateOrderInput,
        output: OrderArcheType,
    })
    async createOrder(args: any, context: GraphQLContext) {
        const userId = context.jwt?.payload?.user_id;

        this.logger.info({
            msg: "Creating order",
            userId,
            itemCount: args.items?.length,
        });

        try {
            const order = Entity.Create()
                .add(OrderTag, {})
                .add(OrderInfoComponent, args);

            await order.save();

            this.logger.info({
                msg: "Order created",
                orderId: order.id,
                userId,
            });

            return order;
        } catch (error) {
            this.logger.error({
                msg: "Failed to create order",
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
        }
    }
}
```

## Batch Processing Pattern

```typescript
async function processBatch<T>(
    items: T[],
    batchSize: number,
    processor: (batch: T[]) => Promise<void>
) {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await processor(batch);
    }
}

// Usage
const allOrders = await new Query().with(PendingOrderTag).exec();

await processBatch(allOrders, 100, async (batch) => {
    await db.transaction(async (trx) => {
        for (const order of batch) {
            await processOrder(order, trx);
        }
    });
});
```

## Rate Limiting Pattern

```typescript
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = rateLimits.get(key);

    if (!entry || entry.resetAt < now) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    if (entry.count >= limit) {
        return false;
    }

    entry.count++;
    return true;
}

// Usage in service
@GraphQLOperation({
    type: "Mutation",
    input: z.object({ email: z.string().email() }),
    output: "Boolean",
})
async sendVerificationEmail(args: { email: string }, context: GraphQLContext) {
    const rateLimitKey = `email:${args.email}`;

    if (!checkRateLimit(rateLimitKey, 3, 60000)) {  // 3 per minute
        return new GraphQLError("Rate limit exceeded", {
            extensions: { code: "RATE_LIMITED" }
        });
    }

    // Send email
    return true;
}
```
