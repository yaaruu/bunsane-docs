---
sidebar_position: 5
sidebar_label: Your First Service
---

# Your First Service

You have components and an archetype. Now it is time to expose them through a GraphQL API. In BunSane, you do this with a **Service** -- a class that holds your business logic and uses decorators to turn methods into GraphQL operations.

By the end of this page, you will have a working Todo CRUD API.

## Defining Inputs with `t.`

Before we write the service, let's talk about how you define operation inputs.

BunSane provides a built-in Schema DSL called **`t.`** for defining GraphQL operation inputs. You import it from `bunsane/gql/schema`:

```typescript
import { t } from "bunsane/gql/schema";

// Define operation inputs using t.
const input = {
    title: t.string().required(),
    description: t.string(),
};
```

### Why `t.` instead of Zod?

You might wonder: "Why not just use `z.object()` from Zod?" There are two reasons:

1. **GraphQL schema generation works correctly.** The `t.` DSL maps directly to GraphQL types. When you write `t.string()`, BunSane knows that is a `String` in GraphQL. With Zod, only basic types like `z.string()` are supported -- chains like `.min()`, `.max()`, or `.email()` are silently ignored in the generated schema.

2. **Validation and schema in one place.** With `t.`, you can add constraints like `t.string().minLength(1).maxLength(200)` and they are enforced at runtime *and* documented in the GraphQL schema. With Zod, you would need to use plain `z.string()` for the schema and then validate manually inside your resolver.

Here is a quick comparison:

```typescript
// ✅ t. DSL -- validation and GraphQL type in one place
input: {
    title: t.string().required().minLength(1).maxLength(200),
    email: t.string().email(),
}

// ❌ Zod -- .min()/.email() are ignored in GraphQL schema generation
input: z.object({
    title: z.string().min(1).max(200),  // GraphQL only sees "String"
    email: z.string().email(),           // GraphQL only sees "String"
})
```

### Available types

| Builder | GraphQL Type | Example |
|---------|-------------|---------|
| `t.string()` | `String` | `t.string().minLength(1).maxLength(100)` |
| `t.int()` | `Int` | `t.int().min(0).max(999)` |
| `t.float()` | `Float` | `t.float().min(0)` |
| `t.boolean()` | `Boolean` | `t.boolean()` |
| `t.id()` | `ID` | `t.id().required()` |
| `t.enum()` | Custom Enum | `t.enum(["active", "archived"] as const, "Status")` |
| `t.list()` | `[Type]` | `t.list(t.string())` |
| `t.object()` | Custom Input | `t.object({ name: t.string() }, "AddressInput")` |

Every type is **optional by default**. Call `.required()` to make it required (maps to `!` in GraphQL).

## Create the Service

Create `src/services/TodoService.ts`:

```typescript title="src/services/TodoService.ts"
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import App from "bunsane/core/App";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import type { GraphQLContext } from "bunsane/types/graphql.types";
import { t } from "bunsane/gql/schema";
import { TodoArcheType } from "../archetypes/TodoArcheType";
import { TodoTag, TodoInfoComponent } from "../components/TodoComponent";

class TodoService extends BaseService {
    constructor(private app: App) {
        super();
        TodoArcheType.registerFieldResolvers(this);
    }

    @GraphQLOperation({
        type: "Query",
        output: TodoArcheType,
    })
    async getTodo(args: { id: string }, context: GraphQLContext) {
        return await Entity.FindById(args.id);
    }

    @GraphQLOperation({
        type: "Query",
        output: [TodoArcheType],
    })
    async listTodos(args: {}, context: GraphQLContext) {
        return await new Query()
            .with(TodoTag)
            .with(TodoInfoComponent)
            .sortBy(TodoInfoComponent, "createdAt", "DESC")
            .exec();
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            title: t.string().required().minLength(1).maxLength(200),
            description: t.string(),
        },
        output: TodoArcheType,
    })
    async createTodo(
        args: { title: string; description?: string },
        context: GraphQLContext,
    ) {
        const todo = Entity.Create()
            .add(TodoTag, {})
            .add(TodoInfoComponent, {
                title: args.title,
                description: args.description || "",
                completed: false,
                createdAt: new Date(),
            });

        await todo.save();
        return todo;
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            id: t.string().required(),
            title: t.string().minLength(1).maxLength(200),
            description: t.string(),
            completed: t.boolean(),
        },
        output: TodoArcheType,
    })
    async updateTodo(
        args: { id: string; title?: string; description?: string; completed?: boolean },
        context: GraphQLContext,
    ) {
        const todo = await Entity.FindById(args.id);
        if (!todo) {
            throw new Error("Todo not found");
        }

        const current = await todo.get(TodoInfoComponent);
        await todo.set(TodoInfoComponent, {
            ...current,
            ...(args.title !== undefined && { title: args.title }),
            ...(args.description !== undefined && { description: args.description }),
            ...(args.completed !== undefined && { completed: args.completed }),
        });

        await todo.save();
        return todo;
    }

    @GraphQLOperation({
        type: "Mutation",
        input: {
            id: t.string().required(),
        },
        output: "Boolean",
    })
    async deleteTodo(args: { id: string }, context: GraphQLContext) {
        const todo = await Entity.FindById(args.id);
        if (!todo) {
            return false;
        }
        await todo.delete();
        return true;
    }
}

export default TodoService;
```

