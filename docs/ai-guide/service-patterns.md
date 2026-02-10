---
sidebar_position: 4
sidebar_label: Service Patterns
---

# Service Patterns

This guide covers service implementation patterns in BunSane, including GraphQL operations, REST endpoints, error handling, and authentication.

## Service Structure

### Basic Service Template

```typescript
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import App from "bunsane/core/App";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";
import { GraphQLError } from "graphql";
import { z } from "zod";

class UserService extends BaseService {
    constructor(private app: App) {
        super();
        // Register field resolvers for archetypes with computed fields
        UserArcheType.registerFieldResolvers(this);
    }

    // Operations go here
}

export default UserService;
```

### Service Registration

```typescript
// In App.ts
import App from "bunsane/core/App";
import { ServiceRegistry } from "bunsane/service";
import UserService from "./services/UserService";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        // Import components to ensure decorators execute
        import "./components/UserComponent";

        // Register services
        ServiceRegistry.registerService(new UserService(this));
    }
}
```

## GraphQL Operations

### Query Operation Pattern

```typescript
@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async getUser(args: { id: string }, context: GraphQLContext) {
    const user = await Entity.FindById(args.id);
    if (!user) {
        return new GraphQLError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }
    return user;
}
```

### List Query with Pagination

```typescript
@GraphQLOperation({
    type: "Query",
    input: z.object({
        page: z.number().min(0).default(0),
        pageSize: z.number().min(1).max(100).default(20),
    }),
    output: [UserArcheType],  // Array output
})
async listUsers(
    args: { page: number; pageSize: number },
    context: GraphQLContext
) {
    return await new Query()
        .with(UserTag)
        .with(ProfileComponent)
        .sortBy(ProfileComponent, "createdAt", "DESC")
        .take(args.pageSize)
        .offset(args.page * args.pageSize)
        .exec();
}
```

### Mutation with ArcheType Input Schema

For mutations that create or update entities based on an archetype, use `ArcheType.getInputSchema()` to automatically generate a Zod schema that excludes relations and functions:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.getInputSchema(),
    output: UserArcheType,
})
async createUser(args: IUserArcheType, context: GraphQLContext) {
    // Check for existing email
    const existing = await new Query()
        .with(
            EmailComponent,
            Query.filters(Query.filter("value", Query.filterOp.EQ, args.email.value))
        )
        .take(1)
        .exec();

    if (existing.length > 0) {
        return new GraphQLError("Email already registered", {
            extensions: { code: "DUPLICATE_EMAIL" }
        });
    }

    // Create entity using archetype
    const user = UserArcheType.fill(args).createEntity();
    await user.save();
    return user;
}
```

### Mutation with ArcheType + Custom Validation

Use `ArcheType.withValidation()` when you need to add custom validation rules to specific archetype fields (e.g., enum validation, format validation):

```typescript
import { Enum } from "bunsane/core/metadata";

// Define enum
@Enum()
export class UserRole {
    static ADMIN = "admin";
    static USER = "user";
    static DRIVER = "driver";
}

// Use in mutation with custom validation
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.withValidation({
        // Validate nested fields using dot notation
        "info.role": z.enum([...Object.keys(UserRole)] as [string, ...string[]]),
        "info.email": z.string().email("Invalid email format"),
        "profile.license_plate": z.string().min(1, "License plate is required"),
    }),
    output: UserArcheType,
})
async registerUser(args: IUserArcheType, context: GraphQLContext) {
    const user = UserArcheType.fill(args).createEntity();
    await user.save();
    return user;
}
```

### Mutation with Simple Scalar Inputs

For mutations with simple scalar inputs (not ArcheType-based), use `z.object()` with **only basic Zod types** that map directly to GraphQL scalars. The schema generator cannot infer complex Zod validation chains.

**Supported Zod types for GraphQL inference:**
- `z.string()` → GraphQL `String`
- `z.number()` → GraphQL `Int` or `Float`
- `z.boolean()` → GraphQL `Boolean`
- `z.enum([...])` → GraphQL `Enum`
- `.optional()` → Nullable field

> **Important:** Do NOT use complex validation like `.min()`, `.max()`, `.email()`, `.regex()` in the input schema. Perform validation manually inside the resolver instead.

```typescript
// ✅ CORRECT - Simple scalar types only
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        order_id: z.string(),
        accept: z.boolean(),
    }),
    output: "Boolean",
})
async acceptOrder(args: { order_id: string; accept: boolean }, context: GraphQLContext) {
    // Perform validation inside the resolver
    if (!args.order_id) {
        return new GraphQLError("Order ID is required", {
            extensions: { code: "BAD_USER_INPUT" }
        });
    }
    // ... implementation
}

