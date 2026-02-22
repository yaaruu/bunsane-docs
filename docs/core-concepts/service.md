---
sidebar_position: 3
sidebar_label: Services
---

# Services

Services are where your application logic lives. They contain your GraphQL operations, REST endpoints, entity hooks, and subscriptions. This is the single reference for everything related to services in BunSane.

## Creating a Service

Extend `BaseService` and pass the `App` instance:

```typescript
import { BaseService } from "bunsane/service";
import App from "bunsane/core/App";

class UserService extends BaseService {
    constructor(private app: App) {
        super();
        UserArcheType.registerFieldResolvers(this);
    }
}

export default UserService;
```

If your archetype has computed fields or relations, call `registerFieldResolvers()` in the constructor.

## Registering Services

Register services in your App class using `ServiceRegistry`:

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

Make sure to import your component files in the App so their `@Component` decorators run:

```typescript
// Import components to ensure decorators are executed
import "./components/UserComponent";
import "./components/OrderComponent";
```

## GraphQL Operations

Use `@GraphQLOperation` to create GraphQL queries and mutations. This is the decorator-based approach -- you explicitly mark each method and specify whether it is a query or mutation.

### Queries

```typescript
import { GraphQLOperation } from "bunsane/gql";
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";

class UserService extends BaseService {
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

### Mutations

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        title: z.string(),
        description: z.string(),
    }),
    output: TodoArcheType,
})
async createTodo(
    args: { title: string; description: string },
    context: GraphQLContext
) {
    const todo = Entity.Create()
        .add(TodoTag, {})
        .add(TodoInfoComponent, {
            title: args.title,
            description: args.description,
        });
    await todo.save();
    return todo;
}
```

### Operation Options

The `@GraphQLOperation` decorator accepts:

| Option | Type | Description |
|--------|------|-------------|
| `type` | `"Query"` or `"Mutation"` | Whether this is a GraphQL query or mutation |
| `input` | Zod schema or archetype input | Defines the input arguments and generates a GraphQL input type |
| `output` | Archetype instance | Defines the return type and generates a GraphQL output type |

### Returning Lists

Wrap the archetype in an array to return a list:

```typescript
@GraphQLOperation({
    type: "Query",
    output: [TodoArcheType],
})
async listTodos(args: {}, context: GraphQLContext) {
    return await new Query().with(TodoTag).exec();
}
```

## Input Validation with Zod

You can use [Zod](https://zod.dev/) schemas as operation inputs. BunSane converts them to GraphQL input types.

```typescript
import { z } from "zod";

@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        latitude: z.number(),
        longitude: z.number(),
    }),
    output: UserArcheType,
})
async updatePosition(
    args: { latitude: number; longitude: number },
    context: GraphQLContext
) {
    // ...
}
```

:::caution Zod Type Limitations

Only simple Zod types are supported for GraphQL schema generation: `z.string()`, `z.number()`, `z.boolean()`, `z.enum()`, and `z.object()`. Complex chains like `.min()`, `.max()`, `.email()` are **not** reflected in the generated GraphQL schema. If you need complex validation, validate inside your resolver method.

:::

### Using Archetype Schemas as Input

You can derive input schemas from archetypes:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: UserArcheType.getInputSchema().partial().pick({
        name: true,
    }),
    output: UserArcheType,
})
async updateProfile(args: any, context: GraphQLContext) {
    const user = await Entity.FindById(context.jwt.payload.user_id);
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

Use HTTP method decorators to create REST routes:

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
        // Validate and process...
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

REST handlers receive the raw `Request` object and should return a `Response`.

## OpenAPI Documentation

Add OpenAPI documentation to your REST endpoints with `@ApiDocs` and `@ApiTags`:

```typescript
import { ApiDocs, ApiTags } from "bunsane/swagger";

const RegisterSchema = z.object({
    email: z.string(),
    name: z.string(),
    password: z.string(),
});

@ApiTags("Authentication")
class AuthService extends BaseService {
    @Post("/v1/auth/register")
    @ApiDocs({
        summary: "Register a new user",
        description: "Register a new user with email, password, and name",
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: z.toJSONSchema(RegisterSchema),
                },
            },
        },
        responses: {
            "201": { description: "User registered successfully" },
            "400": { description: "Validation error" },
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
        // Process registration...
    }
}
```

The OpenAPI spec is served at `http://localhost:3000/openapi.json` and a Swagger UI is available at `http://localhost:3000/docs`.

## Entity Hooks

React to entity lifecycle events with `@ComponentTargetHook`. Hooks fire automatically when entities with specific components are created or updated.

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

        console.log("New order created:", orderEntity.id);
    }

    @ComponentTargetHook("entity.updated", {
        includeComponents: [OrderTag, OrderStatusComponent],
    })
    async onOrderStatusUpdated(event: EntityUpdatedEvent) {
        const orderEntity = event.entity;
        const statusComp = await orderEntity.get(OrderStatusComponent);
        if (!statusComp) return;

        this.app.pubSub.publish(`orderUpdated_${orderEntity.id}`, orderEntity);
    }
}
```

The hook fires only for entities that have **all** the components listed in `includeComponents`.

## GraphQL Subscriptions

Create real-time subscriptions using PubSub:

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

Publish events from any method in any service:

```typescript
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

