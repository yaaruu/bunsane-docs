---
sidebar_position: 1
sidebar_label: Overview
---

# BunSane AI Agent Guide

Rules for writing BunSane application code. These pages describe `main`: package 0.8.0 plus the unreleased 0.9 index-driven list reads. npm `latest` is 0.6.1. v0.7.0 and v0.8.0 are tagged on GitHub.

Mark a behavior only when the release matters: `(0.7+)`, `(0.8+)`, `(0.9, unreleased)`. Cutover notes: [Upgrading](../upgrading.md).

## Framework overview

BunSane is a TypeScript API framework for Bun. You store data as entities and components in PostgreSQL, and you expose it through decorated services. The framework generates the GraphQL schema from those decorators.

| Concept | What it is |
|---------|------------|
| **Entity** | A UUID container. Create with `Entity.Create()`, persist with `save()`. |
| **Component** | A flat JSONB document on that component's partition. Attach it with `add` / `set`. |
| **Archetype** | A typed view over components. Generates the GraphQL type, relations, and computed fields. |
| **Service** | Business logic. `@GraphQLOperation` and HTTP decorators become endpoints. |
| **Query** | Finds entities by the components they have. Chain `.with()`, filters, `.sortBy()`, `.take()`, `.exec()`. |
| **Key index** | A `bk_` index on a scalar you filter or sort. Created from `@CompData({ indexed: true })` (0.9, unreleased). |
| **Query aggregates** | SQL `GROUP BY` / `SUM` / `MAX` on one entity. [Guide](../query-aggregates.md). |
| **Read model** | Cross-entity table `m3_*`. [Guide](../read-models.md). |
| **QSP** | Optional `rm_*` accelerator for a covered list. Not a join store. [Guide](../qsp.md). |

```
GraphQL / REST
    Services          UserService, OrderService
    Archetypes        User, Order  (+ relations, computed fields)
    Entity + components
    PostgreSQL        component partitions, bk_ indexes, optional rm_* / m3_*
```

## Imports

Prefer the root barrel. Importing `"bunsane"` does not open a pool and does not construct Yoga.

```typescript
import {
  App,
  Entity,
  BaseComponent,
  Component,
  CompData,
  CompositeIndex,
  BaseArcheType,
  ArcheType,
  ArcheTypeField,
  ArcheTypeFunction,
  HasMany,
  HasOne,
  BelongsTo,
  BelongsToMany,
  Query,
  or,
  FilterOp,
  BaseService,
  ServiceRegistry,
  GraphQLOperation,
  GraphQLSubscription,
  t,
  type InferInput,
  logger,
  withLock,
  ScheduledTask,
  handleUpload,
  rateLimit,
} from "bunsane";
```

`ServiceRegistry` on the barrel is the singleton. Call `registerService()`, not `register()`.

Use a deep path only when the barrel does not export the symbol:

| Symbol | Import |
|--------|--------|
| `Get`, `Post`, `Put`, `Delete`, `Patch` | `bunsane/service` |
| `db`, `getDb`, `closeDatabase` | `bunsane/database` |
| `dbTransaction` | `bunsane/database/gateway` |
| `IndexedField` | `bunsane/core/decorators/IndexedField` |
| `ReadModel`, `Project` | `bunsane/core/readmodel` |
| `Upload`, `initializeS3Storage` | `bunsane/upload` |
| `S3StorageProvider` | `bunsane/storage/S3StorageProvider` |
| `Middleware` | `bunsane/gql/middleware` |
| `isFieldRequested` | `bunsane/gql/helpers` |
| `ComponentLoadError`, `ComponentMissingError` | `bunsane/core/Entity` |
| `LengthRequiredError` | `bunsane/core/app/bodyLimit` |
| `Enum` | `bunsane/core/metadata` |
| `GraphQLContext` | `bunsane/types/graphql.types` |

`BatchLoader` is removed (0.7+). Do not import it.

The default `db` export is a lazy proxy. `db === getDb()` is false, and `db instanceof SQL` is false. Use `getDb()` when you need the instance. Prefer `dbTransaction` for your own transactions so admission applies. See [Database](../database.md).

## Project layout

```
src/
├── components/
├── archetypes/
├── services/
└── App.ts
```

Import every component and archetype module from `App.ts` (or the entry file) so the decorators run before `init()`.

`experimentalDecorators` and `emitDecoratorMetadata` are required. Without metadata, a `number` field is not detected and its key index stays text (`data->>'field'`) instead of `bunsane_num_v1()`. A `Date` is always a text key. There is no date key.

