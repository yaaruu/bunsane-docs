---
sidebar_position: 6
sidebar_label: Quick Reference
---

# Quick Reference

Copy-paste ready code snippets for common BunSane operations.

## Imports by Module

All imports follow the pattern `bunsane/<module>`. Copy the imports you need.

### Entity & Components
```typescript
import { Entity } from "bunsane/core/Entity";
import { BaseComponent, CompData, Component, ComponentRegistry } from "bunsane/core/components";
```

### ArcheType
```typescript
import {
    ArcheType,
    ArcheTypeField,
    ArcheTypeFunction,
    BaseArcheType,
    type ArcheTypeOwnProperties,
    HasOne,
    HasMany,
    BelongsTo,
    asEnumType
} from "bunsane/core/ArcheType";
```

### Query
```typescript
import { Query, or } from "bunsane/query";
```

### Service & REST
```typescript
import { BaseService, ServiceRegistry, Get, Post, Put, Delete, Patch } from "bunsane/service";
```

### GraphQL
```typescript
import { GraphQLOperation, isFieldRequested } from "bunsane/gql";
import { GraphQLSubscription } from "bunsane/gql/Generator";
```

### Application & Database
```typescript
import App from "bunsane/core/App";
import db from "bunsane/database";
```

### Types
```typescript
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";
```

### Utilities
```typescript
import { logger } from "bunsane/core/Logger";
import { responseError } from "bunsane/core/ErrorHandler";
import { BatchLoader } from "bunsane/core/BatchLoader";
```

### Hooks
```typescript
import { ComponentTargetHook, EntityHook, LifecycleHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent, EntityUpdatedEvent, EntityDeletedEvent } from "bunsane/core/events/EntityLifecycleEvents";
```

### Scheduler
```typescript
import { ScheduledTask, ScheduleInterval, registerScheduledTasks } from "bunsane/scheduler";
```

### Swagger
```typescript
import { ApiDocs, ApiTags } from "bunsane/swagger";
```

### Upload
```typescript
import { UploadManager, Upload, UploadField, UploadComponent } from "bunsane/upload";
```

### Plugins
```typescript
import BasePlugin from "bunsane/plugins";
```

### Enums
```typescript
import { Enum } from "bunsane/core/metadata";
```

### External (always needed)
```typescript
import { z } from "zod";
import { GraphQLError } from "graphql";
```

## Component Definition

```typescript
// Data component
@Component
export class NameComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

// Component with indexed field
@Component
export class EmailComponent extends BaseComponent {
    @CompData({ indexed: true })
    value: string = "";

    @CompData()
    verified: boolean = false;
}

// Tag (empty component for categorization)
@Component
export class UserTag extends BaseComponent {}
```

## Entity Operations

```typescript
// Create
const entity = Entity.Create()
    .add(UserTag, {})
    .add(NameComponent, { value: "John" });
await entity.save();

// Find by ID
const entity = await Entity.FindById(id);

// Get component
const name = await entity.get(NameComponent);

// Set component
await entity.set(NameComponent, { value: "Jane" });
await entity.save();

// Add component
entity.add(PremiumTag, {});
await entity.save();

// Remove component
await entity.remove(PremiumTag);
await entity.save();

// Delete entity
await entity.delete();
```

## Query Operations

```typescript
// Basic query
const users = await new Query()
    .with(UserTag)
    .exec();

// With filter
const users = await new Query()
    .with(
        EmailComponent,
        Query.filters(
            Query.filter("value", Query.filterOp.EQ, "john@example.com")
        )
    )
    .exec();

// Multiple filters
const products = await new Query()
    .with(
        PriceComponent,
        Query.filters(
            Query.filter("amount", Query.filterOp.GTE, 10),
            Query.filter("amount", Query.filterOp.LTE, 100)
        )
    )
    .exec();

// Exclude
const active = await new Query()
    .with(UserTag)
    .without(DeletedTag)
    .exec();

// Pagination
const users = await new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .take(20)
    .offset(40)
    .exec();

// Count
const count = await new Query()
    .with(UserTag)
    .count();
```

## Filter Operators

