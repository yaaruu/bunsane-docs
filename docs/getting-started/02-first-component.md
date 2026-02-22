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

This approach is flexible: you can attach any combination of components to any entity, and you can add or remove components over time.

## Defining a Component

Create a file at `src/components/UserComponent.ts`:

```typescript title="src/components/UserComponent.ts"
import { Component, BaseComponent, CompData } from "bunsane/core/components";

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

- **`@Component`** registers the class with BunSane so it knows to create a database table for it
- **`extends BaseComponent`** gives the component its internal ID and lifecycle methods
- **`@CompData()`** marks a field as stored data -- fields without this decorator are not persisted
- **`{ indexed: true }`** creates a database index on this field for faster lookups

## What Is a Tag?

A **Tag** is a component with no data. It is used to label entities so you can find them by type.

```typescript
@Component
export class UserTag extends BaseComponent {}
```

Tags are useful for queries. For example, to find "all users", you query for entities that have a `UserTag` attached. You will see this in action when you build a service.

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

Group related data into one component. Use separate components for data that changes independently or that not every entity needs.

## Register Your Components

For BunSane to discover your components, you need to import them in your App class. This ensures the `@Component` decorators execute during startup.

```typescript title="src/App.ts"
import App from "bunsane/core/App";

// Import components so decorators are executed
import "./components/UserComponent";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "0.1.0");
    }
}
```

When your app starts, BunSane automatically creates the database tables for each component.

## What's Next

Now that you know how to define components, let's group them into a meaningful shape. In the next section, you will create your first **Archetype** -- a named group of components that automatically becomes a GraphQL type.
