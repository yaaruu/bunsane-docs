---
sidebar_position: 6
sidebar_label: Quick Reference
---

# Quick Reference

Cheat sheet for `main` (0.8.0 + unreleased 0.9). npm `latest` is 0.6.1. Full rules: [Overview](./index.md).

## Imports

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
  uploadResponse,
  uploadErrorResponse,
  rateLimit,
} from "bunsane";
```

Not on the barrel:

```typescript
import { Get, Post, Put, Delete, Patch } from "bunsane/service";
import { getDb, closeDatabase } from "bunsane/database";
import { dbTransaction } from "bunsane/database/gateway";
import { IndexedField } from "bunsane/core/decorators/IndexedField";
import { ReadModel, Project } from "bunsane/core/readmodel";
import { Upload, initializeS3Storage } from "bunsane/upload";
import { S3StorageProvider } from "bunsane/storage/S3StorageProvider";
import { Middleware } from "bunsane/gql/middleware";
import { isFieldRequested } from "bunsane/gql/helpers";
import { ComponentLoadError, ComponentMissingError } from "bunsane/core/Entity";
import { LengthRequiredError } from "bunsane/core/app/bodyLimit";
import { Enum } from "bunsane/core/metadata";
import type { ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import type { GraphQLContext } from "bunsane/types/graphql.types";
```

`ServiceRegistry.registerService(service)`. Not `register()`. `BatchLoader` is removed.

## tsconfig

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

`emitDecoratorMetadata` is what makes a `number` field a numeric key (`bunsane_num_v1`). A `Date` is always a text key (`data->>'field'`). There is no date key. Bun `>= 1.1.0`.

## Decorators

| Decorator | On | Effect |
|-----------|----|--------|
| `@Component` | class | Registers the component. No options. |
| `@CompData({ indexed?, nullable?, arrayOf? })` | field | JSON key. `indexed: true` on a scalar → `bk_` key index (0.9, unreleased). On `arrayOf` → GIN. |
| `@CompositeIndex(["a", "b"])` | class | `(a, b, entity_id)`. Equality on leading fields, sort on the next. Root export. |
| `@IndexedField("gin" \| "btree" \| "hash" \| "numeric" \| "fulltext")` | field | Default is `"gin"`, not a sort key. Deep import. |
| `@ArcheType("Name")` | class | GraphQL type. Name optional. |
| `@ArcheTypeField(Ctor, { nullable? })` | field | Component on the type. |
| `@ArcheTypeFunction({ returnType, batch? })` | method | Scalars: `"string"` `"number"` `"boolean"` `"Date"`. Not `"String"` / `"Float"`. |
| `@HasMany` `@HasOne` `@BelongsTo` `@BelongsToMany` | field | `foreignKey: "component.prop"` unless exactly one `user_id` or `parent_id` matches. |
| `@GraphQLOperation({ type, input, output })` | method | `type` is `"Query"` or `"Mutation"`. |
| `@GraphQLSubscription` | method | Same input inference. |
| `@ScheduledTask({ interval, maxEntitiesPerExecution? })` | method | No cap → 1000 entities. |
| `@Get` `@Post` … | method | `bunsane/service`. |
| `@ReadModel` `@Project` | class / field | `bunsane/core/readmodel`. Tables are `m3_*`. |
| `@Upload` | method parameter | `bunsane/upload`. Not an archetype field. |

Do not call `registerFieldResolvers`. Schema build attaches resolvers.

## Entity

```typescript
const entity = Entity.Create()
  .add(NameComponent, { value: "Ada" });
await entity.save();

const found = await Entity.FindById(id);          // null if missing
const name = await entity.get(NameComponent);     // null if absent; throws ComponentLoadError on DB failure
await entity.set(NameComponent, { value: "Grace" });
entity.remove(NameComponent);                     // true even if not loaded; save() deletes the row
await entity.save();
await entity.delete();

await Entity.saveMany([entity]);
const present = await entity.hasPersisted(NameComponent);
```

`get()` returns a snapshot. Mutating it does nothing. `has()` is memory-only.

## Query chain

```typescript
const q = new Query()
  .with(UserTag)
  .with(ProfileComponent, Query.filters(
    Query.filter("city", FilterOp.EQ, "Paris"),
    Query.filter("score", FilterOp.GTE, 10),
  ))
  .without(SoftDeletedTag)          // never QSP
  .sortBy(ProfileComponent, "score", "DESC")
  .eagerLoadComponents([ProfileComponent])
  .populate()                       // use the return value for the loaded type
  .take(20);                        // not .limit()

const rows = await q.exec();
q.getLastRouteInfo();
// { routed, surface: "rm" | "legacy", hasNextPage?, truncatedByDefaultLimit?, entitySortPlan? }

await q.count();                    // ignores take/offset
```

`or([...])` as `.with(or([...]))`. Cannot combine with `groupBy`.

Scalar totals (component must be in `.with()`; no `.groupBy()`):

```typescript
await new Query().with(OrderAmountComponent).sum(OrderAmountComponent, "amount");
await new Query().with(OrderAmountComponent).average(OrderAmountComponent, "amount");
// Promise<number>, 0 if nothing matches
```

Grouped aggregates (throw if you skip `.groupBy()`):

```typescript
await new Query()
  .with(OrderInfoComponent)
  .with(OrderAmountComponent)
  .groupBy(OrderInfoComponent, "customerId")
  .sumBy(OrderAmountComponent, "amount");
// also countBy(), maxBy(Ctor, field, { cast: "numeric" }), minBy(), avgIntervalMinutesBy(Ctor, start, end)
```


Cross-entity: `ReadModel(InvoiceReport).where("status", "paid").orderBy("total", "DESC").limit(20).listPage()`. `.rows()` / `.listPage()` throw if limit or offset is set without `.orderBy()` (0.8+).

## FilterOp

`FilterOp` and `Query.filterOp` are the same object.

| Name | SQL |
|------|-----|
| `EQ` `NEQ` | `=` `!=` |
| `GT` `GTE` `LT` `LTE` | `>` `>=` `<` `<=` |
| `LIKE` `ILIKE` | pattern. Leading `%` does not seek a key index. `ILIKE` is not a QSP op. |
| `IN` `NOT_IN` | empty `IN` → `FALSE`, empty `NOT_IN` → `TRUE` |
| `IS_NULL` `IS_NOT_NULL` | missing key, JSON `null`, or `''` |
| `CONTAINS` `CONTAINED_BY` `HAS_ANY` `HAS_ALL` | JSON array. GIN, not a key index. Not QSP. |

Booleans compare to the text `'true'`. Numeric compares use `bunsane_num_v1`. Non-numeric text is NULL (0.9, unreleased).

## Pagination

```typescript
const token = Query.encodeSortedCursor(value, entityId);          // one key
const multi = Query.encodeSortedCursor([status, total], entityId); // width must match sortBy count

await new Query()
  .with(ProfileComponent)
  .sortBy(ProfileComponent, "createdAt", "DESC")
  .take(20)
  .sortedCursor(token, "before") // or "after" (default)
  .exec();
```

Throws:

- `.sortedCursor()` with no sort
- token width ≠ sort-key count
- `.cursor(id)` combined with `sortBy`, `sortByCreatedAt`, or `sortByUpdatedAt`

Legacy `.take(N)` sets `hasNextPage`. The default limit does not, unless the exec was QSP-routed (`surface: 'rm'`), which sets it whenever a limit is applied. Tie-break follows the sort direction (0.9, unreleased): DESC ties use `entity_id DESC`.

`sortByCreatedAt().with(X)` when X is clustered in time is not index-driven. Use QSP for that list.

Unbounded `exec()` that fills `BUNSANE_DEFAULT_QUERY_LIMIT` (10000) throws in `NODE_ENV=development`.

## `t.*` inputs

Top-level `input` is a record of builders, not `t.object()`.

```typescript
const input = {
  id: t.id().required(),
  name: t.string().minLength(2).maxLength(100).required(),
  email: t.string().email().required(),
  role: t.enum(["admin", "user"], "UserRole").required(),
  tags: t.list(t.string()),
  address: t.object({ city: t.string().required() }, "AddressInput"),
};

@GraphQLOperation({ type: "Mutation", input, output: "User" })
async createUser(args: InferInput<typeof input>): Promise<unknown> | unknown {
  return Entity.FindById(args.id);
}
```

Optional until `.required()`. No `t.date()` — pass `t.string()` and parse ISO. Zod and `{ field: "String!" }` inputs still run and warn. Names must be GraphQL identifiers.

`output`: archetype class or instance, an array of those, a type name (`"User"`, `"Boolean"`, `"String"`, `"Int"`, `"Float"`), or a field map (`{ nodes: "[User!]!", hasNextPage: "Boolean!" }`). Anything else throws at schema build.

## Minimal app

```typescript
import "reflect-metadata";
import { App, BaseService, Entity, GraphQLOperation, ServiceRegistry, t, type InferInput } from "bunsane";

const pingInput = { name: t.string().required() };

class PingService extends BaseService {
  @GraphQLOperation({ type: "Query", input: pingInput, output: "String" })
  ping(input: InferInput<typeof pingInput>): Promise<unknown> | unknown {
    return `hello ${input.name}`;
  }
}

const app = new App("MyAPI", "1.0.0");
app.setCors({ origin: "https://app.example.com" });
ServiceRegistry.registerService(new PingService());
await app.init();
```

`init()` migrates and listens unless `NODE_ENV=test`. GraphQL is `/graphql`. Liveness is `/health` (write probe).

## Security defaults

| Default | What you do |
|---------|-------------|
| CORS `origin` required | `setCors({ origin })`. `credentials: true` + `"*"` throws. |
| JSON body 1 MB | 413 over `Content-Length`. `setJsonBodyLimit` / `JSON_BODY_LIMIT`. |
| Multipart 50 MB, 411 without `Content-Length` | Browsers send it. In-process `FormData` requests must set it. |
| Depth 15, complexity 1000 | Floors. `0` does not disable. |
| Introspection and GraphiQL off | On in `NODE_ENV=development`, or `GRAPHQL_INTROSPECTION=on` / `GRAPHQL_GRAPHIQL=on`. |
| `/metrics`, `/health/remote`, `/docs`, `/openapi.json` | No token and not `=public` → 404. Token set, header missing or wrong → 401. |
| HSTS off | `BUNSANE_HSTS=on` or `BUNSANE_TLS=on`. Not implied by `NODE_ENV=production`. |
| `requestId` + `securityHeaders` on | `setRequestId(false)` / `setSecurityHeaders(false)` before start. |

`enableStudio()` without a ≥ 16 character token refuses. `app.use()` after `start()` throws.

## Env vars most apps set

Full list: [Configuration](../configuration.md).

| Variable | Why |
|----------|-----|
| `DB_CONNECTION_URL` or `POSTGRES_HOST` + `POSTGRES_USER` + `POSTGRES_DB` | Required to boot. |
| `APP_PORT` | Default 3000. |
| `NODE_ENV` | `development` throws on unbounded `exec()`, enables GraphiQL. |
| `DB_DISABLE_PREPARE=true` | Required behind PgBouncer transaction pooling. Do not set it for the test suite. |
| `DB_REQUEST_TIMEOUT` | Request-lane deadline in ms. Unset inherits `DB_QUERY_TIMEOUT` (30000). Set a few seconds if you want shedding. |
| `BUNSANE_CACHE_INVALIDATION_SECRET` | Required on every instance or cross-instance L1 invalidation stays off. |
| `BUNSANE_QSP` | `off` (default), `shadow`, or `route`. |
| `GRAPHQL_INTROSPECTION` / `GRAPHQL_GRAPHIQL` | `on` / `off`. Otherwise follow `NODE_ENV`. |
| `BUNSANE_METRICS_TOKEN` / `BUNSANE_DOCS_TOKEN` | Open `/metrics` and `/docs`. Or `=public`. |
| `JSON_BODY_LIMIT` / `MULTIPART_BODY_LIMIT` | Defaults 1 MB / 50 MB. |
| `BUNSANE_HSTS` / `BUNSANE_TLS` | `on` to send HSTS. |
| `REDIS_TLS` | `true` opens TLS (0.8+). |
| `BUNSANE_DEFAULT_QUERY_LIMIT` | Default 10000. `0` disables. |
| `BUNSANE_INDEX_SYNC_MAX_ROWS` | Default 100000. Larger tables build `bk_` indexes in the background (0.9, unreleased). |
| `BUNSANE_ENTITY_SORT_PROBE` | Default 5000. Cap for `sortByCreatedAt().with(X)` (0.9, unreleased). |

Invalid `BUNSANE_INDEX_SYNC_MAX_ROWS` or `BUNSANE_ENTITY_SORT_PROBE` fails `init()`.

## Gotchas

```typescript
import { dbTransaction } from "bunsane/database/gateway";

await entity.set(NameComponent, data);
await entity.save(); // set() does not persist

await dbTransaction(async (trx) => {
  const row = await Entity.FindById(id, trx);
  await row?.save(trx);
});

const token = Query.encodeSortedCursor(value, entity.id);
await q.sortBy(ProfileComponent, "score", "DESC").sortedCursor(token, "before").exec();
```

The default `db` export is a lazy proxy. `import { getDb } from "bunsane/database"` when you need the SQL instance.


- `@HasOne` is nullable unless `nullable: false`.
- Entity hooks, sync or `async: true`, run after `save()` commits (microtask). `save()` does not wait. `set()` does await `component.updated`.
- Negative component cache defaults to on. A tombstone is absence, not a DB error.
- `REDIS_TLS=true` is real TLS.
- Second `start()` does not rebind.
