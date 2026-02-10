---
sidebar_position: 3
sidebar_label: Service
---

# Service

Services contain your application's business logic and expose it through GraphQL and REST APIs.

## Creating a Service

Extend `BaseService` and inject the `App` instance:

```typescript
import { BaseService } from "bunsane/service";
import App from "bunsane/core/App";

class UserService extends BaseService {
    constructor(private app: App) {
        super();
    }
}

export default UserService;
```

## Registering Services

Register services with `ServiceRegistry` in your App class:

```typescript
import { ServiceRegistry } from "bunsane/service";
import UserService from "./services/UserService";
import OrderService from "./services/OrderService";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        ServiceRegistry.registerService(new UserService(this));
        ServiceRegistry.registerService(new OrderService(this));
    }
}
```

## GraphQL Operations

Use the `@GraphQLOperation` decorator to create GraphQL queries and mutations:

```typescript
import { GraphQLOperation } from "bunsane/gql";
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";

class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }

    @GraphQLOperation({
        type: "Query",
        output: UserArcheType,
    })
    async profile(args: {}, context: GraphQLContext, info?: GraphQLInfo) {
        const userId = context.jwt.payload.user_id;
        const user = await Entity.FindById(userId);
        if (!user) {
            return new GraphQLError("User not found", {
                extensions: { code: "NOT_FOUND" }
            });
        }
        return user;
    }
}
```

### Operation Options

The `@GraphQLOperation` decorator accepts:

- `type`: "Query" or "Mutation"
- `input`: Zod schema or archetype input schema
- `output`: Archetype instance

### Using Zod for Input Validation

```typescript
import { z } from "zod";

@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
    }),
    output: UserArcheType,
})
async updatePosition(
    args: { latitude: number; longitude: number },
    context: GraphQLContext
) {
    const userId = context.jwt.payload.user_id;
    const user = await Entity.FindById(userId);
    if (!user) {
        return responseError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }

    await user.set(UserPositionComponent, {
        center: { latitude: args.latitude, longitude: args.longitude },
    });
    await user.save();
    return user;
}
```

### Using Archetype Schema for Input

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.getInputSchema().partial().pick({
        name: true,
        domisili: true,
    }),
    output: UserArcheType,
})
async updateProfile(args: any, context: GraphQLContext) {
    const userId = context.jwt.payload.user_id;
    const user = await Entity.FindById(userId);
    if (!user) {
        return new GraphQLError("User not found", {
            extensions: { code: "NOT_FOUND" }
        });
    }

    const updated = await UserArcheType.updateEntity(user, args);
    await updated.save();
    return updated;
}
```

### Enum Types in GraphQL

Register enum types using `asEnumType`:

```typescript
import { asEnumType } from "bunsane/core/ArcheType";

@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        payment_method: z.enum(["cash", "credit_card"]).register(asEnumType, {
            name: "PaymentMethod",
        }),
    }),
    output: OrderArcheType,
})
async createOrder(args: { payment_method: "cash" | "credit_card" }, context: GraphQLContext) {
    // ...
}
```

## REST Endpoints

Use HTTP method decorators for REST APIs:

```typescript
import { BaseService, Get, Post, Put, Delete } from "bunsane/service";

class AuthService extends BaseService {
    @Get("/v1/health")
    async healthCheck() {
        return Response.json({ status: "ok" }, { status: 200 });
    }

    @Post("/v1/auth/register")
    async registerUser(req: Request) {
        const body = await req.json();
        // Validate and process
        return Response.json(
            { message: "User registered", data: { id: user.id } },
            { status: 201 }
        );
    }

    @Put("/v1/users/:id")
    async updateUser(req: Request) {
        // ...
    }

    @Delete("/v1/users/:id")
    async deleteUser(req: Request) {
        // ...
    }
}
```

## OpenAPI Documentation

Add OpenAPI documentation to REST endpoints:

```typescript
import { ApiDocs, ApiTags } from "bunsane/swagger";
import { z } from "zod";

const RegisterSchema = z.object({
    email: z.email().optional(),
    name: z.string().min(3).max(100),
    password: z.string().min(8).max(100),
    phone: z.string().min(10).max(14),
});

@ApiTags("Authentication")
class AuthService extends BaseService {
    @Post("/v1/auth/register")
    @ApiDocs({
        summary: "Register a new user",
        description: "Register a new user with email, password, name, and phone",
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: z.toJSONSchema(RegisterSchema),
                },
            },
        },
        responses: {
            "201": {
                description: "User registered successfully",
                content: {
                    "application/json": {
                        schema: z.toJSONSchema(z.object({
                            message: z.string(),
                            data: z.object({ id: z.string() }),
                        })),
                    },
                },
            },
            "400": {
                description: "Validation error",
            },
        },
    })
    async registerUser(req: Request) {
        const body = await req.json();
        const parse = RegisterSchema.safeParse(body);
        if (!parse.success) {
            return Response.json(
                { errors: parse.error.issues },
                { status: 400 }
            );
        }
        // Process registration
    }
}
```

## Authentication

Access the JWT payload from the GraphQL context:

```typescript
class UserService extends BaseService {
    @GraphQLOperation({
        type: "Query",
        output: UserArcheType,
    })
    async profile(args: {}, context: GraphQLContext) {
        // Check if user is authenticated
        if (!context.jwt?.payload?.user_id) {
            return responseError("Authentication required", {
                extensions: { code: "UNAUTHENTICATED" }
            });
        }

        const userId = context.jwt.payload.user_id;
        return await Entity.FindById(userId);
    }
}
```

The `context.jwt` object is available when using the JWT plugin (see [JWT Authentication Setup](/docs/examples#jwt-authentication-setup) in Examples).

## Entity Hooks

React to entity lifecycle events:

```typescript
import { ComponentTargetHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent, EntityUpdatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

class OrderService extends BaseService {
    @ComponentTargetHook("entity.created", {
        includeComponents: [OrderTag, OrderInfoComponent],
    })
    async onOrderCreated(event: EntityCreatedEvent) {
        const orderEntity = event.entity;
        const infoComp = await orderEntity.get(OrderInfoComponent);
        if (!infoComp) return;

        // Handle new order creation
        console.log("New order created:", orderEntity.id);
    }

    @ComponentTargetHook("entity.updated", {
        includeComponents: [OrderTag, OrderStatusComponent],
    })
    async onOrderStatusUpdated(event: EntityUpdatedEvent) {
        const orderEntity = event.entity;
        const statusComp = await orderEntity.get(OrderStatusComponent);
        if (!statusComp) return;

        // Publish update to subscribers
        this.app.pubSub.publish(`orderUpdated_${orderEntity.id}`, orderEntity);
    }
}
```

## Subscriptions

Create GraphQL subscriptions using PubSub:

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
```

Publish events from other methods:

```typescript
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

## Error Handling

Return GraphQL errors:

```typescript
import { GraphQLError } from "graphql";
import { responseError } from "bunsane/core/ErrorHandler";

// Using GraphQLError directly
if (!user) {
    return new GraphQLError("User not found", {
        extensions: { code: "NOT_FOUND" }
    });
}

// Using responseError helper
if (!user) {
    return responseError("User not found", {
        extensions: { code: "NOT_FOUND" }
    });
}
```

For REST endpoints, return Response objects:

```typescript
return Response.json(
    { errors: ["Invalid input"] },
    { status: 400 }
);
```