```typescript
Query.filterOp.EQ       // equals
Query.filterOp.NEQ      // not equals
Query.filterOp.GT       // greater than
Query.filterOp.GTE      // greater than or equal
Query.filterOp.LT       // less than
Query.filterOp.LTE      // less than or equal
Query.filterOp.LIKE     // pattern match (use % wildcard)
Query.filterOp.IN       // value in array
Query.filterOp.NOT_IN   // value not in array
```

## Archetype Definition

```typescript
@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(EmailComponent, { nullable: true })
    email!: EmailComponent;

    @ArcheTypeFunction({ returnType: "String" })
    async displayName(entity: Entity) {
        const name = await entity.get(NameComponent);
        return name?.value || "";
    }
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
export const UserArcheType = new UserArcheTypeClass();

// Use getInputSchema() for GraphQL mutation inputs
// Returns a Zod schema excluding relations and functions
const inputSchema = UserArcheType.getInputSchema();
```

## GraphQL Output Types

For `@GraphQLOperation` output, use:
- **ArcheType instance**: `output: UserArcheType` - returns the archetype GraphQL type
- **Array of ArcheType**: `output: [UserArcheType]` - returns a list
- **Scalar string**: `output: "Boolean"`, `output: "String"`, `output: "Int"`, `output: "Float"` - for primitive returns

For `@ArcheTypeFunction` returnType, use scalar strings:
- `returnType: "Boolean"` (NOT `z.boolean()`)
- `returnType: "String"` (NOT `z.string()`)
- `returnType: "Int"` (NOT `z.number()`)
- `returnType: "Float"`

## Service Definition

```typescript
class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }

    // Query
    @GraphQLOperation({
        type: "Query",
        output: UserArcheType,
    })
    async getUser(args: { id: string }, context: GraphQLContext) {
        return await Entity.FindById(args.id);
    }

    // Mutation with ArcheType input schema (recommended for archetype-based inputs)
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

    // Mutation with custom Zod schema (for custom inputs)
    @GraphQLOperation({
        type: "Mutation",
        input: z.object({
            userId: z.string(),
            points: z.number(),
        }),
        output: UserArcheType,
    })
    async addPoints(args: { userId: string; points: number }, context: GraphQLContext) {
        const user = await Entity.FindById(args.userId);
        // ... update logic
        return user;
    }

    // REST endpoint
    @Get("/v1/users/:id")
    async getUserRest(req: Request) {
        return Response.json({ data: {} });
    }
}

export default UserService;
```

## Transaction

```typescript
import db from "bunsane/database";

const result = await db.transaction(async (trx) => {
    const entity = await Entity.FindById(id, trx);
    await entity.set(Component, data, { trx });
    await entity.save(trx);
    return entity;
});
```

## Error Handling

```typescript
// GraphQL error
return new GraphQLError("Not found", {
    extensions: { code: "NOT_FOUND" }
});

// Using helper
return responseError("Not found", {
    extensions: { code: "NOT_FOUND" }
});

// Common error codes
"NOT_FOUND"          // 404
"UNAUTHENTICATED"    // 401
"FORBIDDEN"          // 403
"BAD_USER_INPUT"     // 400
"INTERNAL_ERROR"     // 500
```

## Authentication Check

> **Note:** The `jwt` property must be added to `GraphQLContext` by your application middleware. It is not built-in.

```typescript
// In GraphQL operation (jwt must be added by middleware)
async profile(args: {}, context: GraphQLContext) {
    if (!context.jwt?.payload?.user_id) {
        return new GraphQLError("Authentication required", {
            extensions: { code: "UNAUTHENTICATED" }
        });
    }
    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```

## Entity Hooks

```typescript
@ComponentTargetHook("entity.created", {
    includeComponents: [OrderTag, OrderInfoComponent],
})
async onOrderCreated(event: EntityCreatedEvent) {
    const entity = event.entity;
    // Handle creation
}

@ComponentTargetHook("entity.updated", {
    includeComponents: [OrderTag, OrderStatusComponent],
})
async onOrderUpdated(event: EntityUpdatedEvent) {
    const entity = event.entity;
    // Handle update
}
```

## Subscriptions