// ✅ CORRECT - With enum
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        user_id: z.string(),
        role: z.enum([...Object.keys(UserRole)] as [string, ...string[]]),
    }),
    output: UserArcheType,
})
async updateUserRole(args: { user_id: string; role: string }, context: GraphQLContext) {
    // ... implementation
}

// ❌ WRONG - Complex validation chains won't be inferred
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        name: z.string().min(2).max(100),  // ❌ .min().max() not supported
        email: z.string().email(),          // ❌ .email() not supported
    }),
    output: UserArcheType,
})
```

### Manual Validation Pattern

When you need complex validation, use simple input schema and validate manually:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        name: z.string(),
        email: z.string(),
        phone: z.string().optional(),
    }),
    output: UserArcheType,
})
async createUser(
    args: { name: string; email: string; phone?: string },
    context: GraphQLContext
) {
    // Manual validation inside resolver
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

    // Check for existing email
    const existing = await new Query()
        .with(
            EmailComponent,
            Query.filters(Query.filter("value", Query.filterOp.EQ, args.email))
        )
        .take(1)
        .exec();

    if (existing.length > 0) {
        return new GraphQLError("Email already registered", {
            extensions: { code: "DUPLICATE_EMAIL" }
        });
    }

    // Create entity
    const user = Entity.Create()
        .add(UserTag, {})
        .add(NameComponent, { value: args.name })
        .add(EmailComponent, { value: args.email, verified: false });

    if (args.phone) {
        user.add(PhoneComponent, { value: args.phone, verified: false });
    }

    await user.save();
    return user;
}
```

### Update Mutation Pattern

```typescript
const UpdateUserInput = z.object({
    id: z.string().uuid(),
    name: z.string().min(2).max(100).optional(),
    phone: z.string().min(10).max(15).optional(),
});

@GraphQLOperation({
    type: "Mutation",
    input: UpdateUserInput,
    output: UserArcheType,
})
async updateUser(
    args: z.infer<typeof UpdateUserInput>,
    context: GraphQLContext
) {
    const user = await Entity.FindById(args.id);
    if (!user) {
        return new GraphQLError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }

    if (args.name !== undefined) {
        await user.set(NameComponent, { value: args.name });
    }

    if (args.phone !== undefined) {
        const currentPhone = await user.get(PhoneComponent);
        await user.set(PhoneComponent, {
            ...currentPhone,
            value: args.phone,
        });
    }

    await user.save();
    return user;
}
```

### Delete Mutation Pattern

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: z.object({ id: z.string().uuid() }),
    output: "Boolean",
})
async deleteUser(args: { id: string }, context: GraphQLContext) {
    const user = await Entity.FindById(args.id);
    if (!user) {
        return false;
    }

    await user.delete();
    return true;
}

// Soft delete pattern
@GraphQLOperation({
    type: "Mutation",
    input: z.object({ id: z.string().uuid() }),
    output: UserArcheType,
})
async softDeleteUser(args: { id: string }, context: GraphQLContext) {
    const user = await Entity.FindById(args.id);
    if (!user) {
        return new GraphQLError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }

    user.add(SoftDeletedTag, {});
    await user.set(DeletedAtComponent, { value: new Date() });
    await user.save();

    return user;
}
```

## REST Endpoints

### Basic REST Pattern

```typescript
import { BaseService, Get, Post, Put, Delete } from "bunsane/service";

class ProductService extends BaseService {
    @Get("/v1/products")
    async listProducts(req: Request) {
        const products = await new Query()
            .with(ProductTag)
            .take(100)
            .exec();

        return Response.json({
            data: products.map(p => ({ id: p.id })),
        });
    }

    @Get("/v1/products/:id")
    async getProduct(req: Request) {
        const url = new URL(req.url);
        const id = url.pathname.split("/").pop();

        const product = await Entity.FindById(id!);
        if (!product) {
            return Response.json(
                { error: "Product not found" },
                { status: 404 }
            );
        }

        const info = await product.get(ProductInfoComponent);
        return Response.json({ data: { id: product.id, ...info } });
    }

