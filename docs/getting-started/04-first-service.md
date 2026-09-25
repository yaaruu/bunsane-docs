---
sidebar_position: 5
sidebar_label: Your First Service
---

# Your First Service

You have components and an archetype. A **service** holds the business logic. Decorators turn methods into GraphQL operations.

By the end of this page you have a Todo CRUD API.

## Defining Inputs with `t.`

Operation inputs use the `t.*` schema DSL. Import it from the root barrel:

```typescript
import { t, type InferInput } from "bunsane";

const input = {
    title: t.string().required(),
    description: t.string(),
};

type CreateTodoInput = InferInput<typeof input>;
```

Every field is optional until you call `.required()`. That maps to `!` in GraphQL. There is no `t.date()`. Pass a date as a string and construct a `Date` in the method, or store it from `new Date()` yourself.

Zod schemas and string maps (`{ title: "String!" }`) still parse, and they log a deprecation warning. They will be removed before 1.0. Use `t.*` for new operations. Constraints such as `.minLength()` and `.email()` are enforced at runtime. They are not copied into the SDL as descriptions.

| Builder | GraphQL type | Example |
|---|---|---|
| `t.string()` | `String` | `t.string().minLength(1).maxLength(100)` |
| `t.int()` | `Int` | `t.int().min(0).max(999)` |
| `t.float()` | `Float` | `t.float().min(0)` |
| `t.boolean()` | `Boolean` | `t.boolean()` |
| `t.id()` | `ID` | `t.id().required()` |
| `t.enum(values, name)` | named enum | `t.enum(["active", "archived"] as const, "Status")` |
| `t.list(element)` | list | `t.list(t.string())` |
| `t.object(shape, name)` | named input | `t.object({ name: t.string() }, "AddressInput")` |
| `t.ref(typeName)` | existing type name | `t.ref("Todo")` |

`t.object` and `t.enum` require a name. Names must match `^[A-Za-z_][A-Za-z0-9_]*$` or construction throws (0.8+).

The generated field takes one argument named `input`. Clients call `createTodo(input: { title: "..." })`. The method receives the unwrapped object, not `{ input: ... }`.

## Create the Service

Create `src/services/TodoService.ts`:

```typescript title="src/services/TodoService.ts"
import {
    BaseService,
    Entity,
    GraphQLOperation,
    Query,
    t,
    type InferInput,
} from "bunsane";
import { TodoInfoComponent, TodoTag } from "../components/TodoComponent";
import { TodoArcheType } from "../archetypes/TodoArcheType";

const createInput = {
    title: t.string().required().minLength(1).maxLength(200),
    description: t.string(),
};

const updateInput = {
    id: t.id().required(),
    title: t.string().minLength(1).maxLength(200),
    description: t.string(),
    completed: t.boolean(),
};

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
        input: createInput,
        output: TodoArcheType,
    })
    async createTodo(input: InferInput<typeof createInput>) {
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
        input: updateInput,
        output: TodoArcheType,
    })
    async updateTodo(input: InferInput<typeof updateInput>) {
        const todo = await Entity.FindById(input.id);
        if (!todo) {
            throw new Error("Todo not found");
        }

        const current = await todo.get(TodoInfoComponent);
        if (!current) {
            throw new Error("Todo has no info component");
        }

        await todo.set(TodoInfoComponent, {
            ...current,
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
        if (!todo) {
            return false;
        }
        await todo.delete();
        return true;
    }
}

export default TodoService;
```

You do not call `registerFieldResolvers`. Schema build wires archetype fields.

`output` may be an archetype instance, an archetype class, an array of either, a GraphQL type-name string such as `"Boolean"`, or a field map of type-name strings. A Zod schema or an empty array throws at schema build. A non-archetype class, `null`, or a number is coerced to `"String"` by the decorator before that check. See [Services](../core-concepts/service.md).

`listTodos` calls `.take(20)`. Without `.take()`, `exec()` applies `BUNSANE_DEFAULT_QUERY_LIMIT` (default 10000) and warns once, in every environment, on the first unbounded call. If that page fills the cap, `NODE_ENV=development` throws. Other environments set `truncatedByDefaultLimit` and do not warn again. Prefer an explicit `.take()` and [sorted cursors](../query-lists.md) for real lists.

`get()` returns `null` when the component is absent. It throws `ComponentLoadError` when the database fails. Do not treat a thrown error as "missing".

## Register the Service

`ServiceRegistry` on the root barrel is the singleton. The method is `registerService`, not `register`.

```typescript title="src/App.ts"
import "reflect-metadata";
import { App, ServiceRegistry } from "bunsane";

import "./components/TodoComponent";
import TodoService from "./services/TodoService";

export default class TodoAPI extends App {
    constructor() {
        super("TodoAPI", "0.1.0");
        this.setCors({ origin: "http://localhost:5173" });
        ServiceRegistry.registerService(new TodoService());
    }
}
```

## Try It Out

```bash
NODE_ENV=development bun run index.ts
```

Open **http://localhost:3000/graphql**. GraphiQL is served only in development, or when `GRAPHQL_GRAPHIQL=on`. In production that GET returns 404. POST `/graphql` still accepts queries.

### Create a todo

```graphql
mutation {
    createTodo(input: { title: "Buy groceries", description: "Milk, eggs, bread" }) {
        id
        info {
            title
            description
            completed
        }
    }
}
```

### List todos

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
    updateTodo(input: { id: "your-todo-id-here", completed: true }) {
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
    deleteTodo(input: { id: "your-todo-id-here" })
}
```

## Your Project Structure

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

Components define data. Archetypes group them. Services expose them.

## What's Next

- **[Entities and components](../core-concepts/index.md)** -- `get()` vs throw, `saveMany`, queries
- **[Archetypes](../core-concepts/archetype.md)** -- relations and computed fields
- **[Examples](../examples.md)** -- REST auth, hooks, transactions
- **[Middleware](../middleware.md)** -- what is already installed, and how to add your own