```typescript
// Define subscription
@GraphQLSubscription({
    output: OrderArcheType,
})
async orderUpdated(args: { orderId: string }, context: GraphQLContext) {
    return this.app.pubSub.subscribe(`order.${args.orderId}`);
}

// Publish event
this.app.pubSub.publish(`order.${orderId}`, entity);
```

## Enum Definition

Define enums using the `@Enum()` decorator for GraphQL schema generation:

```typescript
import { Enum } from "bunsane/core/metadata";

@Enum()
export class OrderStatus {
    static PENDING = "pending";
    static PROCESSING = "processing";
    static COMPLETED = "completed";
    static CANCELLED = "cancelled";
}

@Enum()
export class UserRole {
    static ADMIN = "admin";
    static USER = "user";
    static DRIVER = "driver";
}
```

### Using Enums in Zod Validation

Use `Object.keys()` to convert enum class to Zod enum:

```typescript
// In GraphQL operation input
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        status: z.enum([...Object.keys(OrderStatus)] as [string, ...string[]]),
        role: z.enum([...Object.keys(UserRole)] as [string, ...string[]]),
    }),
    output: OrderArcheType,
})
async updateOrder(args: { status: string; role: string }) {
    // args.status will be one of: "PENDING", "PROCESSING", etc.
}
```

### ArcheType with Custom Validation

Use `ArcheType.withValidation()` for input schemas with custom field validation:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.withValidation({
        // Validate nested fields using dot notation
        "info.role": z.enum([...Object.keys(UserRole)] as [string, ...string[]]),
        "info.email": z.string().email("Invalid email format"),
        "profile.phone": z.string().min(10, "Phone must be at least 10 characters"),
    }),
    output: UserArcheType,
})
async createUser(args: IUserArcheType) {
    // Input is validated against both archetype schema and custom validators
}
```

## Zod Schemas (For GraphQL Input)

> **Important:** The schema generator can only infer **simple Zod types**. Complex validation chains (`.min()`, `.max()`, `.email()`) are NOT supported for GraphQL schema generation.

### Supported Types for GraphQL Input

```typescript
// ✅ These work with GraphQL schema generator
z.string()              // → GraphQL String
z.number()              // → GraphQL Int/Float
z.boolean()             // → GraphQL Boolean
z.string().optional()   // → Nullable String
z.enum([...])           // → GraphQL Enum

// ✅ Simple object with scalars
z.object({
    id: z.string(),
    active: z.boolean(),
    count: z.number(),
})
```

### NOT Supported for GraphQL Input

```typescript
// ❌ These will NOT be inferred correctly
z.string().min(2).max(100)    // Complex validation
z.string().email()             // Format validation
z.string().uuid()              // Format validation
z.string().regex(/pattern/)    // Regex validation
z.number().min(0).max(100)     // Range validation
z.string().transform(...)      // Transforms
z.array(z.object({...}))       // Nested complex objects
```

### Input Schema Best Practices

```typescript
// ✅ CORRECT: Use ArcheType methods for complex inputs
input: UserArcheType.getInputSchema()
input: UserArcheType.withValidation({ "field": z.enum([...]) })

// ✅ CORRECT: Simple scalars for non-ArcheType inputs
input: z.object({
    order_id: z.string(),
    accept: z.boolean(),
})

// Then validate manually in resolver:
if (args.email.length < 2) {
    return new GraphQLError("Invalid input", { extensions: { code: "BAD_USER_INPUT" } });
}
```

## Minimal App Setup

A minimal BunSane application requires three files: `index.ts` (entry point), `src/App.ts` (application class), and at least one service.

### 1. Entry Point (`index.ts`)

```typescript
import MyAPI from '~/App';

const app = new MyAPI();
try {
    app.init();
} catch (error) {
    console.log('Process terminated with error');
    console.error(error);
    process.exit(1);
}
```

### 2. Application Class (`src/App.ts`)

```typescript
import 'reflect-metadata';
import App from 'bunsane/core/App';
import { ServiceRegistry } from 'bunsane/service';

// Import all component files to ensure decorators are executed during app initialization
import '~/components/UserComponent';

// Import services
import UserService from '~/services/UserService';

