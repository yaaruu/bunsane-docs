---
sidebar_position: 5
sidebar_label: Common Patterns
---

# Common Patterns

Recipes you can copy. Imports come from `"bunsane"` unless the snippet says otherwise. Rules and pitfalls: [Query optimization](./query-optimization.md) · [Service patterns](./service-patterns.md) · [Component best practices](./component-best-practices.md).

## Create and update

```typescript
import { Entity } from "bunsane";

const user = Entity.Create()
  .add(UserTag, {})
  .add(NameComponent, { value: "John Doe" })
  .add(EmailComponent, { value: "john@example.com", verified: false });
await user.save();
```

`Create()` assigns a UUID v7. `CreateWithId("")` still assigns a new id. `add()` is synchronous and returns the entity. Nothing hits the database until `save()`.

Archetype `fill()` takes field names and component data, not flat scalars:

```typescript
const user = UserArcheType.fill({
  name: { value: "John Doe" },
  email: { value: "john@example.com", verified: false },
}).createEntity();
await user.save();
```

`updateEntity` patches the same shape and does not save:

```typescript
const user = await Entity.FindById(userId);
if (!user) throw new Error("User not found");

await UserArcheType.updateEntity(user, {
  name: { value: "Jane Doe" },
});
await user.save();
```

### `get()` is a snapshot

```typescript
const current = await user.get(ProfileComponent);
if (!current) {
  user.add(ProfileComponent, { bio: "Updated bio" });
} else {
  await user.set(ProfileComponent, {
    ...current,
    bio: "Updated bio",
  });
}
await user.save();
```

`get()` returns `null` when the component is absent: empty entity id, a pending or saved removal, a negative-cache tombstone, or zero rows. That is not an error.

`get()` throws `ComponentLoadError` (`bunsane/core/Entity`) on a pool, SQL, timeout, or admission failure (0.7+). `getOrThrow()` throws `ComponentMissingError` only after `get()` returned `null`.

Mutating the object `get()` returned does nothing. `has()` looks at memory only. `hasPersisted(Ctor)` checks the database and returns `false` if this session already removed the component (0.7+).

`remove()` of a component you have not loaded returns `true`. `save()` deletes the row (0.7+). `false` means this session already saved that deletion.

```typescript
user.add(PremiumTag, {});
await user.save();

user.remove(PremiumTag);
await user.save();
```

`FindById` returns `null` for a blank or unknown id. Pass `trx` when you are inside a transaction: `Entity.FindById(id, trx)` and `user.get(Ctor, { trx })`.

Dirty flags flip as soon as that save's own statements succeed — a second `save()` of the same entity inside the same transaction is an update, not a duplicate insert. If the transaction then rolls back, the in-memory flags are restored, so a retried `save()` reissues every statement (the QSP / read-model rows themselves are already rolled back by Postgres). That applies to any transaction opened through `db` / `getDb()` / `dbTransaction`, including a `trx.savepoint(...)` taken on one of those. A handle with no tracked end — `sql.reserve()`, or a transaction handle used after it already finished — keeps its flags applied regardless.

## Transactions

The default `db` export is a lazy proxy. `db.transaction` runs, but it does not take an admission permit. Use `dbTransaction` so the write shares the request lane.

```typescript
import { Entity } from "bunsane";
import { dbTransaction } from "bunsane/database/gateway";

const id = await dbTransaction(async (trx) => {
  const source = await Entity.FindById(sourceId, trx);
  if (!source) throw new Error("Source not found");

  const sourceBalance = await source.get(BalanceComponent, { trx });
  if (!sourceBalance || sourceBalance.amount < amount) {
    throw new Error("Insufficient funds");
  }

  await source.set(BalanceComponent, { amount: sourceBalance.amount - amount }, { trx });
  await source.save(trx);

  const dest = await Entity.FindById(destId, trx);
  if (!dest) throw new Error("Destination not found");
  const destBalance = await dest.get(BalanceComponent, { trx });
  await dest.set(
    BalanceComponent,
    { amount: (destBalance?.amount ?? 0) + amount },
    { trx },
  );
  await dest.save(trx);

  const record = Entity.Create().add(TransferComponent, {
    sourceId,
    destId,
    amount,
    timestamp: new Date(),
  });
  await record.save(trx);
  return record.id;
});
```

A caller-supplied `trx` stays on that handle and takes no extra permit. If any call throws, the transaction rolls back. Use `getDb()` from `bunsane/database` only when you need the SQL instance itself. `db === getDb()` is false.

