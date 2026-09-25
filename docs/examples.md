---
sidebar_position: 6
---

# Examples

Complete working examples showing how to build applications with BunSane.

## Basic Todo Application

A simple todo list API demonstrating components, archetypes, and services.

### Project Structure

```
todo-api/
  src/
    components/
      TodoComponent.ts
    archetypes/
      TodoArcheType.ts
    services/
      TodoService.ts
    App.ts
  index.ts
```

### Component Definition

```typescript title="src/components/TodoComponent.ts"
import { BaseComponent, CompData, Component } from "bunsane";

@Component
export class TodoTag extends BaseComponent {}

@Component
export class TodoInfoComponent extends BaseComponent {
    @CompData()
    title: string = "";

    @CompData()
    description: string = "";

    @CompData()
    completed: boolean = false;

    @CompData({ indexed: true })
    createdAt: Date = new Date();
}
```

### Archetype Definition

```typescript title="src/archetypes/TodoArcheType.ts"
import { ArcheType, ArcheTypeField, BaseArcheType } from "bunsane";
import type { ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import { TodoInfoComponent, TodoTag } from "../components/TodoComponent";

@ArcheType("Todo")
export class TodoArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(TodoTag)
    tag!: TodoTag;

    @ArcheTypeField(TodoInfoComponent)
    info!: TodoInfoComponent;
}

export type ITodoArcheType = ArcheTypeOwnProperties<TodoArcheTypeClass>;
export const TodoArcheType = new TodoArcheTypeClass();
```

### Service Definition

```typescript title="src/services/TodoService.ts"
import {
    BaseService,
    Entity,
    GraphQLOperation,
    Query,
    t,
} from "bunsane";
import { TodoArcheType } from "../archetypes/TodoArcheType";
import { TodoInfoComponent, TodoTag } from "../components/TodoComponent";

class TodoService extends BaseService {
    @GraphQLOperation({
        type: "Query",
        input: { id: t.id().required() },
        output: TodoArcheType,
    })
    async getTodo(input: { id: string }) {
        return await Entity.FindById(input.id);
    }

    @GraphQLOperation({
        type: "Query",
        output: [TodoArcheType],
    })
    async listTodos() {
        return await new Query()
            .with(TodoTag)
            .with(TodoInfoComponent)
            .sortBy(TodoInfoComponent, "createdAt", "DESC")
            .take(20)
            .exec();
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            title: t.string().required(),
            description: t.string(),
        },
        output: TodoArcheType,
    })
    async createTodo(input: { title: string; description?: string }) {
        const todo = Entity.Create()
            .add(TodoTag, {})
            .add(TodoInfoComponent, {
                title: input.title,
                description: input.description ?? "",
                completed: false,
                createdAt: new Date(),
            });

        await todo.save();
        return todo;
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            id: t.id().required(),
            title: t.string(),
            description: t.string(),
            completed: t.boolean(),
        },
        output: TodoArcheType,
    })
    async updateTodo(input: {
        id: string;
        title?: string;
        description?: string;
        completed?: boolean;
    }) {
        const todo = await Entity.FindById(input.id);
        if (!todo) throw new Error("Todo not found");

        const currentInfo = await todo.get(TodoInfoComponent);
        if (!currentInfo) throw new Error("Todo has no info");

        await todo.set(TodoInfoComponent, {
            ...currentInfo,
            ...(input.title !== undefined && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.completed !== undefined && { completed: input.completed }),
        });

        await todo.save();
        return todo;
    }

    @GraphQLOperation({
        type: "Mutation",
        input: { id: t.id().required() },
        output: "Boolean",
    })
    async deleteTodo(input: { id: string }) {
        const todo = await Entity.FindById(input.id);
        if (!todo) return false;
        await todo.delete();
        return true;
    }
}

export default TodoService;
```

Clients pass one argument named `input`, for example `createTodo(input: { title: "Buy milk" })`. The method receives the unwrapped object.

### Application Setup

```typescript title="src/App.ts"
import { App, ServiceRegistry } from "bunsane";

import "./components/TodoComponent";
import TodoService from "./services/TodoService";

export default class TodoAPI extends App {
    constructor() {
        super("TodoAPI", "1.0.0");
        ServiceRegistry.registerService(new TodoService());
    }
}
```

```typescript title="index.ts"
import TodoAPI from "./src/App";

const app = new TodoAPI();
app.init();
```

---

## User Authentication with REST

An example showing REST endpoints for user registration and login.

### Components

```typescript title="src/components/UserComponent.ts"
import { BaseComponent, CompData, Component } from "bunsane";

@Component
export class UserTag extends BaseComponent {}

@Component
export class PasswordComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

@Component
export class EmailComponent extends BaseComponent {
    @CompData({ indexed: true })
    value: string = "";

    @CompData()
    verified: boolean = false;
}

@Component
export class NameComponent extends BaseComponent {
    @CompData()
    value: string = "";
}
```

