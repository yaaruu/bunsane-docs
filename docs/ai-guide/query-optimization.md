---
sidebar_position: 3
sidebar_label: Query Optimization
---

# Query Optimization

This guide covers efficient data retrieval patterns in BunSane. Proper query design is critical for application performance.

## Query Basics

```typescript
import { Query } from "bunsane/query";

// Basic query - find all entities with a component
const users = await new Query()
    .with(UserTag)
    .exec();
```

## Query Building Patterns

### Pattern 1: Multiple Component Requirements

Specify all required components to narrow results.

```typescript
// Find entities that have ALL specified components
const verifiedUsers = await new Query()
    .with(UserTag)
    .with(EmailComponent)
    .with(VerifiedTag)
    .exec();
```

### Pattern 2: Filtering by Field Values

Use `Query.filters()` and `Query.filter()` for field-level conditions.

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

### Pattern 3: Multiple Filters on Same Component

```typescript
const products = await new Query()
    .with(
        ProductInventoryComponent,
        Query.filters(
            Query.filter("quantity", Query.filterOp.GT, 0),
            Query.filter("sku", Query.filterOp.LIKE, "PROD-%")
        )
    )
    .exec();
```

### Pattern 4: Exclusion Queries

Use `.without()` to exclude entities with certain components.

```typescript
// Active users (not deleted)
const activeUsers = await new Query()
    .with(UserTag)
    .without(SoftDeletedTag)
    .exec();
```

## Filter Operators Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `EQ` | Equals | `Query.filter("status", Query.filterOp.EQ, "active")` |
| `NEQ` | Not equals | `Query.filter("status", Query.filterOp.NEQ, "deleted")` |
| `GT` | Greater than | `Query.filter("price", Query.filterOp.GT, 100)` |
| `GTE` | Greater than or equal | `Query.filter("quantity", Query.filterOp.GTE, 1)` |
| `LT` | Less than | `Query.filter("age", Query.filterOp.LT, 18)` |
| `LTE` | Less than or equal | `Query.filter("price", Query.filterOp.LTE, 50)` |
| `LIKE` | Pattern matching | `Query.filter("name", Query.filterOp.LIKE, "John%")` |
| `IN` | Value in array | `Query.filter("status", Query.filterOp.IN, ["active", "pending"])` |
| `NOT_IN` | Value not in array | `Query.filter("status", Query.filterOp.NOT_IN, ["deleted"])` |

## Pagination and Sorting

### Basic Pagination

```typescript
const pageSize = 20;
const pageNumber = 1;

const users = await new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(pageSize)
    .offset(pageNumber * pageSize)
    .exec();
```

### Counting Results

```typescript
// Get total count for pagination UI
const totalCount = await new Query()
    .with(UserTag)
    .count();

// Calculate total pages
const totalPages = Math.ceil(totalCount / pageSize);
```

## Optimization Strategies

### Strategy 1: Index Frequently Filtered Fields

Ensure fields used in filters have `{ indexed: true }`.

```typescript
@Component
export class EmailComponent extends BaseComponent {
    @CompData({ indexed: true })  // Index for EQ lookups
    value: string = "";

    @CompData()  // No index needed - rarely filtered
    verified: boolean = false;
}
```

### Strategy 2: Use Tags Instead of Boolean Filters

Tags are more efficient than filtering by boolean fields.

```typescript
// SLOWER - Boolean filter
const verifiedUsers = await new Query()
    .with(UserTag)
    .with(
        EmailComponent,
        Query.filters(
            Query.filter("verified", Query.filterOp.EQ, true)
        )
    )
    .exec();

// FASTER - Tag-based query
const verifiedUsers = await new Query()
    .with(UserTag)
    .with(EmailVerifiedTag)  // Tag added when verified
    .exec();
```

### Strategy 3: Limit Result Sets

Always use `.take()` for potentially large result sets.

```typescript
// BAD - Could return thousands of rows
const allOrders = await new Query()
    .with(OrderTag)
    .exec();

// GOOD - Paginated
const orders = await new Query()
    .with(OrderTag)
    .with(OrderInfoComponent)
    .sortBy(OrderInfoComponent, "createdAt", "DESC")
    .take(100)
    .exec();
```

### Strategy 4: Use Count Before Large Operations

Check count before executing potentially expensive operations.

```typescript
const pendingCount = await new Query()
    .with(OrderTag)
    .with(
        OrderStatusComponent,
        Query.filters(Query.filter("value", Query.filterOp.EQ, "pending"))
    )
    .count();

if (pendingCount > 1000) {
    // Process in batches
    await processInBatches();
} else {
    // Process all at once
    const orders = await query.exec();
}
```

### Strategy 5: Narrow Queries with Multiple Components

Adding more `.with()` clauses narrows results more efficiently than adding filters.

```typescript
// Less efficient - Filter after broad query
const adminUsers = await new Query()
    .with(UserTag)
    .with(
        RoleComponent,
        Query.filters(Query.filter("value", Query.filterOp.EQ, "admin"))
    )
    .exec();

// More efficient - Use tag for role
const adminUsers = await new Query()
    .with(UserTag)
    .with(AdminTag)  // Entities are indexed by component presence
    .exec();
```

## Common Query Patterns

### Find by Unique Field

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

### Find by ID with Validation