    @Post("/v1/products")
    async createProduct(req: Request) {
        const body = await req.json();

        // Validate
        const schema = z.object({
            name: z.string(),
            price: z.number().positive(),
        });
        const parse = schema.safeParse(body);

        if (!parse.success) {
            return Response.json(
                { errors: parse.error.issues },
                { status: 400 }
            );
        }

        // Create
        const product = Entity.Create()
            .add(ProductTag, {})
            .add(ProductInfoComponent, parse.data);

        await product.save();

        return Response.json(
            { data: { id: product.id } },
            { status: 201 }
        );
    }
}
```

### REST with OpenAPI Documentation

```typescript
import { ApiDocs, ApiTags } from "bunsane/swagger";

@ApiTags("Products")
class ProductService extends BaseService {
    @Get("/v1/products")
    @ApiDocs({
        summary: "List all products",
        description: "Returns a paginated list of products",
        parameters: [
            {
                name: "page",
                in: "query",
                schema: { type: "integer", default: 0 },
            },
            {
                name: "pageSize",
                in: "query",
                schema: { type: "integer", default: 20 },
            },
        ],
        responses: {
            "200": {
                description: "List of products",
                content: {
                    "application/json": {
                        schema: z.toJSONSchema(z.object({
                            data: z.array(z.object({
                                id: z.string(),
                                name: z.string(),
                                price: z.number(),
                            })),
                            total: z.number(),
                        })),
                    },
                },
            },
        },
    })
    async listProducts(req: Request) {
        // Implementation
    }
}
```

## Authentication Patterns

### JWT Context Access

> **Important:** The `jwt` property is NOT built into `GraphQLContext` by default. Your application must add JWT data to the context via middleware before resolvers execute. The `GraphQLContext` interface is extensible (`[key: string]: any`), allowing you to attach custom properties like `jwt`.

```typescript
// Example middleware that adds JWT to context (in your app setup):
// context.jwt = { payload: { user_id: "...", role: "..." } };

