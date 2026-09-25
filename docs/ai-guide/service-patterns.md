---
sidebar_position: 4
sidebar_label: Service Patterns
---

# Service Patterns

How to expose entities over GraphQL and HTTP. Operation inputs use `t.*`. Schema build attaches archetype resolvers — you do not call `registerFieldResolvers`.

Related: [GraphQL](../graphql.md) · [List queries](../query-lists.md) · [Configuration](../configuration.md) · [Upgrading](../upgrading.md)

## Register a service

```typescript
import "reflect-metadata";
import { App, BaseService, ServiceRegistry } from "bunsane";
import UserService from "./services/UserService";
import "./components/UserComponent";
import "./archetypes/UserArcheType";

const app = new App("MyAPI", "1.0.0");
ServiceRegistry.registerService(new UserService());
await app.init();
```

`init()` validates env, migrates, builds the schema, arms the DB gateway, and listens unless `NODE_ENV=test`. A second `start()` is a no-op. `use()` after `start()` throws — register middleware in the constructor or before `init()`.

`ServiceRegistry` from `"bunsane"` is the singleton. The method is `registerService()`. Inject `App` only when the service publishes on `app.pubSub` or reads config. It is not required for field resolvers.

## Operation inputs are `t.*`

Pass a record whose values are `t.*` builders. That record is what the decorator infers. Do not wrap the top-level input in `t.object()` — use `t.object(shape, name)` only for a nested named input.

Fields are optional until `.required()`. There is no `t.date()`. Pass an ISO string and construct a `Date` in the method.

```typescript
import {
  BaseService,
  Entity,
  GraphQLOperation,
  Query,
  t,
  type InferInput,
} from "bunsane";

const getUserInput = {
  id: t.id().required(),
};

class UserService extends BaseService {
  @GraphQLOperation({
    type: "Query",
    input: getUserInput,
    output: "User",
  })
  async getUser(input: InferInput<typeof getUserInput>): Promise<unknown> | unknown {
    return Entity.FindById(input.id);
  }
}
```

