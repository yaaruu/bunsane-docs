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
import { BaseComponent, CompData, Component, Entity } from "bunsane";

@Component
export class NameComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

@Component
export class EmailComponent extends BaseComponent {
    @CompData()
    value: string = "";
}

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
- **Built-in middleware** -- Request IDs and security headers are on by default
- **Caching, scheduling, and more** -- Production-ready features included

:::caution Experimental

BunSane is in an experimental stage and under active development. The API may change between versions. Feedback, suggestions, and contributions are welcome!

:::

## Version

These pages describe `main`: package **0.8.0** plus unreleased **0.9** list-read work. npm `latest` is **0.6.1**. v0.7.0 and v0.8.0 are tagged on GitHub. If you already have an app, read [Upgrading](./upgrading.md) before you change code.

What changed for app authors:

- **0.7:** import the [root barrel](./getting-started/index.md) (`"bunsane"`). Define operation inputs with `t.*`. Schema build fails on a bad output instead of emitting `String`. `entity.get()` returns `null` only when the component is absent; a database failure throws. JSON bodies default to 1 MB. Introspection and GraphiQL are on only in development.
- **0.8:** a multipart request without `Content-Length` returns 411. A relation without `foreignKey` must match exactly one `user_id` or `parent_id`. `@HasOne` is nullable unless you set `nullable: false`. Batched `@ArcheTypeFunction` and sorted-cursor pagination.
- **0.9 (unreleased):** a scalar `@CompData({ indexed: true })` creates a key index (`bk_`), not a GIN index. Sorted list reads can stop at the page size when that field is indexed.

## Next Steps

- **[Get started](./getting-started/index.md)** — Install BunSane and build your first app
- **[Core Concepts](./core-concepts/index.md)** — Entities, components, and queries
- **[List queries](./query-lists.md)** — Filter, sort, paginate, avoid N+1 (`hasNextPage`, `sortedCursor`)
- **[Query aggregates](./query-aggregates.md)** — `groupBy` / `countBy` / `sumBy` / `maxBy` / `IS_NULL`
- **[Read models](./read-models.md)** — `@ReadModel` derived tables (`m3_*`)
- **[QSP](./qsp.md)** — Optional list accelerator (`rm_*`)
- **[Query optimization](./ai-guide/query-optimization.md)** — Patterns for services and AI agents
- **[Configuration](./configuration.md)** — Environment variables (DB, pool, QSP)
- **[Examples](./examples.md)** — Complete working applications
- Example apps on GitHub: [buroq-api](https://github.com/yaaruu/buroq-api)
