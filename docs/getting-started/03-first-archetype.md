---
sidebar_position: 4
sidebar_label: Your First Archetype
---

# Your First Archetype

In the previous section you defined components -- individual pieces of data. In practice you usually work with a group of them. A "Todo" is a title *and* a description *and* a completed flag.

An **archetype** names that group and generates a GraphQL type from it.

## Define Todo Components

Create `src/components/TodoComponent.ts`:

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

`TodoTag` labels the entity as a todo. `TodoInfoComponent` holds the data. `createdAt` is a key-indexed `Date`, so you can sort lists by it. See [List queries](../query-lists.md).

## Create the Archetype

Create `src/archetypes/TodoArcheType.ts`:

```typescript title="src/archetypes/TodoArcheType.ts"
import { ArcheType, ArcheTypeField, BaseArcheType } from "bunsane";
import { TodoInfoComponent, TodoTag } from "../components/TodoComponent";

@ArcheType("Todo")
export class TodoArcheTypeClass extends BaseArcheType {
    @ArcheTypeField(TodoTag)
    tag!: TodoTag;

    @ArcheTypeField(TodoInfoComponent)
    info!: TodoInfoComponent;
}

export const TodoArcheType = new TodoArcheTypeClass();
```

- **`@ArcheType("Todo")`** registers the name used as the GraphQL type. You can also pass `{ name: "Todo" }`.
- **`@ArcheTypeField`** maps a component onto a field. `{ nullable: true }` means that component may be missing.
- Export an **instance**. Pass that instance as `output` on `@GraphQLOperation`.

You do not call `registerFieldResolvers`. Since 0.7, schema build attaches field, relation, and function resolvers. The method still exists and is idempotent if you already call it.

Relations, computed fields, and the foreign-key rule are covered in [Archetypes](../core-concepts/archetype.md).

## What This Gives You

BunSane weaves an output type. It does not emit `TodoInput`. A tag with no `@CompData` fields is omitted. Nested component type names lower-case the first character of the class name:

```graphql
type Todo {
    id: ID
    info: todoInfoComponent!
}

type todoInfoComponent {
    title: String!
    description: String!
    completed: Boolean!
    createdAt: Date
}
```

Operation inputs are separate: `@GraphQLOperation` creates `createTodoInput`, not an archetype input type. `id` is `ID` only on the archetype's own id field (0.7+). A component property named `id` with type `string` stays `String`. A `Date` field is the `Date` scalar only because the property type is `Date`, not because the name ends in `At`.

## Register the Component

Import the component file from your App so the decorators run:

```typescript title="src/App.ts"
import "reflect-metadata";
import { App } from "bunsane";

import "./components/TodoComponent";

export default class MyAPI extends App {
    constructor() {
        super("TodoAPI", "0.1.0");
        this.setCors({ origin: "http://localhost:5173" });
    }
}
```

## What's Next

The shape exists, but nothing creates or lists todos yet. Next you add a service.