### Auth Service

```typescript title="src/services/AuthService.ts"
import { App, BaseService, Entity, Query } from "bunsane";
import { Post } from "bunsane/service";
import { ApiDocs, ApiTags } from "bunsane/swagger";
import { z } from "zod";
import {
    UserTag, PasswordComponent, EmailComponent, NameComponent,
} from "../components/UserComponent";

const RegisterSchema = z.object({
    email: z.string(),
    password: z.string(),
    name: z.string(),
});

const LoginSchema = z.object({
    email: z.string(),
    password: z.string(),
});

@ApiTags("Authentication")
class AuthService extends BaseService {
    constructor(private app: App) {
        super();
    }

    @Post("/v1/auth/register")
    @ApiDocs({
        summary: "Register a new user",
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
            "400": { description: "Validation error or email already exists" },
        },
    })
    async register(req: Request) {
        const body = await req.json();
        const parse = RegisterSchema.safeParse(body);

        if (!parse.success) {
            return Response.json(
                { errors: parse.error.issues.map((i) => i.message) },
                { status: 400 }
            );
        }

        const { email, password, name } = parse.data;

        // Check if email already exists
        const existing = await new Query()
            .with(EmailComponent, Query.filters(
                Query.filter("value", Query.filterOp.EQ, email)
            ))
            .exec();

        if (existing.length > 0) {
            return Response.json(
                { errors: ["Email already registered"] },
                { status: 400 }
            );
        }

        const hashedPassword = await Bun.password.hash(password);

        const user = Entity.Create()
            .add(UserTag, {})
            .add(EmailComponent, { value: email, verified: false })
            .add(PasswordComponent, { value: hashedPassword })
            .add(NameComponent, { value: name });

        await user.save();

        return Response.json(
            { message: "User registered", data: { id: user.id } },
            { status: 201 }
        );
    }

    @Post("/v1/auth/login")
    @ApiDocs({
        summary: "Login user",
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: z.toJSONSchema(LoginSchema),
                },
            },
        },
        responses: {
            "200": { description: "Login successful" },
            "401": { description: "Invalid credentials" },
        },
    })
    async login(req: Request) {
        const body = await req.json();
        const parse = LoginSchema.safeParse(body);

        if (!parse.success) {
            return Response.json(
                { errors: parse.error.issues.map((i) => i.message) },
                { status: 400 }
            );
        }

        const { email, password } = parse.data;

        const users = await new Query()
            .with(EmailComponent, Query.filters(
                Query.filter("value", Query.filterOp.EQ, email)
            ))
            .exec();

        if (users.length === 0) {
            return Response.json(
                { errors: ["Invalid credentials"] },
                { status: 401 }
            );
        }

        const user = users[0];
        const passwordComp = await user.get(PasswordComponent);

        const isValid = await Bun.password.verify(password, passwordComp?.value || "");
        if (!isValid) {
            return Response.json(
                { errors: ["Invalid credentials"] },
                { status: 401 }
            );
        }

        // Generate JWT token (implement your JWT signing logic)
        const token = generateJWTToken({ user_id: user.id });

        return Response.json({
            message: "Login successful",
            data: {
                access_token: token,
                expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
            },
        });
    }
}

export default AuthService;
```

---

## Entity Hooks

An example showing how to use entity hooks for side effects like logging and real-time notifications.

```typescript title="src/services/OrderService.ts"
import { App, BaseService, Entity, GraphQLOperation, logger as MainLogger, t } from "bunsane";
import { ComponentTargetHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent, EntityUpdatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

const logger = MainLogger.child({ service: "OrderService" });

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

        logger.info({
            msg: "New order created",
            orderId: orderEntity.id,
            customerId: infoComp?.customerId,
        });
    }

    @ComponentTargetHook("entity.updated", {
        includeComponents: [OrderTag, OrderStatusComponent],
    })
    async onOrderStatusChanged(event: EntityUpdatedEvent) {
        const orderEntity = event.entity;
        const statusComp = await orderEntity.get(OrderStatusComponent);

        logger.info({
            msg: "Order status updated",
            orderId: orderEntity.id,
            newStatus: statusComp?.value,
        });

        this.app.pubSub.publish(`order.${orderEntity.id}.status`, {
            orderId: orderEntity.id,
            status: statusComp?.value,
        });
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            customerId: t.id().required(),
            items: t.list(t.object({
                productId: t.id().required(),
                quantity: t.int().required(),
            }, "OrderItemInput")).required(),
        },
        output: OrderArcheType,
    })
    async createOrder(input: { customerId: string; items: { productId: string; quantity: number }[] }) {
        const order = Entity.Create()
            .add(OrderTag, {})
            .add(OrderInfoComponent, {
                customerId: input.customerId,
                items: input.items,
                createdAt: new Date(),
            })
            .add(OrderStatusComponent, { value: "pending" });

        await order.save();
        // Sync hooks run before save() resolves. An async: true hook does not.
        return order;
    }
}

export default OrderService;
```

