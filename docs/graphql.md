---
sidebar_position: 5
---

# GraphQL

BunSane builds the GraphQL schema from your services and archetypes. You do not write SDL files. Schema build fails on a bad output, an unregistered relation, or an `@ArcheTypeFunction` with no usable return type. It does not silently emit `String` or `[Any]` (0.7+).

## Playground

With the server running and GraphiQL enabled:

```
http://localhost:3000/graphql
```

Introspection and GraphiQL resolve in this order:

1. `app.setGraphQLIntrospection(boolean)` / `app.setGraphQLGraphiQL(boolean)`, if you called them
2. else `GRAPHQL_INTROSPECTION` / `GRAPHQL_GRAPHIQL` (`on` or `off`)
3. else **on only when `NODE_ENV=development`**

`NODE_ENV=test`, `production`, and unset all leave both off. With GraphiQL off, a `GET /graphql` that wants HTML returns 404. POST still works.

## How Operations Are Created

Decorate a service method with `@GraphQLOperation`. The method name is the field name unless you set `name`.

```typescript
import { BaseService, Entity, GraphQLOperation, t } from "bunsane";

class UserService extends BaseService {
    @GraphQLOperation({
        type: "Query",
        input: { id: t.id().required() },
        output: UserArcheType,
    })
    async profile(input: { id: string }) {
        return await Entity.FindById(input.id);
    }

    @GraphQLOperation({
        type: "Mutation",
        input: { name: t.string().required() },
        output: UserArcheType,
    })
    async updateProfile(input: { name: string }) {
        // ...
    }
}
```

`type` is `"Query"` or `"Mutation"`. With a `t.*` input, the method is checked as `(input, ctx?, info?) => output`.

Clients pass one argument named `input`:

```graphql
mutation {
    updateProfile(input: { name: "Ada" }) {
        id
    }
}
```

The resolver receives the unwrapped object (`{ name: "Ada" }`), not `{ input: ... }`.

### Output kinds

`output` must be one of:

| Value | Generated field type |
|---|---|
| Archetype instance or class | that archetype's GraphQL type |
| `[Archetype]` | a list of that type |
| `"Boolean"`, `"String"`, `"Int"`, or any other type-name string | that name, verbatim |
| `{ id: "ID!", name: "String" }` | a generated object type |

An empty string, an empty array, a Zod schema, or any other value throws at schema build:

```text
Operation "createTodo" has an unrecognised output type (...). Refusing to default to String.
```

### Inputs

Prefer `t.*`. Zod object inputs and string maps (`{ id: "ID!" }`) still work and log a deprecation warning. Removal is planned before 1.0, not in 0.8 or 0.9.

`t.*` constraints (`.minLength()`, `.email()`, `.min()`) run at request time. They are not written into the SDL. Names passed to `t.object`, `t.enum`, and `t.ref` must be GraphQL identifiers or construction throws (0.8+).

There is no `t.date()`.

## How Archetypes Become Types

`@ArcheType("User")` becomes an output type `User`. It does not create `UserInput`. GraphQL input types come from `@GraphQLOperation` and are named `${operationName}Input`. Nested component types lower-case the first character of the class name (`NameComponent` → `nameComponent`). A component with no `@CompData` fields is omitted.

```typescript
@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(EmailComponent, { nullable: true })
    email!: EmailComponent;
}
```

```graphql
type User {
    id: ID
    name: nameComponent!
    email: emailComponent
}
```

`@ArcheTypeFunction` methods are computed fields on that output type. Relations are fields too. Neither is part of `getInputSchema()`, which is a Zod object for in-process checks, not an SDL input.

You do not call `registerFieldResolvers`. Schema build attaches field, relation, and function resolvers and skips pairs that are already registered (0.7+).

### Date scalar

SDL says `Date` only when the Zod or `@CompData` type is `Date`. A field named `createdAt` or `dateOfBirth` with type `string` stays `String`. The old name heuristic is gone (0.7+).

### `id: ID`

`ID` is used for the archetype's own `id` field, and for `t.id()`. A component property `id: string` is `String`, not `ID`.

## Depth and complexity

Defaults (0.7+):

| Limit | Default | Floor |
|---|---|---|
| Max depth | 15 | 15. `setGraphQLMaxDepth(n)` throws if `n` is not an integer ≥ 15. `0` does not disable it |
| Max complexity | 1000 | 1. `0` does not disable it |

```typescript
app.setGraphQLMaxDepth(20);
app.setGraphQLMaxComplexity(2000);
```

The same floors apply to `GRAPHQL_MAX_DEPTH` and `GRAPHQL_MAX_COMPLEXITY`. An invalid value fails `App.init()`.

## Subscriptions

```typescript
import { BaseService, GraphQLSubscription } from "bunsane";

class OrderService extends BaseService {
    constructor(private app: App) {
        super();
    }

    @GraphQLSubscription({
        input: { orderId: t.id().required() },
        output: OrderArcheType,
    })
    async orderUpdated(input: { orderId: string }) {
        return this.app.pubSub.subscribe(`orderUpdated_${input.orderId}`);
    }
}
```

Publish from any service that holds the app:

```typescript
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

Subscriptions use GraphQL Yoga's default transport, Server-Sent Events. This app does not attach a WebSocket handler. GraphiQL can exercise them when GraphiQL is enabled.

## Context and Yoga plugins

Every operation can take a context argument. Shape it with `setGraphQLContextFactory` before `start()`:

```typescript
this.setGraphQLContextFactory((yogaContext) => {
    return { request: yogaContext.request };
});
```

The factory return value is merged into the context your resolvers see.

BunSane uses [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server). Add plugins with `addYogaPlugin` before `start()`:

```typescript
import { useJWT } from "@graphql-yoga/plugin-jwt";

this.addYogaPlugin(useJWT({
    // JWT configuration
}));
```

A full JWT setup is in [Examples](./examples.md#jwt-authentication-setup).

`isFieldRequested(info, fieldName)` is not on the root barrel. Import it from `"bunsane/gql/helpers"`. It returns false when there is no selection set.

Operation middleware (`@Middleware`) is documented in [Middleware](./middleware.md). Import it from `"bunsane/gql"` or `"bunsane/gql/middleware"`.

## Read models

Registered `@ReadModel` classes add **Query** fields only (`list` / `count` / `sum` / `avg`). There are no generated mutations. See [Read models](./read-models.md).