`output: "User"` is the archetype's GraphQL name. A type-name string makes the decorator's return check `unknown`, so annotate the method `Promise<unknown> | unknown` (the [hello-world](https://github.com/yaaruu/bunsane/blob/main/README.md) pattern).

`output` may also be:

- an archetype class, instance, or array of those
- a GraphQL type name: `"String"`, `"Int"`, `"Float"`, `"Boolean"`, `"ID"`
- a field map of GraphQL type strings, which becomes `${Operation}Output`

An unrecognised output throws at schema build. It does not become `String` or `[Any]` (0.7+).

Zod objects and `{ field: "String!" }` maps still run and log a deprecation warning. Do not write new operations that way. `minLength`, `email`, `uuid`, and `pattern` belong on `t.string()`, not in a hand-rolled check that the schema cannot see.

`t.enum(values, name)` needs a name. Names must match `^[A-Za-z_][A-Za-z0-9_]*$` or construction throws (0.8+).

## A list operation

Prefer `hasNextPage` and `sortedCursor` over offset plus an exact count. See [Query optimization](./query-optimization.md).

```typescript
import { Query, t, type InferInput, GraphQLOperation } from "bunsane";

const listUsersInput = {
  pageSize: t.int().min(1).max(100).required(),
  cursor: t.string(),
};

@GraphQLOperation({
  type: "Query",
  input: listUsersInput,
  output: {
    nodes: "[User!]!",
    hasNextPage: "Boolean!",
    nextCursor: "String",
  },
})
async listUsers(input: InferInput<typeof listUsersInput>): Promise<unknown> | unknown {
  let q = new Query()
    .with(UserTag)
    .with(ProfileComponent)
    .sortBy(ProfileComponent, "createdAt", "DESC")
    .eagerLoadComponents([ProfileComponent])
    .take(input.pageSize);

  if (input.cursor) q = q.sortedCursor(input.cursor);

  const nodes = await q.exec();
  const { hasNextPage } = q.getLastRouteInfo();
  const last = nodes[nodes.length - 1];
  const profile = last ? await last.get(ProfileComponent) : null;

  return {
    nodes,
    hasNextPage: hasNextPage ?? false,
    nextCursor:
      hasNextPage && last
        ? Query.encodeSortedCursor(profile?.createdAt ?? null, last.id)
        : undefined,
  };
}
```

`.sortBy(...).cursor(id)` throws. So does `.cursor(id)` combined with `sortByCreatedAt` / `sortByUpdatedAt`.

## Mutations

```typescript
const createUserInput = {
  name: t.string().minLength(2).maxLength(100).required(),
  email: t.string().email().required(),
  phone: t.string(),
};

@GraphQLOperation({
  type: "Mutation",
  input: createUserInput,
  output: "User",
})
async createUser(input: InferInput<typeof createUserInput>): Promise<unknown> | unknown {
  const existing = await new Query()
    .with(
      EmailComponent,
      Query.filters(Query.filter("value", Query.filterOp.EQ, input.email)),
    )
    .take(1)
    .exec();
  if (existing.length > 0) {
    return new GraphQLError("Email already registered", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const user = Entity.Create()
    .add(UserTag, {})
    .add(NameComponent, { value: input.name })
    .add(EmailComponent, { value: input.email, verified: false });
  if (input.phone) {
    user.add(PhoneComponent, { value: input.phone, verified: false });
  }
  await user.save();
  return user;
}
```

`GraphQLError` comes from `"graphql"`. Returning it is the usual resolver pattern. Throwing it also works.

Update by merging into `set()`. `get()` is a snapshot.

```typescript
const updateUserInput = {
  id: t.id().required(),
  name: t.string().minLength(2).maxLength(100),
  phone: t.string(),
};

@GraphQLOperation({
  type: "Mutation",
  input: updateUserInput,
  output: "User",
})
async updateUser(input: InferInput<typeof updateUserInput>): Promise<unknown> | unknown {
  const user = await Entity.FindById(input.id);
  if (!user) {
    return new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
  }
  if (input.name !== undefined) {
    await user.set(NameComponent, { value: input.name });
  }
  if (input.phone !== undefined) {
    const current = await user.get(PhoneComponent);
    await user.set(PhoneComponent, {
      ...(current ?? { verified: false }),
      value: input.phone,
    });
  }
  await user.save();
  return user;
}
```

`Entity.FindById` returns `null` for a blank or unknown id. `get()` returns `null` for a missing component and throws `ComponentLoadError` on a database failure. Do not treat a thrown load as "not found".

For an archetype-shaped body, `getInputSchema()` still returns a Zod object (relations and functions excluded) and `withValidation()` still merges extra Zod fields. Passing that object as `input` logs the Zod deprecation warning. Prefer a `t.*` record, then `fill()`:

```typescript
const user = UserArcheType.fill({
  name: { value: input.name },
  email: { value: input.email, verified: false },
}).createEntity();
await user.save();
```

`fill()` keys are archetype field names, and the values are component data. `updateEntity(entity, updates)` patches the same shape and does not save. You still call `save()`.

## Relations (0.8+)

Omit `foreignKey` only when exactly one `user_id` or `parent_id` property matches on the owning archetype. Zero or several matches fail schema build. The error tells you to set `foreignKey: 'component.prop'`.

The dotted form is the archetype field, then the property. It is not the class name. Camel-case `userId` does not count as the implicit `user_id`.

```typescript
import { ArcheType, ArcheTypeField, BaseArcheType, BelongsTo, HasMany, HasOne } from "bunsane";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(NameComponent)
  name!: NameComponent;

  // Owning side is Order. foreignKey names Order's field, not User's.
  @HasMany(() => OrderArcheTypeClass, { foreignKey: "info.user_id" })
  orders!: IOrderArcheType[];

  // Nullable unless nullable: false. A missing child resolves to null.
  @HasOne(() => DriverArcheTypeClass, { foreignKey: "profile.user_id", nullable: true })
  driver?: IDriverArcheType;
}

@ArcheType("Order")
export class OrderArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(OrderInfoComponent)
  info!: OrderInfoComponent;

  // belongsTo looks up the foreign key on this archetype.
  @BelongsTo(() => UserArcheTypeClass, { foreignKey: "info.user_id" })
  user!: IUserArcheType;
}
```

The target may be a registered name, a class, or `() => Class`. An unregistered target throws at schema build. `@HasMany` / `@HasOne` lists are nullable unless `nullable: false`. `@BelongsTo` stays non-null unless you set `nullable`.

## Batched computed fields (0.8+)

A non-batch `@ArcheTypeFunction` runs once per parent. On a list, that is an N+1 if the body queries. `batch: true` collects the parents for the request (one batch per distinct args) and calls the method once.

```typescript
import { ArcheTypeFunction, Entity } from "bunsane";

@ArcheTypeFunction({ returnType: "number", batch: true })
async openOrderCounts(parents: readonly Entity[]) {
  const ids = parents.map((parent) => parent.id);
  const rows = await new Query()
    .with(OrderInfoComponent, {
      filters: [Query.filter("userId", Query.filterOp.IN, ids)],
    })
    .with(OrderStatusComponent, {
      filters: [Query.filter("value", Query.filterOp.EQ, "open")],
    })
    .groupBy(OrderInfoComponent, "userId")
    .countBy();

  const counts = new Map<string, number>();
  for (const parent of parents) counts.set(parent.id, 0);
  for (const row of rows) {
    counts.set(String(row.userId), Number(row.count));
  }
  return counts;
}
```

Return a `Map` keyed by entity id. A missing key on a non-null field throws for that parent. Scalars are `"string" | "number" | "boolean" | "Date"`. An async method's design return is `Promise`, so `returnType` is required or schema build throws. `"String"` and `"Float"` are not those scalars.

Do not mark a function `batch: true` if it only reads components the request already loaded. The component DataLoader already batches `get()`.

## REST

HTTP decorators are not on the root barrel.

```typescript
import { BaseService } from "bunsane";
import { Get, Post } from "bunsane/service";
import { Entity, Query } from "bunsane";

class ProductService extends BaseService {
  @Get("/v1/products")
  async listProducts(_req: Request) {
    const products = await new Query().with(ProductTag).take(100).exec();
    return Response.json({ data: products.map((product) => ({ id: product.id })) });
  }

  @Get("/v1/products/:id")
  async getProduct(req: Request) {
    const id = new URL(req.url).pathname.split("/").pop();
    const product = id ? await Entity.FindById(id) : null;
    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }
    const info = await product.get(ProductInfoComponent);
    return Response.json({ data: { id: product.id, ...info } });
  }

  @Post("/v1/products")
  async createProduct(req: Request) {
    const body: unknown = await req.json();
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { name?: unknown }).name !== "string"
    ) {
      return Response.json({ error: "Invalid body" }, { status: 400 });
    }
    const product = Entity.Create()
      .add(ProductTag, {})
      .add(ProductInfoComponent, body);
    await product.save();
    return Response.json({ data: { id: product.id } }, { status: 201 });
  }
}
```

Validate REST bodies yourself. `t.*` is the GraphQL input DSL, not a REST parser.

Non-multipart bodies default to 1 MB. Over `Content-Length` the response is 413 `{ error, code: "PAYLOAD_TOO_LARGE", limit }`. Raise it with `app.setJsonBodyLimit(n)` before start, or `JSON_BODY_LIMIT`. A missing `Content-Length` on a non-multipart body is not rejected by this check.

OpenAPI decorators, if you use them: `import { ApiDocs, ApiTags } from "bunsane/swagger"`. `/docs` and `/openapi.json` are 404 until you opt in. See below.

## Uploads

`handleUpload`, `parseFormData`, `uploadResponse`, and `uploadErrorResponse` are on the barrel. `@Upload` is not: `import { Upload } from "bunsane/upload"`. Importing `"bunsane"` does not register a storage provider. That happens on first upload use. Register S3 explicitly:

```typescript
import { initializeS3Storage } from "bunsane/upload";

await initializeS3Storage({
  bucket: "my-app-uploads",
  region: "us-east-1",
  keyPrefix: "uploads/",
});
```

`S3StorageProvider` lives at `bunsane/storage/S3StorageProvider`. `acl` defaults to `"private"`.

```typescript
import { handleUpload, uploadErrorResponse, uploadResponse } from "bunsane";
import { Post } from "bunsane/service";

class MediaService extends BaseService {
  @Post("/api/media/upload")
  async uploadMedia(req: Request) {
    try {
      const result = await handleUpload(req, {
        config: {
          maxFileSize: 10_000_000,
          allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        },
        maxFiles: 5,
        storageProvider: "s3",
      });
      return uploadResponse(result);
    } catch (error) {
      return uploadErrorResponse(error);
    }
  }
}
```

Multipart defaults to 50 MB. A multipart request with no `Content-Length` is **411** `{ error: "Length Required", code: "LENGTH_REQUIRED", limit }` before the body is read (0.8+). Browsers and `fetch(url, { body: formData })` send the header. An in-process `new Request(url, { body: formData })` does not — set `Content-Length` or `handleUpload` / `parseFormData` throw `LengthRequiredError` (`bunsane/core/app/bodyLimit`).

`generateThumbnails`, `imageProcessing`, and `scanForMalware` are removed. `UploadManager` defaults match `DEFAULT_UPLOAD_CONFIG` (10 MB, SVG excluded).

## Security defaults that affect your app

Set these in code or env. The framework does not open them for you.

**CORS.** `setCors` requires `origin` (a string, an array, a function, or `"*"`). `credentials: true` with `origin: "*"` throws.

```typescript
app.setCors({
  origin: ["https://app.example.com"],
  credentials: true,
});
```

**GraphQL limits (0.7+).** Max depth defaults to 15. Max complexity defaults to 1000. `setGraphQLMaxDepth(n)` throws if `n` is not an integer ≥ 15. `setGraphQLMaxComplexity(n)` throws if `n` < 1. `0` does not disable either limit.

Introspection and GraphiQL are on only when `NODE_ENV=development`, or when `GRAPHQL_INTROSPECTION` / `GRAPHQL_GRAPHIQL` is `on`. `NODE_ENV=test` is off. A GET of `/graphql` that wants the HTML UI is 404 when GraphiQL is off. Turn it on in tests with `app.setGraphQLIntrospection(true)` or the env var.

**Deny-by-default info endpoints (0.7+).** With no token and no `=public`, these return 404 (the surface is not advertised):

| Path | Opt in |
|------|--------|
| `/metrics`, `/health/remote` | `BUNSANE_METRICS_TOKEN` (≥ 16 chars) or `BUNSANE_METRICS=public` |
| `/docs`, `/openapi.json` | `BUNSANE_DOCS_TOKEN` (≥ 16) or `BUNSANE_DOCS=public` |

Once a token is set, a missing or wrong `Authorization: Bearer` / `x-metrics-token` / `x-docs-token` header is **401**, not 404. `=public` allows the request with no header. `/health` stays open and no longer includes uptime or per-check latency. It runs a real write probe. Point liveness at `/health`.

**Headers.** `requestId` and `securityHeaders` are on by default. Opt out with `setRequestId(false)` / `setSecurityHeaders(false)` before start. HSTS is sent only when `BUNSANE_HSTS=on` or `BUNSANE_TLS=on`, not because `NODE_ENV=production`.

**Cache and Redis.** Multi-instance L1 invalidation requires `BUNSANE_CACHE_INVALIDATION_SECRET` on every instance. Unset, pub/sub is disabled and a warning is logged. `REDIS_TLS=true` opens TLS (0.8+). It is not a no-op.

Studio: `enableStudio()` without a token of at least 16 characters refuses and stays disabled. Pass `{ token }` or set `BUNSANE_STUDIO_TOKEN`.

## Authentication

`GraphQLContext` does not include `jwt`. Your Yoga plugin or `setGraphQLContextFactory` adds it. Guard it in the resolver, or wrap the method with `Middleware` from `bunsane/gql/middleware`.

```typescript
import type { GraphQLContext } from "bunsane/types/graphql.types";
import { GraphQLError } from "graphql";

function userIdFrom(context: GraphQLContext): string | undefined {
  return context.jwt?.payload?.user_id;
}

@GraphQLOperation({ type: "Query", output: "User" })
async profile(_input: unknown, context: GraphQLContext): Promise<unknown> | unknown {
  const userId = userIdFrom(context);
  if (!userId) {
    return new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return Entity.FindById(userId);
}
```

Rate-limit HTTP with the barrel helper, before `start()`. It keys by socket IP. `X-Forwarded-For` is ignored unless `trustProxy: true`.

```typescript
import { rateLimit } from "bunsane";

app.use(rateLimit({ max: 100, windowMs: 60_000 }));
```

## Errors

| Code the client sees | When |
|------|------|
| `NOT_FOUND` | `FindById` returned null, or a required row is absent |
| `BAD_USER_INPUT` | Validation failed, or a unique field is already taken |
| `BAD_REQUEST` | Malformed request |
| `FORBIDDEN` | Caller lacks the role |

Outside `NODE_ENV=development`, only those four codes pass through. `UNAUTHENTICATED` is rewritten to `UNAUTHORIZED` (HTTP 401). Every other code, including `DUPLICATE_ENTRY`, `DUPLICATE_EMAIL`, and `INTERNAL_ERROR`, is replaced by `Internal server error` / `INTERNAL_SERVER_ERROR`. Log the real failure; do not put it in `extensions.code` if the client must see it.

Log with `logger` from `"bunsane"`. `logger.error({ error })` includes message and stack. Do not `console.error` in services you ship. `responseError` from `bunsane/core/ErrorHandler` builds a `GraphQLError`; prefer `new GraphQLError` so the code is one of the four that pass through.

## Hooks

```typescript
import { ComponentTargetHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

@ComponentTargetHook("entity.created", {
  includeComponents: [OrderTag, OrderInfoComponent],
})
async onOrderCreated(event: EntityCreatedEvent) {
  const info = await event.entity.get(OrderInfoComponent);
  logger.info({ orderId: event.entity.id, info }, "order created");
}
```

`save()` returns after the transaction commits. `entity.created` and `entity.updated` hooks — sync or `async: true` — run in a post-commit microtask. They do not finish before `save()` resolves. `async: true` only orders hooks relative to each other. Failures are logged. Shutdown still drains them. `set()` does await `component.updated`, and a rejection there is logged without failing `set()`. A hook thrown from `add()` / `remove()` does not fail the mutation. Do not put work the caller must observe in a save hook.

## Subscriptions

```typescript
import { App, BaseService, GraphQLSubscription, t, type InferInput } from "bunsane";

const orderUpdatedInput = { orderId: t.id().required() };

class OrderService extends BaseService {
  constructor(private app: App) {
    super();
  }

  @GraphQLSubscription({ input: orderUpdatedInput, output: "Order" })
  orderUpdated(input: InferInput<typeof orderUpdatedInput>): Promise<unknown> | unknown {
    return this.app.pubSub.subscribe(`orderUpdated_${input.orderId}`);
  }

  publishOrder(orderId: string, orderEntity: unknown) {
    this.app.pubSub.publish(`orderUpdated_${orderId}`, orderEntity);
  }
}
```

## Organize by domain

One service per domain (`UserService`, `OrderService`). Method names: `get` / `list` / `find` for queries, `create` / `update` / `delete` for mutations, `on` for hooks.

Multi-entity writes belong in one `dbTransaction` from `bunsane/database/gateway`. Pass `trx` into `FindById`, `get`, `set`, and `save`. See [Common patterns](./common-patterns.md).

## Checklist

- [ ] Extend `BaseService` and `registerService()` it before `init()`
- [ ] Operation `input` is a `t.*` record, with `.required()` on mandatory fields
- [ ] `output` is an archetype, a GraphQL type name, or a field map
- [ ] No `registerFieldResolvers` call
- [ ] Relations set `foreignKey: "component.prop"` unless exactly one `user_id` or `parent_id` matches
- [ ] List computed fields that query use `batch: true`
- [ ] List endpoints use `.take()` + `sortedCursor`, not `.cursor(id)` with a sort
- [ ] `setCors({ origin })` if the browser calls the API
- [ ] Multipart tests set `Content-Length`
- [ ] `/metrics` and `/docs` stay 404 unless you opted in
- [ ] Transactions use `dbTransaction` and pass `trx` through