```typescript
async function findUserById(id: string): Promise<Entity> {
    const user = await Entity.FindById(id);
    if (!user) {
        throw new GraphQLError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }

    // Optionally verify it's actually a user
    const hasUserTag = await user.get(UserTag);
    if (!hasUserTag) {
        throw new GraphQLError("Entity is not a user", {
            extensions: { code: "INVALID_TYPE" }
        });
    }

    return user;
}
```

### Paginated List Query

```typescript
interface PaginationArgs {
    page?: number;
    pageSize?: number;
    sortOrder?: "ASC" | "DESC";
}

async function listUsers(args: PaginationArgs) {
    const page = args.page || 0;
    const pageSize = Math.min(args.pageSize || 20, 100); // Max 100
    const sortOrder = args.sortOrder || "DESC";

    const [items, totalCount] = await Promise.all([
        new Query()
            .with(UserTag)
            .with(ProfileComponent)
            .sortBy(ProfileComponent, "createdAt", sortOrder)
            .take(pageSize)
            .offset(page * pageSize)
            .exec(),
        new Query()
            .with(UserTag)
            .count()
    ]);

    return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
    };
}
```

### Search with Multiple Criteria

```typescript
interface UserSearchCriteria {
    email?: string;
    name?: string;
    verified?: boolean;
}

async function searchUsers(criteria: UserSearchCriteria) {
    let query = new Query().with(UserTag);

    if (criteria.email) {
        query = query.with(
            EmailComponent,
            Query.filters(
                Query.filter("value", Query.filterOp.LIKE, `%${criteria.email}%`)
            )
        );
    }

    if (criteria.name) {
        query = query.with(
            NameComponent,
            Query.filters(
                Query.filter("value", Query.filterOp.LIKE, `%${criteria.name}%`)
            )
        );
    }

    if (criteria.verified === true) {
        query = query.with(EmailVerifiedTag);
    } else if (criteria.verified === false) {
        query = query.without(EmailVerifiedTag);
    }

    return await query.take(100).exec();
}
```

## Transactions in Queries

When reading entities that will be modified, use transactions.

```typescript
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
    // Read within transaction
    const user = await Entity.FindById(userId, trx);
    if (!user) throw new Error("User not found");

    const balance = await user.get(BalanceComponent, { trx });

    // Modify
    await user.set(BalanceComponent, {
        amount: balance.amount - 100
    }, { trx });

    await user.save(trx);

    return user;
});
```

## Performance Monitoring Tips

1. **Log slow queries**: Add timing to track query performance
2. **Use EXPLAIN**: For complex queries, analyze with PostgreSQL's EXPLAIN
3. **Monitor result counts**: Track how many entities queries typically return
4. **Index appropriately**: Add indexes based on actual query patterns

```typescript
// Example timing wrapper
async function timedQuery<T>(name: string, queryFn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await queryFn();
    const duration = performance.now() - start;

    if (duration > 100) {
        console.warn(`Slow query "${name}": ${duration.toFixed(2)}ms`);
    }

    return result;
}

// Usage
const users = await timedQuery("listActiveUsers", () =>
    new Query()
        .with(UserTag)
        .without(SoftDeletedTag)
        .take(100)
        .exec()
);
```

## Advanced Query Methods

The Query class includes additional methods for specialized use cases:

### Aggregate Functions

```typescript
// Sum a numeric field
const totalRevenue = await new Query()
    .with(OrderTag)
    .with(OrderAmountComponent)
    .sum(OrderAmountComponent, "amount");

// Average a numeric field
const avgOrderValue = await new Query()
    .with(OrderTag)
    .with(OrderAmountComponent)
    .average(OrderAmountComponent, "amount");
```

### Cursor-Based Pagination

More efficient than offset-based pagination for large datasets:

```typescript
// First page
const firstPage = await new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(20)
    .exec();

// Next page using cursor (last entity's ID)
const lastId = firstPage[firstPage.length - 1]?.id;
const nextPage = await new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .cursor(lastId, "after")
    .take(20)
    .exec();
```

### Eager Loading (Prevent N+1 Queries)

```typescript
// Preload components to avoid separate queries per entity
const users = await new Query()
    .with(UserTag)
    .eagerLoadComponents([ProfileComponent, EmailComponent])
    .take(100)
    .exec();

// Components are now cached on each entity
for (const user of users) {
    const profile = await user.get(ProfileComponent); // No additional query
}
```

### Estimated Count (Fast Approximate)

For very large tables where exact count is slow:

```typescript
// Uses PostgreSQL table statistics - much faster than count()
const approxCount = await new Query()
    .with(UserTag)
    .estimatedCount(UserTag);
```

### Query Debugging

```typescript
// Enable debug logging for a query
const users = await new Query()
    .with(UserTag)
    .debugMode(true)
    .exec();

// Get PostgreSQL EXPLAIN ANALYZE output
const plan = await new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .explainAnalyze();
console.log(plan);
```

## Summary

| Do | Don't |
|----|-------|
| Use `.take()` for pagination | Return unlimited results |
| Index fields used in filters | Index every field |
| Use tags for boolean states | Filter by boolean fields |
| Add multiple `.with()` clauses | Use complex filter logic |
| Use transactions for read-modify-write | Read and write separately |
| Check `.count()` before large ops | Process unknown-size results |
| Use `cursor()` for large datasets | Use large `offset()` values |
| Use `eagerLoadComponents()` for batch reads | Query components in loops |
