---
sidebar_position: 5
---

# GraphQL

BunSane auto-generates a GraphQL API from your services and archetypes. You do not write schema files by hand -- the schema is built from your TypeScript code.

## GraphQL Playground

When your app is running, visit the built-in GraphQL playground:

```
http://localhost:3000/graphql
```

This interactive editor lets you explore your schema, write queries, and test mutations.

## How Operations Are Created

GraphQL operations are defined using the `@GraphQLOperation` decorator on service methods. You explicitly specify whether each method is a query or a mutation:

```typescript
import { GraphQLOperation } from "bunsane/gql";
import type { GraphQLContext } from "bunsane/types/graphql.types";

class UserService extends BaseService {
    // This becomes a GraphQL query named "profile"
    @GraphQLOperation({
        type: "Query",
        output: UserArcheType,
    })
    async profile(args: {}, context: GraphQLContext) {
        const userId = context.jwt.payload.user_id;
        return await Entity.FindById(userId);
    }

    // This becomes a GraphQL mutation named "updateProfile"
    @GraphQLOperation({
        type: "Mutation",
        input: z.object({ name: z.string() }),
        output: UserArcheType,
    })
    async updateProfile(args: { name: string }, context: GraphQLContext) {
        // ...
    }
}
```

The method name becomes the operation name in your GraphQL schema. Set `type: "Query"` for read operations and `type: "Mutation"` for write operations.

## How Archetypes Become Types

When you define an archetype with `@ArcheType("User")`, BunSane generates a corresponding GraphQL type. Each `@ArcheTypeField` becomes a field on that type, and `@ArcheTypeFunction` methods become computed fields.

For example, this archetype:

```typescript
@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(NameComponent)
    name!: NameComponent;

    @ArcheTypeField(EmailComponent, { nullable: true })
    email!: EmailComponent;
}
```

Generates this GraphQL type:

```graphql
type User {
    name: NameComponent!
    email: EmailComponent
}

input UserInput {
    name: NameComponentInput!
    email: EmailComponentInput
}
```

## How Zod Becomes Input Types

When you pass a Zod schema as the `input` option to `@GraphQLOperation`, BunSane converts it to a GraphQL input type:

```typescript
@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        title: z.string(),
        completed: z.boolean(),
    }),
    output: TodoArcheType,
})
async createTodo(args: { title: string; completed: boolean }, context: GraphQLContext) {
    // ...
}
```

This generates a GraphQL input type with `title: String!` and `completed: Boolean!`.

:::caution Simple Types Only

Only basic Zod types work for GraphQL schema generation: `z.string()`, `z.number()`, `z.boolean()`, `z.enum()`, and `z.object()`. Validation chains like `.min()`, `.max()`, or `.email()` are **not** reflected in the GraphQL schema. If you need complex validation, do it inside your resolver method.

:::

## GraphQL Context

Every operation receives a `context` parameter with request information:

```typescript
async myOperation(args: {}, context: GraphQLContext) {
    // JWT payload (when using the JWT plugin)
    const userId = context.jwt?.payload?.user_id;

    // DataLoaders for efficient batching
    const entity = await context.loaders.entity.load(someId);
}
```

## Adding Yoga Plugins

BunSane uses [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) under the hood. You can add any Yoga plugin:

```typescript
import { useJWT } from "@graphql-yoga/plugin-jwt";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        this.addYogaPlugin(useJWT({
            // JWT configuration...
        }));
    }
}
```

See the [JWT Authentication Setup](/docs/examples#jwt-authentication-setup) example for a complete JWT configuration.

## Subscriptions

Create real-time GraphQL subscriptions:

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

Publish events to trigger subscriptions:

```typescript
this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
```

Subscriptions work over WebSocket. The GraphQL playground supports testing subscriptions out of the box.

## Custom Context Factory

If you need to add custom data to the GraphQL context:

```typescript
export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        this.setGraphQLContextFactory((yogaContext) => {
            return {
                customData: "hello",
                // Add anything you need in your resolvers
            };
        });
    }
}
```

The factory receives the Yoga context (which includes the request) and returns an object that gets merged into the context available to all resolvers.