@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async profile(args: {}, context: GraphQLContext) {
    // Check authentication (jwt must be added by your middleware)
    if (!context.jwt?.payload?.user_id) {
        return new GraphQLError("Authentication required", {
            extensions: { code: "UNAUTHENTICATED" }
        });
    }

    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```

### Reusable Auth Decorator

```typescript
// utilities/AuthDecorator.ts
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "bunsane/types/graphql.types";

export function RequireJWT() {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const context: GraphQLContext = args[1];

            if (!context.jwt?.payload?.user_id) {
                throw new GraphQLError("Authentication required", {
                    extensions: { code: "UNAUTHENTICATED" },
                });
            }

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

// Usage in service
@RequireJWT()
@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async profile(args: {}, context: GraphQLContext) {
    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```

### Role-Based Authorization

```typescript
export function RequireRole(...roles: string[]) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const context: GraphQLContext = args[1];

            if (!context.jwt?.payload?.user_id) {
                throw new GraphQLError("Authentication required", {
                    extensions: { code: "UNAUTHENTICATED" },
                });
            }

            const userRole = context.jwt.payload.role;
            if (!roles.includes(userRole)) {
                throw new GraphQLError("Insufficient permissions", {
                    extensions: { code: "FORBIDDEN" },
                });
            }

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

// Usage
@RequireRole("admin")
@GraphQLOperation({
    type: "Mutation",
    input: z.object({ userId: z.string() }),
    output: "Boolean",
})
async banUser(args: { userId: string }, context: GraphQLContext) {
    // Only admins can execute this
}
```

## Error Handling

### GraphQL Errors

```typescript
import { GraphQLError } from "graphql";
import { responseError } from "bunsane/core/ErrorHandler";

// Using GraphQLError directly
if (!entity) {
    return new GraphQLError("Entity not found", {
        extensions: { code: "NOT_FOUND" }
    });
}

// Using responseError helper
if (!entity) {
    return responseError("Entity not found", {
        extensions: { code: "NOT_FOUND" }
    });
}
```

### Standard Error Codes

| Code | HTTP Status | Use Case |
|------|-------------|----------|
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `UNAUTHENTICATED` | 401 | No valid auth token |
| `FORBIDDEN` | 403 | Lacks permission |
| `BAD_USER_INPUT` | 400 | Validation failed |
| `DUPLICATE_ENTRY` | 409 | Unique constraint violation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Comprehensive Error Handling

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: CreateOrderInput,
    output: OrderArcheType,
})
async createOrder(args: any, context: GraphQLContext) {
    try {
        // Auth check
        if (!context.jwt?.payload?.user_id) {
            return new GraphQLError("Authentication required", {
                extensions: { code: "UNAUTHENTICATED" }
            });
        }

        // Validation
        const parse = CreateOrderInput.safeParse(args);
        if (!parse.success) {
            return new GraphQLError("Invalid input", {
                extensions: {
                    code: "BAD_USER_INPUT",
                    validationErrors: parse.error.issues,
                }
            });
        }

        // Business logic
        const order = Entity.Create()
            .add(OrderTag, {})
            .add(OrderInfoComponent, parse.data);

        await order.save();
        return order;

    } catch (error) {
        console.error("Order creation failed:", error);
        return new GraphQLError("Failed to create order", {
            extensions: { code: "INTERNAL_ERROR" }
        });
    }
}
```

## Entity Hooks

### Reacting to Entity Events

```typescript
import { ComponentTargetHook } from "bunsane/core/decorators/EntityHooks";
import type {
    EntityCreatedEvent,
    EntityUpdatedEvent
} from "bunsane/core/events/EntityLifecycleEvents";

class OrderService extends BaseService {
    constructor(private app: App) {
        super();
    }

    @ComponentTargetHook("entity.created", {
        includeComponents: [OrderTag, OrderInfoComponent],
    })
    async onOrderCreated(event: EntityCreatedEvent) {
        const orderEntity = event.entity;
        const infoComp = await orderEntity.get(OrderInfoComponent);

        // Send notification, update stats, etc.
        console.log("New order:", orderEntity.id);
    }

    @ComponentTargetHook("entity.updated", {
        includeComponents: [OrderTag, OrderStatusComponent],
    })
    async onOrderStatusChanged(event: EntityUpdatedEvent) {
        const orderEntity = event.entity;

        // Publish to subscribers
        this.app.pubSub.publish(
            `orderUpdated_${orderEntity.id}`,
            orderEntity
        );
    }
}
```

## Subscriptions

### GraphQL Subscriptions

```typescript
import { GraphQLSubscription } from "bunsane/gql/Generator";

class OrderService extends BaseService {
    @GraphQLSubscription({
        output: OrderArcheType,
    })
    async orderUpdated(args: { orderId: string }, context: GraphQLContext) {
        return this.app.pubSub.subscribe(`orderUpdated_${args.orderId}`);
    }
}

// Publishing from other methods
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

## Service Organization Guidelines

### Single Responsibility

Each service should handle one domain.

```typescript
// Good - Single domain
class UserService extends BaseService { /* user operations */ }
class OrderService extends BaseService { /* order operations */ }
class PaymentService extends BaseService { /* payment operations */ }

// Bad - Mixed domains
class APIService extends BaseService {
    createUser() {}
    createOrder() {}
    processPayment() {}
}
```

### Constructor Pattern

Always register field resolvers in constructor.

```typescript
class UserService extends BaseService {
    constructor(private app: App) {
        super();

        // Register all archetypes used in this service
        UserArcheType.registerFieldResolvers(this);
        UserListResponseArcheType.registerFieldResolvers(this);
    }
}
```

### Method Naming Conventions

| Prefix | Operation Type | Example |
|--------|---------------|---------|
| `get` | Query single | `getUser`, `getOrder` |
| `list` | Query multiple | `listUsers`, `listOrders` |
| `find` | Query with filter | `findByEmail` |
| `create` | Mutation create | `createUser` |
| `update` | Mutation update | `updateUser` |
| `delete` | Mutation delete | `deleteUser` |
| `on` | Hook/event | `onOrderCreated` |

## Summary Checklist

When implementing a service:

- [ ] Extend `BaseService`
- [ ] Inject `App` in constructor
- [ ] Register archetype field resolvers
- [ ] Validate all inputs with Zod
- [ ] Handle authentication appropriately
- [ ] Return proper error codes
- [ ] Use transactions for multi-entity operations
- [ ] Follow naming conventions
- [ ] Keep services focused on single domain