---

## Transaction Example

An example showing database transactions for atomic operations like fund transfers.

```typescript title="src/services/PaymentService.ts"
import { BaseService, Entity, GraphQLOperation, t } from "bunsane";
import db from "bunsane/database";

class PaymentService extends BaseService {
    @GraphQLOperation({
        type: "Mutation",
        input: {
            fromAccountId: t.id().required(),
            toAccountId: t.id().required(),
            amount: t.float().required(),
        },
        output: {
            success: "Boolean!",
            transactionId: "ID!",
        },
    })
    async transferFunds(input: { fromAccountId: string; toAccountId: string; amount: number }) {
        const { fromAccountId, toAccountId, amount } = input;

        const result = await db.transaction(async (trx) => {
            const fromAccount = await Entity.FindById(fromAccountId, trx);
            if (!fromAccount) throw new Error("Source account not found");

            const fromBalance = await fromAccount.get(BalanceComponent, { trx });
            if (!fromBalance || fromBalance.amount < amount) {
                throw new Error("Insufficient funds");
            }

            const toAccount = await Entity.FindById(toAccountId, trx);
            if (!toAccount) throw new Error("Destination account not found");

            const toBalance = await toAccount.get(BalanceComponent, { trx });

            await fromAccount.set(
                BalanceComponent,
                { amount: fromBalance.amount - amount },
                { trx }
            );
            await fromAccount.save(trx);

            await toAccount.set(
                BalanceComponent,
                { amount: (toBalance?.amount || 0) + amount },
                { trx }
            );
            await toAccount.save(trx);

            const txRecord = Entity.Create()
                .add(TransactionTag, {})
                .add(TransactionInfoComponent, {
                    fromAccountId,
                    toAccountId,
                    amount,
                    timestamp: new Date(),
                });
            await txRecord.save(trx);

            return txRecord.id;
        });

        return { success: true, transactionId: result };
    }
}

export default PaymentService;
```

---

## Authentication Decorator Pattern

A reusable `@RequireJWT` decorator for protecting GraphQL operations.

### AuthDecorator Utility

```typescript title="src/utilities/AuthDecorator.ts"
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
```

### Using the Decorators

```typescript title="src/services/UserService.ts"
import { BaseService, Entity, GraphQLOperation, Query } from "bunsane";
import type { GraphQLContext } from "bunsane/types/graphql.types";
import { RequireJWT, RequireRole } from "../utilities/AuthDecorator";

class UserService extends BaseService {

    @RequireJWT()
    @GraphQLOperation({
        type: "Query",
        output: UserArcheType,
    })
    async profile(args: {}, context: GraphQLContext) {
        const userId = context.jwt.payload.user_id;
        return await Entity.FindById(userId);
    }

    @RequireRole("admin")
    @GraphQLOperation({
        type: "Query",
        output: [UserArcheType],
    })
    async listAllUsers(args: {}, context: GraphQLContext) {
        return await new Query().with(UserTag).exec();
    }
}

export default UserService;
```

---

## JWT Authentication Setup

How to configure JWT authentication for your BunSane app.

```typescript title="src/App.ts"
import { App, ServiceRegistry } from "bunsane";
import { createInlineSigningKeyProvider, useJWT } from "@graphql-yoga/plugin-jwt";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export default class SecureAPI extends App {
    constructor() {
        super("SecureAPI", "1.0.0");

        const jwtPlugin = useJWT({
            signingKeyProviders: [createInlineSigningKeyProvider(JWT_SECRET)],
            tokenLookupLocations: [
                (params) => {
                    const auth = params.request.headers.get("authorization");
                    if (auth && auth.startsWith("Bearer ")) {
                        return { token: auth.slice(7) };
                    }
                    return undefined;
                },
            ],
            tokenVerification: {
                issuer: "my-api",
                audience: "my-app",
                algorithms: ["HS256"],
            },
            extendContext: true,
            reject: {
                missingToken: false,  // Allow unauthenticated requests
                invalidToken: true,   // Reject invalid tokens
            },
        });

        this.addYogaPlugin(jwtPlugin);

        ServiceRegistry.registerService(new AuthService(this));
        ServiceRegistry.registerService(new UserService());
    }
}
```

Then in your services, access the JWT payload through the context:

```typescript
@GraphQLOperation({
    type: "Query",
    output: UserArcheType,
})
async profile(args: {}, context: GraphQLContext) {
    if (!context.jwt?.payload?.user_id) {
        throw new GraphQLError("Authentication required", {
            extensions: { code: "UNAUTHENTICATED" },
        });
    }

    const userId = context.jwt.payload.user_id;
    return await Entity.FindById(userId);
}
```