Let's break down what is happening:

### The constructor

```typescript
constructor(private app: App) {
    super();
    TodoArcheType.registerFieldResolvers(this);
}
```

Every service receives the `App` instance. `registerFieldResolvers` tells BunSane to wire up the archetype's fields to this service -- this is required for the GraphQL type to resolve correctly.

### Queries

`@GraphQLOperation({ type: "Query" })` turns a method into a GraphQL query. The method name becomes the query name in your schema.

- **`getTodo`** -- finds a single todo by ID using `Entity.FindById()`
- **`listTodos`** -- finds all entities that have both `TodoTag` and `TodoInfoComponent`, sorted by creation date

### Mutations

`@GraphQLOperation({ type: "Mutation" })` creates a mutation. The `input` option accepts a `t.` schema that defines what arguments the mutation takes.

- **`createTodo`** -- `title` is required with length constraints, `description` is optional. Creates a new entity with `TodoTag` and `TodoInfoComponent`, then saves it
- **`updateTodo`** -- only `id` is required, everything else is optional so you can update individual fields
- **`deleteTodo`** -- finds and deletes an entity, returns true/false

Notice how `t.string().required()` makes a field non-nullable in GraphQL (`String!`), while `t.string()` alone is nullable (`String`). This gives you precise control over your GraphQL schema.

## Register the Service

Update your App class to register the service:

```typescript title="src/App.ts"
import App from "bunsane/core/App";
import { ServiceRegistry } from "bunsane/service";

// Import components so decorators are executed
import "./components/TodoComponent";

import TodoService from "./services/TodoService";

export default class TodoAPI extends App {
    constructor() {
        super("TodoAPI", "0.1.0");

        ServiceRegistry.registerService(new TodoService(this));
    }
}
```

## Try It Out

Start your app:

```bash
bun run index.ts
```

Open the GraphQL playground at **http://localhost:3000/graphql** and try these operations:

### Create a todo

```graphql
mutation {
    createTodo(title: "Buy groceries", description: "Milk, eggs, bread") {
        id
        info {
            title
            description
            completed
        }
    }
}
```

### List all todos

```graphql
query {
    listTodos {
        id
        info {
            title
            completed
            createdAt
        }
    }
}
```

### Update a todo

```graphql
mutation {
    updateTodo(id: "your-todo-id-here", completed: true) {
        id
        info {
            title
            completed
        }
    }
}
```

### Delete a todo

```graphql
mutation {
    deleteTodo(id: "your-todo-id-here")
}
```

## Your Project Structure

At this point, your project looks like this:

```
my-todo-app/
├── src/
│   ├── components/
│   │   └── TodoComponent.ts
│   ├── archetypes/
│   │   └── TodoArcheType.ts
│   ├── services/
│   │   └── TodoService.ts
│   └── App.ts
├── index.ts
├── .env
├── package.json
└── tsconfig.json
```

This is the standard BunSane project layout: **components** define your data, **archetypes** group them into shapes, and **services** expose them as APIs.

## What's Next

You now have a fully working CRUD API! From here, you can:

- **[Learn the details](/docs/core-concepts)** -- Dive deeper into entities, queries, and archetypes
- **[Explore more examples](/docs/examples)** -- See authentication, transactions, hooks, and subscriptions
- **[Add middleware](/docs/middleware)** -- Add request logging, security headers, and more
