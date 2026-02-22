---
sidebar_position: 1
---

# Welcome to BunSane

BunSane is a TypeScript framework for building APIs with [Bun](https://bun.sh/). It gives you a structured way to store data, write business logic, and expose it all through GraphQL and REST -- with minimal boilerplate.

## The Core Idea

In BunSane, your data is organized around three simple concepts:

- **Entities** are the "things" in your app -- a user, an order, a product. Each entity is just a unique ID.
- **Components** are pieces of data you attach to an entity -- a name, an email address, a price. You define them as TypeScript classes.
- **Services** are where your business logic lives. They expose your data through GraphQL queries, mutations, and REST endpoints.

Here is a quick taste of what that looks like:

```typescript
// A component holds a piece of data
@Component
export class EmailComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

// Create an entity and attach components
const user = Entity.Create()
    .add(NameComponent, { value: "Alice" })
    .add(EmailComponent, { value: "alice@example.com" });

await user.save();
```

BunSane handles the database tables, the GraphQL schema generation, and the plumbing so you can focus on what your app actually does.

## What You Get

- **Automatic database setup** -- BunSane creates and manages PostgreSQL tables for you
- **GraphQL out of the box** -- Define your operations with decorators, get a full GraphQL API
- **REST endpoints** -- Add REST routes alongside GraphQL when you need them
- **Built-in middleware** -- Request IDs, access logging, security headers
- **Caching, scheduling, and more** -- Production-ready features included

:::caution Experimental

BunSane is in an experimental stage and under active development. The API may change between versions. Feedback, suggestions, and contributions are welcome!

:::

## Next Steps

- **[Get started](/docs/getting-started)** -- Install BunSane and build your first app
- **[Core Concepts](/docs/core-concepts)** -- Learn about entities, components, and queries
- **[Examples](/docs/examples)** -- See complete working applications
- Check out the [example project on GitHub](https://github.com/yaaruu/buroq-api)