Several independent inserts in one request: `Entity.saveMany(entities)` — one admission, one transaction, 500-row chunks (0.7+).

## Queries

Always `.take()`. An unbounded `exec()` that fills the default cap (10000) throws in development.

```typescript
import { Entity, FilterOp, Query } from "bunsane";

async function findUserByEmail(email: string): Promise<Entity | null> {
  const results = await new Query()
    .with(UserTag)
    .with(EmailComponent, Query.filters(Query.filter("value", FilterOp.EQ, email)))
    .take(1)
    .exec();
  return results[0] ?? null;
}
```

Index `value`. A unique lookup without a key index is still a scan.

### Load-more, including backward

```typescript
async function pageByCreatedAt(pageSize: number, token?: string, before = false) {
  let q = new Query()
    .with(OrderInfoComponent)
    .sortBy(OrderInfoComponent, "createdAt", "DESC")
    .take(pageSize);
  if (token) q = q.sortedCursor(token, before ? "before" : "after");

  const items = await q.exec();
  const { hasNextPage } = q.getLastRouteInfo();
  const last = items[items.length - 1];
  const row = last ? await last.get(OrderInfoComponent) : null;
  return {
    items,
    hasNextPage: hasNextPage ?? false,
    nextCursor: last
      ? Query.encodeSortedCursor(row?.createdAt ?? null, last.id)
      : undefined,
  };
}
```

`.cursor(id)` throws when a sort is set. Multi-key tokens must list every key, in sort order:

```typescript
const token = Query.encodeSortedCursor(
  [row?.status ?? null, row?.total ?? null],
  entity.id,
);
```

A date range on an indexed field:

```typescript
await new Query()
  .with(OrderInfoComponent, {
    filters: [
      Query.filter("createdAt", FilterOp.GTE, startDate),
      Query.filter("createdAt", FilterOp.LTE, endDate),
    ],
  })
  .sortBy(OrderInfoComponent, "createdAt", "DESC")
  .take(100)
  .exec();
```

`sortByCreatedAt().with(X)` is not the same plan. If X is clustered in time, that list falls back to the previous plan plus about 10%. Use [QSP](../qsp.md), or sort on an indexed component field. See [Query optimization](./query-optimization.md).

Open rows — do not load them and filter in JavaScript:

```typescript
await new Query()
  .with(AssignmentComponent, {
    filters: [Query.filter("completedAt", FilterOp.IS_NULL, null)],
  })
  .take(100)
  .exec();
```

## Archetypes and relations

```typescript
import {
  ArcheType,
  ArcheTypeField,
  ArcheTypeFunction,
  BaseArcheType,
  BelongsTo,
  Entity,
  HasMany,
  HasOne,
} from "bunsane";
import type { ArcheTypeOwnProperties } from "bunsane/core/ArcheType";

@ArcheType("User")
export class UserArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(NameComponent)
  name!: NameComponent;

  @ArcheTypeField(EmailComponent)
  email!: EmailComponent;

  @ArcheTypeField(ProfileComponent, { nullable: true })
  profile!: ProfileComponent;

  @HasMany(() => OrderArcheTypeClass, { foreignKey: "info.user_id" })
  orders!: IOrderArcheType[];

  @HasOne(() => DriverArcheTypeClass, { foreignKey: "profile.user_id", nullable: true })
  driver?: IDriverArcheType;

  @ArcheTypeFunction({ returnType: "string" })
  async displayName(entity: Entity) {
    const name = await entity.get(NameComponent);
    const profile = await entity.get(ProfileComponent);
    return profile?.nickname || name?.value || "Anonymous";
  }
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
export const UserArcheType = new UserArcheTypeClass();
```

`ArcheTypeOwnProperties` is not on the root barrel.

Relation rules (0.8+):

- Target is a class, `() => Class`, or a registered name. Unregistered targets fail schema build.
- Omit `foreignKey` only if exactly one `user_id` or `parent_id` matches. Otherwise set `foreignKey: "component.prop"` — the archetype field on the owning side, then the property.
- `hasMany` / `hasOne` / `belongsToMany` look at the related archetype. `belongsTo` looks at this archetype.
- `@HasOne` is nullable unless `nullable: false`. A missing child is `null`, not an error.

### Batch a computed field (0.8+)