## GraphQL Context

Every GraphQL operation receives a `context` object with useful properties:

```typescript
async getUser(args: { id: string }, context: GraphQLContext) {
    // Access authenticated user's JWT payload
    const currentUserId = context.jwt?.payload?.user_id;

    // Use DataLoaders for efficient batching
    const user = await context.loaders.entity.load(args.id);

    return user;
}
```

- **`context.jwt`** -- JWT payload (available when using the JWT plugin)
- **`context.loaders`** -- DataLoaders for efficient batched data fetching

## Error Handling

### In GraphQL Operations

Return or throw `GraphQLError`:

```typescript
import { GraphQLError } from "graphql";
import { responseError } from "bunsane/core/ErrorHandler";

// Option 1: Return a GraphQLError
if (!user) {
    return new GraphQLError("User not found", {
        extensions: { code: "NOT_FOUND" }
    });
}

// Option 2: Use the responseError helper
if (!user) {
    return responseError("User not found", {
        extensions: { code: "NOT_FOUND" }
    });
}
```

### In REST Endpoints

Return standard `Response` objects:

```typescript
return Response.json(
    { errors: ["Invalid input"] },
    { status: 400 }
);
```

## Authentication

Access the JWT payload from the GraphQL context:

```typescript
@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async profile(args: {}, context: GraphQLContext) {
    if (!context.jwt?.payload?.user_id) {
        return responseError("Authentication required", {
            extensions: { code: "UNAUTHENTICATED" }
        });
    }

    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```

The `context.jwt` object is available when you configure the JWT plugin. See the [JWT Authentication Setup](/docs/examples#jwt-authentication-setup) example for full setup instructions.

## File Uploads

Handle file uploads in GraphQL mutations:

```typescript
import { Upload } from "bunsane/gql";
import { UploadManager } from "bunsane/upload";

@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        file: Upload,
    }),
    output: UserArcheType,
})
async uploadProfilePicture(args: { file: any }, context: GraphQLContext) {
    const userId = context.jwt.payload.user_id;
    const user = await Entity.FindById(userId);
    if (!user) return responseError("User not found");

    const uploadManager = UploadManager.getInstance();
    const uploadResult = await uploadManager.uploadFile(args.file, {
        maxFileSize: 5 * 1024 * 1024, // 5MB
    });

    if (!uploadResult.success) return responseError("Failed to upload file");

    await user.set(ProfilePictureComponent, { path: uploadResult.path });
    await user.save();
    return user;
}
```

## Logging

Use the built-in structured logger:

```typescript
import { logger as MainLogger } from "bunsane/core/Logger";

const logger = MainLogger.child({ service: "UserService" });

class UserService extends BaseService {
    async someMethod() {
        logger.trace({ msg: "Detailed debug info" });
        logger.info({ msg: "Normal operation" });
        logger.warn({ msg: "Something unexpected" });
        logger.error({ msg: "Something went wrong" });
    }
}
```

## Service Communication

Services can communicate through several patterns:

### PubSub Events

Use `app.pubSub` for loose coupling between services:

```typescript
// Publishing service
class OrderService extends BaseService {
    async completeOrder(orderId: string) {
        const order = await Entity.FindById(orderId);
        await order.set(OrderStatusComponent, { value: "completed" });
        await order.save();
        this.app.pubSub.publish("order.completed", { orderId, order });
    }
}

// Subscribing service
class NotificationService extends BaseService {
    constructor(private app: App) {
        super();
        this.app.pubSub.subscribe("order.completed", this.onOrderCompleted.bind(this));
    }

    async onOrderCompleted(data: { orderId: string; order: Entity }) {
        // Send notification...
    }
}
```

### Entity Hooks

Use `@ComponentTargetHook` to react to data changes across services (described above).

## Organizing Services

A recommended project structure:

```
src/
  components/
    UserComponent.ts
    OrderComponent.ts
  archetypes/
    UserArcheType.ts
    OrderArcheType.ts
  services/
    AuthService.ts
    UserService.ts
    OrderService.ts
    admin/
      AdminUserService.ts
  App.ts
index.ts
```

Register all services in your App constructor:

```typescript
export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        ServiceRegistry.registerService(new AuthService(this));
        ServiceRegistry.registerService(new UserService(this));
        ServiceRegistry.registerService(new OrderService(this));

        // Conditional registration
        if (process.env.NODE_ENV === "development") {
            ServiceRegistry.registerService(new DebugService(this));
        }
    }
}
```