export default class MyAPI extends App {
    constructor() {
        super('MyAPI', '1.0.0');

        // Optional: Enable Bunsane Studio in development
        if (process.env.NODE_ENV === 'development') {
            this.enableStudio();
        }

        // Register services
        ServiceRegistry.registerService(new UserService(this));
    }
}
```

### 3. Sample Service (`src/services/UserService.ts`)

```typescript
import { BaseService } from 'bunsane/service';
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import App from 'bunsane/core/App';
import { z } from 'zod';
import { UserTag, NameComponent } from '~/components/UserComponent';
import { UserArcheType } from '~/archetypes/UserArcheType';

class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }

    @GraphQLOperation({
        type: 'Query',
        output: UserArcheType,
    })
    async getUser(args: { id: string }) {
        return await Entity.FindById(args.id);
    }

    @GraphQLOperation({
        type: 'Mutation',
        input: z.object({ name: z.string().min(2) }),
        output: UserArcheType,
    })
    async createUser(args: { name: string }) {
        const user = Entity.Create()
            .add(UserTag, {})
            .add(NameComponent, { value: args.name });
        await user.save();
        return user;
    }
}

export default UserService;
```

### Key Points

1. **`reflect-metadata` import** - Must be at the top of `App.ts` for decorators to work
2. **Component imports** - Import all component files in `App.ts` to trigger decorator registration
3. **Path alias** - Use `~/` (configured in tsconfig.json) to reference `src/` directory
4. **Service registration** - Register all services in the constructor using `ServiceRegistry.registerService()`
5. **Field resolvers** - Call `ArcheType.registerFieldResolvers(this)` in service constructor for computed fields

### Optional Configuration

```typescript
export default class MyAPI extends App {
    constructor() {
        super('MyAPI', '1.0.0');

        // Enable/disable scheduler logging
        this.config.scheduler.logging = process.env.LOGGING_SCHEDULER === 'true';

        // Enable OpenAPI/Swagger documentation
        this.enforceSwaggerDocs(true);
        this.addOpenAPIServer('https://api.example.com', 'Production Server');

        // Add static file serving
        this.addStaticAssets('/uploads', './public/uploads');

        // Add custom plugins
        this.addPlugin(new MyCustomPlugin());

        // Add GraphQL Yoga plugins (e.g., JWT authentication)
        this.addYogaPlugin(jwtPlugin);

        // Custom GraphQL context factory
        this.setGraphQLContextFactory((context: any) => {
            return { loaders: createRequestLoaders() };
        });

        // Enable Bunsane Studio (development only)
        if (process.env.NODE_ENV === 'development') {
            this.enableStudio();
        }

        // Register services
        ServiceRegistry.registerService(new UserService(this));
    }
}
```

### Required Dependencies

```json
{
  "dependencies": {
    "bunsane": "latest",
    "reflect-metadata": "^0.2.0",
    "zod": "^3.x"
  }
}
```

### tsconfig.json Path Alias

```json
{
  "compilerOptions": {
    "paths": {
      "~/*": ["./src/*"]
    }
  }
}
```

## File Structure

```
src/
├── components/
│   └── UserComponent.ts
├── archetypes/
│   └── UserArcheType.ts
├── services/
│   └── UserService.ts
├── utilities/
│   └── helpers.ts
└── App.ts
```

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Data Component | `{Name}Component` | `EmailComponent` |
| Tag | `{Name}Tag` | `UserTag`, `DeletedTag` |
| Archetype Class | `{Name}ArcheTypeClass` | `UserArcheTypeClass` |
| Archetype Instance | `{Name}ArcheType` | `UserArcheType` |
| Archetype Type | `I{Name}ArcheType` | `IUserArcheType` |
| Service | `{Domain}Service` | `UserService` |

## Common Gotchas

```typescript
// Always save after modifications
await entity.set(Component, data);
await entity.save();  // Don't forget!

// Pass trx to all operations in transaction
await db.transaction(async (trx) => {
    const e = await Entity.FindById(id, trx);
    await e.set(Comp, data, { trx });
    await e.save(trx);
});

// Register field resolvers in constructor
constructor(private app: App) {
    super();
    MyArcheType.registerFieldResolvers(this);  // Required for computed fields
}

// Import components in App.ts
import "./components/MyComponent";  // Triggers decorators
```
