---
sidebar_position: 12
sidebar_label: Upgrading
---

# Upgrading

This site describes `main`. npm `latest` is 0.6.1. v0.7.0 and v0.8.0 are GitHub tags, cut the same day. 0.9 (key indexes, tie order) is unreleased; `package.json` on `main` still says `0.8.0`.

Jump from 0.6 to the 0.8 tag, then read [0.8 → 0.9](#08--09-unreleased) before you deploy `main`. That step is not a no-code upgrade.

The changelog is the full list: [CHANGELOG.md](https://github.com/yauruu/bunsane/blob/main/CHANGELOG.md). Operator notes that this page shortens live in the repo's [UPGRADING.md](https://github.com/yauruu/bunsane/blob/main/docs/UPGRADING.md).

No hand-written SQL migration is required at any step. `App.init()` creates read-model tables and, on `main`, key indexes.

## 0.6 → 0.7

Set environment before the new process serves traffic, then `bunx tsc --noEmit`, then one development boot.

### Environment

| What breaks | Find it | Change |
|-------------|---------|--------|
| Unset `NODE_ENV` is fail-closed (errors masked, info routes closed) and warns at boot | Process env in the deploy manifest | Set `production`, `development`, or `test` |
| `/metrics` and `/health/remote` are closed | Scrapers, uptime checks on `/health/remote` | No token and not `public`: 404. Token configured (`BUNSANE_METRICS_TOKEN`, 16+ characters; `Authorization: Bearer` or `x-metrics-token`) but header missing or wrong: 401. Or `BUNSANE_METRICS=public` |
| `/docs` and `/openapi.json` are closed | Browser bookmarks, generated clients that fetch the spec from prod | Same rule with `BUNSANE_DOCS_TOKEN` / `x-docs-token`, or `BUNSANE_DOCS=public`. 404 only when no token is configured |
| Introspection and GraphiQL only when `NODE_ENV=development` | Codegen pointed at a non-dev URL | `GRAPHQL_INTROSPECTION=on` / `GRAPHQL_GRAPHIQL=on`, or point codegen at development |
| `/health` drops `uptime` and per-check `latency_ms` | Dashboards reading those fields | Read status fields only. Liveness probes keep working |
| JSON body default is 1 MB (was 50 MB). Over `Content-Length` is 413 | Bulk import, base64-in-JSON | `JSON_BODY_LIMIT` or `app.setJsonBodyLimit()` |
| GraphQL depth floor is 15. `setGraphQLMaxDepth(0)` throws. Complexity `0` no longer disables | Config that set depth or complexity to 0 | Delete the disable. Depth must be an integer ≥ 15 |
| Cross-instance L1 invalidation is off without a shared secret | More than one app instance and `CACHE_ENABLED` | Same `BUNSANE_CACHE_INVALIDATION_SECRET` on every instance. Single-instance apps can skip it |
| `NODE_ENV=production` no longer sends HSTS | Clients that required `Strict-Transport-Security` | `BUNSANE_HSTS=on` or `BUNSANE_TLS=on` |
| Negative component cache defaults on (60 s tombstone) | Tests that expected a miss to hit SQL every time | `CACHE_COMPONENT_NEGATIVE_ENABLED=false` to restore the old default |
| `rateLimit()` keys by socket IP and ignores `X-Forwarded-For` | App behind a load balancer; one shared bucket | `rateLimit({ trustProxy: true })` only if the proxy is trusted |

`BUNSANE_STRICT_ENV=on` turns the boot warnings (unset `NODE_ENV`, production Redis without a password, production Redis off-loopback without TLS) into startup failures.

### Code the compiler finds

| What breaks | Find it | Change |
|-------------|---------|--------|
| Removed modules | `tsc` errors on `BatchLoader`, `PreparedStatementCache`, `gql/ArchetypeOperations`, `enableArchetypeOperations`, `yoga` import, `rest/Generator`, `DatabaseHelper.UpdateComponentIndexes`, `Query.getCacheStats()` | Delete the import. Indexes are created at boot. Scheduled tasks: `ScheduledTask` from `"bunsane"`. Downgrade helpers: `bunsane/database/maintenance` |
| Upload flags that were never implemented | `generateThumbnails`, `imageProcessing`, `scanForMalware` in upload config | Delete the flags |
| `db` is a lazy proxy | `db === getDb()`, `db instanceof SQL` | Call `getDb()` from `bunsane/database` when you need the instance. Calls on the default export still work |
| `Query` tracks what `.populate()` loaded | `componentData.X.field` errors after a non-chained `populate()` | Chain it: `await new Query().with(Profile).populate().take(20).exec()` |
| Filter field names are checked | `tsc` error inside `.with(Ctor, { filters })` | `Query.filters(Query.filter("status", FilterOp.EQ, "paid"))` |
| `@GraphQLOperation` with `t.*` input is checked | Argument type errors | Type the method `(input: InferInput<typeof input>, ctx?, info?)`. String-map and Zod inputs still run and log a deprecation warning |

Prefer `import { App, Entity, Query, FilterOp, t } from "bunsane"`. Deep paths still resolve.

### Behaviour that throws or changes at runtime

Boot once with `NODE_ENV=development`.

| What breaks | Find it | Change |
|-------------|---------|--------|
| `entity.get()` throws `ComponentLoadError` on DB errors. `null` is absence only | `catch` that treated `null` as "failed or missing" | Import `ComponentLoadError` from `bunsane/core/entity/errors`. Relation loaders reject instead of resolving `[]` |
| `remove()` on a component this session never loaded returns `true` and deletes on `save()` | Code that used a `false` return as "leave the row" | Do not call `remove()` unless you mean delete |
| `updated_at` moves on component edits | Sorts or tests that treated `sortByUpdatedAt` as creation order | Use `sortByCreatedAt` for creation order |
| Unbounded `exec()` that fills 10000 rows throws in development | Stack traces naming `BUNSANE_DEFAULT_QUERY_LIMIT` | `.take(n)`. Production warns once and sets `truncatedByDefaultLimit` |
| Boolean filters compare JSON text `'true'` | Stored `"yes"`, `"1"`, `"t"` no longer match | Search `data->'field'` where `jsonb_typeof` is not `boolean` |
| Schema build throws on a bad `@GraphQLOperation` output, an unregistered relation target, or an `@ArcheTypeFunction` with no usable return type | Boot error. Previously these became `String` or `[Any]` | Pass an archetype class, a scalar, or `returnType` |
| `Date` scalar only for `Date` / `z.date()`. `ID` only on archetype `id` | Generated clients; fields named `*_at` that became `String` | Type the property as `Date` if clients should see `Date` |
| `app.use()` after `start()` throws. A second `start()` is a no-op | Middleware registered in a request handler | Register before `init()` / `start()` |
| `async: true` hooks are not awaited on `save()` | Callers that read a side effect immediately after `save()` resolves | Make that hook synchronous, or wait on your own handle. Shutdown still drains async hooks |
| Scheduler tasks without `maxEntitiesPerExecution` stop at 1000 entities | Tasks that used to scan the full match set | Set `maxEntitiesPerExecution`, or `.take(n)` smaller than 1000 |
| `@HasOne` is nullable unless `nullable: false` | Generated clients; non-null assertions | Handle `null`, or set `nullable: false` |

`registerFieldResolvers` is optional and idempotent. Schema build attaches field, relation, and function resolvers.

## 0.7 → 0.8

Apply this on top of the 0.7 list. If you skipped 0.7, do both before serving traffic.

| What breaks | Find it | Change |
|-------------|---------|--------|
| Multipart with no `Content-Length` is 411 `{ code: "LENGTH_REQUIRED" }` on REST uploads and `/graphql` | In-process `new Request(url, { body: formData })`. Browsers and `fetch(url, { body: formData })` already send the header | Serialize the body and set `content-length`. `parseFormData` / `handleUpload` throw `LengthRequiredError` |
| `@HasMany` / `@HasOne` / `@BelongsTo` without `foreignKey` must match exactly one `user_id` or `parent_id` | Schema-build error naming the relation and the candidates | `foreignKey: "<archetype field>.<prop>"` — the field on the owning archetype, not the class name. Search runs on the related archetype for hasMany / hasOne / belongsToMany, and on this archetype for belongsTo |
| `REDIS_TLS=true` opens TLS (it was a no-op) | Boot cannot connect to Redis | Remove the variable if Redis is plaintext, or set `REDIS_TLS_SERVERNAME` / `REDIS_TLS_REJECT_UNAUTHORIZED=false`. `REDIS_USERNAME` is sent when set |
| `sortedCursor()` width must match the sort-key count. Calling it with no sort throws | `tsc` will not catch a wrong token. Tests that page a sorted list | `Query.encodeSortedCursor(value, id)` or `Query.encodeSortedCursor([k1, k2], id)`. Existing single-key tokens still decode |
| `withIndexHint` names must match `^[A-Za-z0-9_]+$`. Schema DSL names must be GraphQL identifiers | Boot or first query | Rename. `t.object` and `t.enum` require a name |
| M3 `.rows()` / `.listPage()` throw when `.limit()` or `.offset()` is set without `.orderBy()` | Report endpoints that page a read model | `.orderBy("issuedAt", "DESC").limit(50).listPage()` |
| M3 GraphQL lists return `${Name}Page { nodes, hasNextPage }` instead of a list | Clients selecting `invoiceReports { total }` | Select `invoiceReports { nodes { total } hasNextPage }`. New args: `offset`, `orderBy` (default `leftEntityId`), `direction`. `offset + limit` must be ≤ 10000 |
| M3 reads and write-through go through the DB gateway | Timeouts that never happened on those paths | Catch `DbStatementTimeoutError` / `DbAdmissionTimeoutError` from `bunsane/database/gateway`. Size `DB_REQUEST_TIMEOUT` for the slowest legitimate read |

```typescript
@HasMany("OrderArch", { foreignKey: "order.userId" })
orders!: OrderArch[];
```

In-process multipart tests:

```typescript
const draft = new Request(url, { method: "POST", body: formData });
const contentType = draft.headers.get("content-type")!;
const bytes = await draft.arrayBuffer();
const req = new Request(url, {
  method: "POST",
  body: bytes,
  headers: {
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
  },
});
```

Also update tests:

- Introspection is off when `NODE_ENV=test` unless `GRAPHQL_INTROSPECTION=on` or `app.setGraphQLIntrospection(true)`.
- Between files that boot an app, `await closeDatabase()` from `bunsane/database`.
- `/metrics` and `/docs` tests need the token or `=public`.

### Several instances

Old and new processes can serve together, with two exceptions:

1. Cache invalidation. 0.8 accepts only signed messages, and only when the secret is set. During the rollout, do not expect invalidations to cross versions. Set the same `BUNSANE_CACHE_INVALIDATION_SECRET` on every 0.8 instance. Keep the window short, or lower `CACHE_COMPONENT_TTL`.
2. `BUNSANE_RPC_SECRET`. Deploy 0.8 everywhere **without** the secret first. Turning it on makes consumers ACK-drop unsigned envelopes, and those messages are lost. Flip it on every instance at once, or pause producers while you roll.

Worth adopting, not required: `@ArcheTypeFunction({ batch: true })`, multi-key `sortedCursor`, `Entity.saveMany`, `new App({ ... })`, and `t.*` inputs. Measured on 100k entities (changelog): single-field top-N sort about −87–88% p50, keyset next page −89%, a GraphQL list with a relation and computed field −81%. A batched computed field on that list went from 54 statements to 5.

## 0.8 → 0.9 (unreleased)

This is not a no-code upgrade. Search the app before you boot `main` against production data.

| What breaks | Find it | Change |
|-------------|---------|--------|
| `.cursor(id)` with `.sortBy`, `.sortByCreatedAt`, or `.sortByUpdatedAt` throws | `.cursor(` next to any sort | `sortedCursor`. Encode with `Query.encodeSortedCursor` |
| Tie order follows the sort direction. DESC ties are `entity_id DESC` (they were always ASC) | UI or tests that assume equal values come out in ascending id order under `DESC` | Assert the new order. A cursor issued inside a tie group by 0.8 may repeat or skip rows of that group once |
| Non-numeric text in a numeric field sorts and filters as NULL | Queries that expected `invalid input syntax for type numeric`, or `"n/a"` ranked as a number | Clean the data, or accept missing. `bunsane_num_v1` does not throw |
| Entity timestamp pages all use UTC milliseconds. Sub-millisecond ties fall to id | Tests that ordered two rows created in the same millisecond by raw `timestamptz` | Compare milliseconds, then id |
| `sortByCreatedAt` / `sortByUpdatedAt` combined with `.with()`, OR, or `.without()` exclude soft-deleted entities | Lists that still showed deleted rows | Filter in the service if you truly need them. They are not in the index plan |
| First boot builds a `bk_` index per indexed scalar, plus `created_at` / `updated_at` on `entities` | Disk and I/O budget; lists that are correct but slow until the background build finishes | Tables under `BUNSANE_INDEX_SYNC_MAX_ROWS` (100000) index during `init()`. Larger tables index in the background (`CREATE INDEX CONCURRENTLY`). Legacy `idx_*_btree` / `_btree_date` / `_numeric` / scalar `_gin` drop only after the replacement is valid |
| `BUNSANE_INDEX_SYNC_MAX_ROWS` and `BUNSANE_ENTITY_SORT_PROBE` are validated at boot | A typo'd value | Non-negative integer, and a positive integer, respectively. Invalid values fail `init()` |

```typescript
// Throws on 0.9:
await new Query().with(Order).sortByCreatedAt("DESC").cursor(lastId).exec();

// Page the same list. Read entities.created_at for lastId (the entity
// object does not carry it) and pass that Date:
const token = Query.encodeSortedCursor(createdAt, lastId);
await new Query().with(Order).sortByCreatedAt("DESC").take(20).sortedCursor(token).exec();
```

Sorting an unindexed field still works (full scan). Development logs one warning naming the field. Add `@CompData({ indexed: true })`, or `@CompositeIndex(["status", "total"])` when you filter on one field and sort on the next. Both decorators are described in [Database](./database.md).

`sortByCreatedAt().with(X)` when X is clustered in time stays on the previous plan plus about 10% (changelog, 1M entities). Point that list at [QSP](./qsp.md). The membership probe is single-key only. `entitySortPlan` is `'probe'` when the page fills or the candidate window is exhausted. It is `'fallback'` when that window was not exhausted and the page is short, when `OFFSET > 0`, when the estimate exceeds `BUNSANE_ENTITY_SORT_PROBE`, or when both timestamp sorts are combined with membership. See [List queries](./query-lists.md#entity-timestamps).

Do not drop `bk_` indexes by hand. The reconciler owns them.

## After you deploy

- `bunx tsc --noEmit` is clean.
- Boot logs do not warn about `NODE_ENV`, the cache invalidation secret, Redis TLS, or `rateLimit` failing open.
- `/health` is 200. `/metrics` is 200 with the token. With a token configured, a missing header is 401, not 404. 404 means no token and not `public`.
- A list query in development does not throw `truncatedByDefaultLimit`, and does not warn about an unindexed sort you meant to index.
- GraphQL clients select `nodes` on read-model list fields.
- On `main`, the first boot log shows index reconcile finishing (or a background build still running) before you treat list latency as final.
