---
sidebar_position: 4
sidebar_label: Your First Archetype
---

# Your First Archetype

In the previous section you defined components -- individual pieces of data. But in practice, you usually work with a group of components together. A "Todo" is not just a title or a status; it is a title *and* a description *and* a completed flag, all at once.

That is what an **Archetype** does: it groups related components into a named shape and automatically generates a GraphQL type from it.

## Define Todo Components

First, create the components for a todo item. Create `src/components/TodoComponent.ts`:

```typescript title="src/components/TodoComponent.ts"
import { Component, BaseComponent, CompData } from "bunsane/core/components";

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

`TodoTag` is a tag (empty component) that labels an entity as a "todo". `TodoInfoComponent` holds the actual data.

## Create the Archetype

Now create `src/archetypes/TodoArcheType.ts`:

```typescript title="src/archetypes/TodoArcheType.ts"
import {
    ArcheType,
    ArcheTypeField,
    BaseArcheType,
    type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { TodoTag, TodoInfoComponent } from "../components/TodoComponent";

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

Here is what each part does:

- **`@ArcheType("Todo")`** registers this archetype with the name "Todo" -- this becomes the GraphQL type name
- **`@ArcheTypeField(TodoInfoComponent)`** maps a component to a field on the archetype
- **`ArcheTypeOwnProperties<T>`** extracts a TypeScript type for the archetype's data, useful for type-safe function signatures
- **`new TodoArcheTypeClass()`** creates a singleton instance you'll use in your service

## What This Gives You

By defining this archetype, BunSane will automatically generate:

```graphql
type Todo {
    tag: TodoTag!
    info: TodoInfoComponent!
}

input TodoInput {
    tag: TodoTagInput!
    info: TodoInfoComponentInput!
}
```

You did not write any GraphQL schema by hand -- it is all derived from your TypeScript classes.

## Register the Component

Don't forget to import the component file in your App class so the `@Component` decorators run at startup:

```typescript title="src/App.ts"
import App from "bunsane/core/App";

// Import components so decorators are executed
import "./components/TodoComponent";

export default class MyAPI extends App {
    constructor() {
        super("TodoAPI", "0.1.0");
    }
}
```

## What's Next

You have an archetype that defines the shape of a Todo, but there is no way to create, read, update, or delete todos yet. In the next section, you will build a **Service** that exposes CRUD operations through GraphQL.