## When to split a component

Create a new component when the data is a separate concept, is queried on its own, or changes on a different cadence.

Add fields to an existing component when you always read and write them together.

Use an empty **tag** component for membership (`AdminTag`, `SoftDeletedTag`). A tag has no `@CompData` fields. Including a tag in `.with()` breaks [QSP](../qsp.md) coverage. For a hot list, project the flag as a real field on a data component instead.

## Which read API

| You need | Use |
|----------|-----|
| A page of entities | `Query` + `.take(N)` + `sortedCursor`. [Lists](../query-lists.md). |
| A total, last event, or histogram on one entity | `groupBy` + `sumBy` / `maxBy` / `countBy`. [Aggregates](../query-aggregates.md). |
| A join across two entity types | `@ReadModel` (`m3_*`). [Read models](../read-models.md). |
| The same covered list, faster | `BUNSANE_QSP=route`. [QSP](../qsp.md). |

Do not `exec()` a large set and reduce it in JavaScript.

## Document index

1. [Component best practices](./component-best-practices.md) — shape, key indexes, `@CompositeIndex`
2. [Query optimization](./query-optimization.md) — filters, keyset pagination, N+1, aggregates
3. [Service patterns](./service-patterns.md) — `t.*` inputs, relations, uploads, security defaults
4. [Common patterns](./common-patterns.md) — entities, transactions, batch computed fields
5. [Quick reference](./quick-reference.md) — cheat sheet
6. [List queries](../query-lists.md) · [Query aggregates](../query-aggregates.md) · [Read models](../read-models.md) · [QSP](../qsp.md)
7. [GraphQL](../graphql.md) · [Database](../database.md) · [Configuration](../configuration.md) · [Upgrading](../upgrading.md)

## Rules that change generated code

1. **Import from `"bunsane"`** for anything the barrel exports. Deep paths are for the table above.
2. **Operation inputs are a `t.*` record.** Fields are optional until `.required()`. Zod and `{ field: "String" }` inputs still run and log a deprecation warning. There is no `t.date()`.
3. **Do not call `registerFieldResolvers`.** Schema build attaches field, relation, and `@ArcheTypeFunction` resolvers (0.7+). The call remains and is idempotent.
4. **`get()` returns `null` only for confirmed absence.** A database, timeout, or admission failure throws `ComponentLoadError` (0.7+). `null` is not an error. The value is a snapshot; mutating it does nothing. Persist with `set()` + `save()`.
5. **Index every scalar you filter or sort** with `@CompData({ indexed: true })`. That is a `bk_` key index, not a GIN index (0.9, unreleased). Equality-then-sort needs `@CompositeIndex`. Arrays stay GIN.
6. **Sorted pages use `sortedCursor`.** `.cursor(id)` throws if any `sortBy`, `sortByCreatedAt`, or `sortByUpdatedAt` is set. The token width must match the sort-key count (0.8+). `'before'` is supported.
7. **Bound every `exec()`.** On the legacy path, `.take(N)` sets `hasNextPage`. A QSP-routed exec sets it too, even without `.take()`. An unbounded `exec()` that fills `BUNSANE_DEFAULT_QUERY_LIMIT` (default 10000) throws when `NODE_ENV=development` (0.7+). There is no `Query.limit()`.
8. **Relations need an unambiguous foreign key** (0.8+). Omit `foreignKey` only when exactly one `user_id` or `parent_id` property matches. Otherwise set `foreignKey: "component.prop"`. `@HasOne` is nullable unless `nullable: false`.
9. **List computed fields that hit the database should be `@ArcheTypeFunction({ batch: true })`** (0.8+). The method receives every parent in the request and returns a `Map` keyed by entity id.
10. **Security defaults are on.** CORS `origin` is required when you call `setCors`. Non-multipart bodies default to 1 MB. Multipart without `Content-Length` is 411 (0.8+). `/metrics`, `/health/remote`, `/docs`, and `/openapi.json` are 404 when no token is configured and the surface is not `=public`. With a token set, a missing or wrong header is 401. Introspection and GraphiQL are off outside `NODE_ENV=development`.
11. **Call `save()`** after `add` / `set` / `remove`. `remove()` of a component you have not loaded still returns `true` and deletes the row on `save()` (0.7+).
12. **Tie order follows the sort direction** (0.9, unreleased). A DESC sort breaks ties with `entity_id DESC`. Non-numeric text in a numeric field sorts and filters as NULL, not as a cast error.