```typescript
@ArcheTypeFunction({ returnType: "number", batch: true })
async openOrderCounts(parents: readonly Entity[]) {
  const ids = parents.map((parent) => parent.id);
  const rows = await new Query()
    .with(OrderInfoComponent, {
      filters: [Query.filter("userId", FilterOp.IN, ids)],
    })
    .groupBy(OrderInfoComponent, "userId")
    .countBy();

  const counts = new Map(parents.map((parent) => [parent.id, 0]));
  for (const row of rows) counts.set(String(row.userId), Number(row.count));
  return counts;
}
```

One call per request, per distinct args. The `Map` is keyed by entity id. A missing key on a non-null field fails that parent.

## GraphQL inputs

```typescript
import { GraphQLOperation, t, type InferInput } from "bunsane";

const createUserInput = {
  name: t.string().minLength(2).maxLength(100).required(),
  email: t.string().email().required(),
  role: t.enum(["admin", "user"], "UserRole").required(),
};

@GraphQLOperation({
  type: "Mutation",
  input: createUserInput,
  output: "User",
})
async createUser(input: InferInput<typeof createUserInput>): Promise<unknown> | unknown {
  const user = Entity.Create()
    .add(UserTag, {})
    .add(NameComponent, { value: input.name })
    .add(EmailComponent, { value: input.email, verified: false });
  await user.save();
  return user;
}
```

Zod and string-map inputs still execute and log a deprecation warning. New code uses the record above. Nested objects use `t.object(shape, name)` as a field, not as the top-level `input`.

`@Enum()` classes (`bunsane/core/metadata`) still register enum metadata for archetype fields. For an operation argument, `t.enum` is the input.

## Soft delete

```typescript
import { Component, CompData, BaseComponent, Entity, Query } from "bunsane";

@Component
export class SoftDeletedTag extends BaseComponent {}

@Component
export class DeletedAtComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: Date = new Date();

  @CompData()
  deletedBy: string = "";
}

async function softDelete(entityId: string, deletedBy: string) {
  const entity = await Entity.FindById(entityId);
  if (!entity) throw new Error("Entity not found");
  entity.add(SoftDeletedTag, {});
  entity.add(DeletedAtComponent, { value: new Date(), deletedBy });
  await entity.save();
}

async function listActiveUsers() {
  return new Query().with(UserTag).without(SoftDeletedTag).take(100).exec();
}

async function restore(entityId: string) {
  const entity = await Entity.FindById(entityId);
  if (!entity) throw new Error("Entity not found");
  entity.remove(SoftDeletedTag);
  entity.remove(DeletedAtComponent);
  await entity.save();
}
```

`.without(SoftDeletedTag)` does not route to QSP. A hot "active only" list should filter an indexed status field instead.

`sortByCreatedAt()` / `sortByUpdatedAt()` combined with `.with()` or `.without()` already exclude soft-deleted entities (0.9, unreleased). A component-field sort does not. Exclude them yourself.

## Logging

```typescript
import { logger, GraphQLOperation, t, type InferInput } from "bunsane";

const log = logger.child({ service: "OrderService" });

const createOrderInput = {
  sku: t.string().required(),
  quantity: t.int().min(1).required(),
};

@GraphQLOperation({
  type: "Mutation",
  input: createOrderInput,
  output: "Order",
})
async createOrder(input: InferInput<typeof createOrderInput>): Promise<unknown> | unknown {
  log.info({ sku: input.sku, quantity: input.quantity }, "creating order");
  const order = Entity.Create().add(OrderInfoComponent, {
    sku: input.sku,
    quantity: input.quantity,
  });
  await order.save();
  log.info({ orderId: order.id }, "order created");
  return order;
}
```

Pass the error as `error` or `err`. Pino serializes both. `{ error: String(error) }` drops the stack.

## Batch work

```typescript
import { Entity } from "bunsane";

const pending = await new Query().with(PendingOrderTag).take(1000).exec();
await Entity.saveMany(pending);
```

Do not `exec()` the full table and loop `save()`. If the job is a `@ScheduledTask`, set `maxEntitiesPerExecution`. Without it the runner caps the query at 1000.

## Rate limit

Use `rateLimit` for one process. It keys by socket IP and keeps buckets in memory, so a second instance does not share them. Multi-instance limits need a shared store. A `Map` inside a resolver has the same gap and also ignores the socket IP.


```typescript
import { App, rateLimit } from "bunsane";

const app = new App({ name: "MyAPI", version: "1.0.0" });
app.use(rateLimit({ max: 100, windowMs: 60_000, pathPrefixes: ["/graphql"] }));
```

`trustProxy: true` is required before `X-Forwarded-For` is trusted. Register `use()` before `start()`.
