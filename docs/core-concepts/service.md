---
sidebar_position: 3
sidebar_label: Services
---

# Services

Services hold application logic: GraphQL operations, REST endpoints, entity hooks, and subscriptions.

## Creating a Service

Extend `BaseService`. Pass the `App` only if the service needs it.

```typescript
import { App, BaseService } from "bunsane";

class UserService extends BaseService {
    constructor(private app: App) {
        super();
    }
}

export default UserService;
```

You do not call `registerFieldResolvers`. Schema build attaches archetype field, relation, and function resolvers (0.7+). The method remains and is idempotent.

## Registering Services

`ServiceRegistry` on the root barrel is the singleton instance. The method is `registerService`, not `register`.

```typescript
import { App, ServiceRegistry } from "bunsane";
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

Import component files from the App so `@Component` decorators run:

```typescript
import "./components/UserComponent";
import "./components/OrderComponent";
```

`App.rebuildGraphQLSchema()` rebuilds after a late registration.

## GraphQL Operations

`@GraphQLOperation` marks a query or mutation. With a `t.*` input, the method is checked as `(input, ctx?, info?) => output`.

```typescript
import { Entity, GraphQLOperation, t } from "bunsane";

class UserService extends BaseService {
    @GraphQLOperation({
        type: "Query",
        input: { id: t.id().required() },
        output: UserArcheType,
    })
    async profile(input: { id: string }) {
        const user = await Entity.FindById(input.id);
        if (!user) {
            throw new GraphQLError("User not found", {
                extensions: { code: "NOT_FOUND" },
            });
        }
        return user;
    }
}
```

Clients pass one argument named `input`. The method receives the unwrapped object.

### Operation options

| Option | Description |
|---|---|
| `type` | `"Query"` or `"Mutation"` |
| `name` | Field name. Defaults to the method name |
| `input` | `t.*` field map. Zod and `{ field: "String!" }` still work and log a deprecation warning |
| `output` | Return type. An unrecognised value throws at schema build |

### Output kinds

| `output` | Result |
|---|---|
| Archetype instance or class | that GraphQL type |
| `[TodoArcheType]` | a list of that type |
| `"Boolean"`, `"String"`, `"Int"`, or another type-name string | that name |
| `{ ok: "Boolean!", id: "ID!" }` | a generated object type |

A Zod schema, an empty array, an empty string, or a field map that is not all strings throws at schema build. It does not become `[Any]`. The decorator itself coerces some other values to the string `"String"` before that check: a non-archetype class, `null`, or a number. Pass an archetype, a type-name string, an archetype array, or a string field map so you do not silently get `String`.

### Mutations

```typescript
import { Entity, GraphQLOperation, t, type InferInput } from "bunsane";

const createInput = {
    title: t.string().required(),
    description: t.string(),
};

@GraphQLOperation({
    type: "Mutation",
    input: createInput,
    output: TodoArcheType,
})
async createTodo(input: InferInput<typeof createInput>) {
    const todo = Entity.Create()
        .add(TodoTag, {})
        .add(TodoInfoComponent, {
            title: input.title,
            description: input.description ?? "",
        });
    await todo.save();
    return todo;
}
```

### Returning lists

Wrap the archetype in an array. Call `.take()` so the query is bounded. See [List queries](../query-lists.md).

```typescript
@GraphQLOperation({
    type: "Query",
    output: [TodoArcheType],
})
async listTodos() {
    return await new Query().with(TodoTag).take(20).exec();
}
```

## Inputs

Use `t.*` from `"bunsane"`. Fields are optional until `.required()`. `t.object` and `t.enum` require a name. There is no `t.date()`.

```typescript
input: {
    email: t.string().required().email(),
    status: t.enum(["open", "closed"] as const, "OrderStatus"),
}
```

`.email()`, `.minLength()`, and `.min()` are runtime checks. They are not copied into the SDL.

Zod object inputs and string maps still parse. Both log a deprecation warning and will be removed before 1.0. Do not start new operations with them.

`getInputSchema()` on an archetype is for in-process Zod checks. Prefer `t.*` for the GraphQL argument.

## REST Endpoints

HTTP decorators are not on the root barrel.

```typescript
import { BaseService } from "bunsane";
import { Delete, Get, Post, Put } from "bunsane/service";

class AuthService extends BaseService {
    @Get("/v1/health")
    async healthCheck() {
        return Response.json({ status: "ok" });
    }

    @Post("/v1/auth/register")
    async registerUser(req: Request) {
        const body = await req.json();
        return Response.json({ id: user.id }, { status: 201 });
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

Handlers receive the raw `Request` and return a `Response`. JSON bodies default to 1 MB. A multipart body without `Content-Length` returns 411. See [Uploads](../uploads.md).

## OpenAPI

`@ApiDocs` and `@ApiTags` come from `"bunsane/swagger"`.

`/openapi.json` and `/docs` return **404** unless you set `BUNSANE_DOCS_TOKEN` (at least 16 characters) or `BUNSANE_DOCS=public` (0.7+). Send `Authorization: Bearer <token>` or `x-docs-token`. See [Configuration](../configuration.md).

## Entity Hooks

`@ComponentTargetHook` reacts when an entity with the listed components is created or updated. Import it from `"bunsane/core/decorators/EntityHooks"`.

An `async: true` hook is not awaited on the save path (0.7+). Errors are logged. Shutdown still drains the queue. See [Entity Hooks](../hooks.md).

## GraphQL Subscriptions

```typescript
import { GraphQLSubscription, t } from "bunsane";

@GraphQLSubscription({
    input: { orderId: t.id().required() },
    output: OrderArcheType,
})
async orderUpdated(input: { orderId: string }) {
    return this.app.pubSub.subscribe(`orderUpdated_${input.orderId}`);
}
```

Publish from any method that holds the app:

```typescript
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

## Context

The second argument is the GraphQL context. Shape it with `setGraphQLContextFactory` before `start()`. JWT fields exist only if you installed a JWT plugin. See [JWT Authentication Setup](../examples.md#jwt-authentication-setup).

`isFieldRequested` is not on the root barrel. Import it from `"bunsane/gql/helpers"`.

## Error Handling

Throw or return `GraphQLError`. `responseError` from `"bunsane/core/ErrorHandler"` builds one with a default `UNKNOWN_ERROR` code.

```typescript
import { GraphQLError } from "graphql";
import { responseError } from "bunsane/core/ErrorHandler";

if (!user) {
    throw new GraphQLError("User not found", {
        extensions: { code: "NOT_FOUND" },
    });
}

return responseError("User not found", {
    extensions: { code: "NOT_FOUND" },
});
```

REST handlers return a `Response`:

```typescript
return Response.json({ errors: ["Invalid input"] }, { status: 400 });
```

## File Uploads

Upload decorators are not on the root barrel. Import them from `"bunsane/upload"`. See [File Uploads](../uploads.md) for limits, the 411 rule, and S3.

## Logging

```typescript
import { logger as MainLogger } from "bunsane";

const logger = MainLogger.child({ service: "UserService" });
```

## Service Communication

Publish on `app.pubSub` when services should not import each other:

```typescript
this.app.pubSub.publish("order.completed", { orderId, order });
```

Subscribe in the constructor. For data-change reactions, prefer a hook. See [Entity Hooks](../hooks.md).

## Organizing Services

```
src/
  components/
  archetypes/
  services/
    AuthService.ts
    UserService.ts
    OrderService.ts
  App.ts
index.ts
```

Register every service in the App constructor, before `init()` / `start()`.
