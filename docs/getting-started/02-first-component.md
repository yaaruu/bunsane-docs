---
sidebar_position: 3
sidebar_label: Your First Component
---

# Your First Component

Components are the building blocks of data in BunSane. Every piece of information in your app -- a user's name, an email address, a password -- is stored as a component attached to an entity.

## What Is a Component?

Think of an **Entity** as just an ID -- it represents a "thing" in your app (a user, an order, a product). By itself, an entity holds no data.

A **Component** is a piece of data you attach to an entity. For example, a "User" entity might have:

- A `NameComponent` storing the user's name
- An `EmailComponent` storing the email address
- A `PasswordComponent` storing the hashed password

You can attach any combination of components to any entity, and you can add or remove components over time.

## Defining a Component

Create `src/components/UserComponent.ts`:

```typescript title="src/components/UserComponent.ts"
import { BaseComponent, CompData, Component } from "bunsane";

@Component
export class NameComponent extends BaseComponent {
    @CompData()
    value!: string;
}

@Component
export class EmailComponent extends BaseComponent {
    @CompData({ indexed: true })
    value!: string;

    @CompData()
    verified: boolean = false;
}

@Component
export class PasswordComponent extends BaseComponent {
    @CompData()
    value!: string;
}
```

Here is what each part does:

- **`@Component`** registers the class so BunSane creates a table (or partition) for it. The decorator takes no options.
- **`extends BaseComponent`** gives the component its id and lifecycle methods.
- **`@CompData()`** marks a field as stored data. Fields without it are not persisted.
- **`{ indexed: true }`** creates a **key index** (0.9, unreleased) when the field is not an array: `bk_<slug>_<hash>` on `(data->>'field', entity_id)`. It is not a GIN index. Only `arrayOf` fields get GIN from `indexed: true`. An object field gets a text key index; use `@IndexedField("gin")` from `"bunsane/core/decorators/IndexedField"` if you need GIN. Index the fields you filter or sort by. See [List queries](../query-lists.md).

`nullable: true` stores the field as optional. The default is required.

`emitDecoratorMetadata` is required. BunSane reads `design:type` to detect `Date` and `number`. On read, a valid ISO string in a `Date` field comes back as a `Date` (0.7+). An invalid string is left as a string so a later `save()` can reject it.

## What Is a Tag?

A **Tag** is a component with no data. It labels entities so you can find them by type.

```typescript
@Component
export class UserTag extends BaseComponent {}
```

To find "all users", query for entities that have `UserTag`. You will use that in a service.

## Components with Multiple Fields

A single component can hold several related fields:

```typescript
@Component
export class AddressComponent extends BaseComponent {
    @CompData()
    street!: string;

    @CompData()
    city!: string;

    @CompData()
    country!: string;

    @CompData()
    zip!: string;
}
```

Group related data into one component. Use separate components for data that changes independently, or that not every entity needs.

## Register Your Components

Import component files from your App class so the `@Component` decorators run at startup:

```typescript title="src/App.ts"
import "reflect-metadata";
import { App } from "bunsane";

import "./components/UserComponent";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "0.1.0");
        this.setCors({ origin: "http://localhost:5173" });
    }
}
```

`init()` creates the tables. You do not write migrations for ordinary component fields.

## What's Next

Next you group these components into an archetype. That named shape becomes a GraphQL type.
