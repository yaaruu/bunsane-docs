---
sidebar_position: 11
sidebar_label: Configuration
---

# Configuration

BunSane reads environment variables at boot and at call time, plus a few setters (`app.setJsonBodyLimit()`, `app.setGraphQLMaxComplexity()`, …). Defaults below match `main`.

`validateEnv()` runs at the start of `App.init()` and throws `Environment validation failed:` before the server binds. `BUNSANE_STRICT_ENV=on` (or `true`) promotes security warnings to that failure.

This page is the set you configure in an app. Probe knobs, pooling measurements, and every internal flag are in the repo reference: [CONFIGURATION.md](https://github.com/yauruu/bunsane/blob/main/docs/CONFIGURATION.md).

Version notes: deny-by-default info routes, body limits, and the cache secret are (0.7+). Redis TLS actually connecting is (0.8+). `BUNSANE_INDEX_SYNC_MAX_ROWS` and `BUNSANE_ENTITY_SORT_PROBE` are (0.9, unreleased).

## Database connection

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_CONNECTION_URL` | — | Full PostgreSQL URL. Overrides `POSTGRES_*` when set. |
| `POSTGRES_HOST` | — | Required if there is no URL. |
| `POSTGRES_USER` | — | Required if there is no URL. |
| `POSTGRES_PASSWORD` | — | DB password. |
| `POSTGRES_DB` | — | Required if there is no URL. |
| `POSTGRES_PORT` | `5432` | DB port. |
| `POSTGRES_MAX_CONNECTIONS` | `20` | Pool size. Admission limit is this minus `DB_ADMISSION_HEADROOM`. |

Use `DB_CONNECTION_URL`, not `DATABASE_URL`. `DATABASE_URL` does not open the pool.

## Database behavior and timeouts

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_QUERY_TIMEOUT` | `30000` (ms) | How long the caller waits. It does not, by itself, cancel the server statement. Use role `statement_timeout` for that. |
| `DB_REQUEST_TIMEOUT` | unset → `DB_QUERY_TIMEOUT` | Request-lane deadline (ms). Covers the wait for a permit **and** the query. Set a few seconds on a request-facing deploy so overload sheds. Size it for the slowest legitimate request, not as a queue-only knob. |
| `DB_BACKGROUND_TIMEOUT` | unset → `DB_QUERY_TIMEOUT` | Same for scheduler, outbox, and QSP backfill/reconcile. Shortening the request lane must not kill this work. |
| `DB_CONNECTION_TIMEOUT` | `30` (**seconds**) | Time to **establish** a connection. It does not bound waiting on a busy pool. |
| `DB_POOL_IDLE_TIMEOUT` | `30` (seconds) | Close idle connections. `0` = no limit. Values above `3600` fail boot. |
| `DB_POOL_MAX_LIFETIME` | `600` (seconds) | Recycle a pooled connection. Values above `86400` fail boot. `0` = no limit. |
| `DB_POOL_SATURATION_READY_MS` | `3000` | `/health/ready` fails `db_pool` after this much continuous saturation. Does not fail liveness. `0` disables. |
| `BUNSANE_DB_ADMISSION` | `on` | Bound concurrency in front of the pool. Armed in `App.init()` after migrations. `off` is a passthrough. |
| `DB_ADMISSION_HEADROOM` | `1` | Connections kept outside the admission limit for health and not-yet-migrated calls. |
| `DB_STATEMENT_TIMEOUT` | unset (ms) | Startup `options` parameter. **Inert behind PgBouncer.** Set the role instead. |
| `DB_DISABLE_PREPARE` | `false` | `true` disables server-side prepared statements. **Required** behind PgBouncer transaction pooling. See [below](#running-behind-pgbouncer). |
| `DB_DDL_TIMEOUT` | `600000` (ms) | Budget for `CREATE INDEX`, projection tables, and `ANALYZE`. |
| `DB_SAVE_PROFILE` | `false` | Log per-phase `Entity.save` timings. |
| `DB_HEALTH_WRITE_TIMEOUT` | `5000` (ms) | Write-probe budget, independent of the request timeout. |

Three different bounds: role `statement_timeout` stops the statement, admission bounds the queue, `DB_REQUEST_TIMEOUT` is what sheds. There is no `DB_HEALTH_TIMEOUT`; the health lane is not admitted.

## Health checks

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_DB_WRITE_PROBE` | `true` | `/health` runs a real pooled write via raw `db.transaction` (temp table, dropped on commit). It does not take an admission permit and does not use the `Entity.save` gateway path. `false` falls back to `SELECT 1`. |
| `BUNSANE_HEALTH_PROBE` | `write` | `read` skips the write probe before `HEALTH_DB_WRITE_PROBE` is consulted. |
| `BUNSANE_HEALTH_CACHE_MS` | `5000` | Cache TTL for `/health` and `/health/ready`. `0` disables. |
| `BUNSANE_HEALTH_MAX_RPS` | `20` | Token bucket. Excess is 429 with no DB call. `0` disables. |

`/health` no longer returns `uptime` or per-check `latency_ms` (0.7+). See [Health checks and liveness](#health-checks-and-liveness).

## Application and HTTP

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `3000` | Listen port. |
| `NODE_ENV` | unset | `development` \| `production` \| `test`. Unset is fail-closed: errors masked, HSTS off, info routes 404 unless a token or `=public` is set. `development` is the only value that turns introspection on by default. `production` alone does not send HSTS. |
| `REQUEST_TIMEOUT_MS` | `30000` | Wall-clock request timeout. `0` disables. `/health` and `/health/ready` skip it. Also `app.setRequestTimeout()`. |
| `JSON_BODY_LIMIT` | `1048576` (1 MB) | Non-multipart `Content-Length` cap. Over it: 413 `{ code: "PAYLOAD_TOO_LARGE" }` before the body is read. A missing `Content-Length` on non-multipart is not rejected here. |
| `MULTIPART_BODY_LIMIT` | `52428800` (50 MB) | Multipart cap. No `Content-Length` on `multipart/form-data`: 411 `{ code: "LENGTH_REQUIRED" }` (0.8+). |
| `MAX_REQUEST_BODY_SIZE` | `52428800` (50 MB) | `Bun.serve` cap and the default multipart cap. Does not raise the JSON limit. |
| `SHUTDOWN_GRACE_PERIOD_MS` | `10000` | Drain budget on SIGTERM/SIGINT. Also `app.setShutdownGracePeriod()`. |
| `BUNSANE_METRICS_TOKEN` | unset | Bearer or `x-metrics-token` for `/metrics` and `/health/remote`. Minimum 16 characters. No token configured: 404. Token configured but header missing or wrong: 401. |
| `BUNSANE_METRICS` | unset | `public` serves those routes with no token. `off` does not open them. |
| `BUNSANE_DOCS_TOKEN` | unset | Bearer or `x-docs-token` for `/docs` and `/openapi.json`. Minimum 16 characters. No token configured: 404. Token configured but header missing or wrong: 401. |
| `BUNSANE_DOCS` | unset | `public` serves docs routes with no token. |
| `BUNSANE_HSTS` | `off` | `on` sends `Strict-Transport-Security`. |
| `BUNSANE_TLS` | `off` | `on` also enables HSTS. It does not terminate TLS. |
| `BUNSANE_STRICT_ENV` | `off` | `on` fails boot on the security warnings listed above, including production Redis on a non-loopback host without TLS (0.8+). |

`requestId` and `securityHeaders` are on unless you call `setRequestId(false)` / `setSecurityHeaders(false)` before `start()`. `app.use()` after `start()` throws. A second `start()` is a no-op.

## GraphQL

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHQL_MAX_DEPTH` | `15` | Integer ≥ 15. Below 15 throws. `0` does not disable. |
| `GRAPHQL_MAX_COMPLEXITY` | `1000` | Integer ≥ 1. `0` does not disable. |
| `GRAPHQL_INTROSPECTION` | unset | `on` or `off`. Unset follows `NODE_ENV=development` only. `NODE_ENV=test` is off. A setter wins over the variable. |
| `GRAPHQL_GRAPHIQL` | unset | Same gate. Off: `GET /graphql` with `Accept: text/html` is 404. |

## Query engine

| Variable | Default | Description |
|----------|---------|-------------|
| `BUNSANE_DEFAULT_QUERY_LIMIT` | `10000` | `LIMIT` when `exec()` has no `.take()`. `0` disables. A full page sets `truncatedByDefaultLimit`. Development throws. See [List queries](./query-lists.md). |
| `BUNSANE_INDEX_SYNC_MAX_ROWS` | `100000` | (0.9, unreleased) Key indexes for smaller tables build during `init()`. Larger tables, and unanalyzed tables over 64 MB, build in the background under `withLock("bunsane:index-reconcile")`. Non-negative integer. Invalid values fail boot. |
| `BUNSANE_ENTITY_SORT_PROBE` | `5000` | (0.9, unreleased) Cap for the `sortByCreatedAt` / `sortByUpdatedAt` membership probe. The window is `min(cap, max(64, ceil(4 × pageLimit / componentShare)))`. Positive integer. Invalid values fail boot. `OFFSET > 0` skips the probe. |
| `BUNSANE_USE_LATERAL_JOINS` | `true` | LATERAL joins for multi-component queries (PostgreSQL 12+). |
| `BUNSANE_PARTITION_STRATEGY` | `list` | `list` or `hash`. Changing this on a database that has data is refused unless you force it. |
| `BUNSANE_USE_DIRECT_PARTITION` | `true` | Read LIST leaves directly. |
| `BUNSANE_FORCE_PARTITION_RECREATE` | `false` | Destructive. Dev only. |
| `BUNSANE_DB_SLOW_MS` | `500` | Slow-call warning threshold. `0` suppresses the warning. |
| `BUNSANE_COMPONENTS_DATA_GIN` | `false` | Whole-`data` GIN. Leave off unless you run raw SQL `data @>` on the payload. |
| `BUNSANE_ORNODE_SINGLE_PASS` | `1` (on) | OR over a required base uses one scan plus `EXISTS`. `0` / `false` restores `UNION`. |

Key-index behaviour (names, what `@CompData({ indexed: true })` creates, reconciler) is [Database](./database.md#key-indexes). There is no framework prepared-statement cache.

## Query Surface Planner

| Variable | Default | Effect |
|----------|---------|--------|
| `BUNSANE_QSP` | `off` | `off` \| `shadow` (parity, never serve) \| `route` (serve when READY). `shadow` ↔ `route` and either → `off` are live. `off` → `shadow`/`route` needs a restart. |
| `BUNSANE_QSP_ARCHETYPES` | empty | CSV scope. Empty = every eligible archetype (first covered query backfills). A CSV starts backfilling those archetypes at boot instead (new `projection_state` rows go straight to `BACKFILLING`); an existing row keeps its status. See [QSP](./qsp.md). |
| `BUNSANE_QSP_COUNT` | `exact` | `exact` \| `n_plus_1` \| `estimate`. |
| `BUNSANE_QSP_PROMOTE_MIN` | `50` | Clean shadow comparisons before READY. |
| `BUNSANE_QSP_BACKFILL_BATCH` | `5000` | Backfill batch size. |
| `BUNSANE_QSP_BACKFILL_THROTTLE_MS` | `50` | Sleep between batches. |
| `BUNSANE_QSP_ENTITIES_ACCEL` | `false` | Reserved. Validated at boot and not read. |
| `BUNSANE_QSP_HYDRATE` | `off` | Serve fully-columnar components from the `rm_` row. |
| `BUNSANE_QSP_HYDRATE_SHADOW` | `off` | Observe hydrate parity. Does not promote to READY. |

Routing requires an exact `.with` set match. Empty tags, `.without`, OR, ILIKE, spatial filters, and multi-key sorts do not route. (0.9, unreleased) `'before'` keysets and `nullsFirst` do route when the rest is covered. Per-column `bk_` indexes replace `idx_rm_<lowercase>__cover` (`OrderList` → `idx_rm_orderlist__cover`).

When the mode is `shadow` or `route`, `App.init()` starts the reconcile sweep (every 300 seconds) and shutdown stops it (0.7+). Do not start a second sweep. `off` does not start it.

Full rules: [QSP](./qsp.md).

## Locking and scheduler

| Variable | Default | Description |
|----------|---------|-------------|
| `BUNSANE_LOCK_BACKEND` | `auto` → `postgres` | `auto` \| `in-process` \| `postgres` (lease table, safe behind a transaction pooler) \| `advisory` (session-pinned only). `redis` is accepted by validation, logs an error, and falls back to the postgres lease. It is not implemented. |
| `BUNSANE_ALLOW_UNSAFE_ADVISORY_LOCK` | `false` | Bypass the probe that blocks `advisory` behind a transaction pooler. |

Scheduled queries with no `maxEntitiesPerExecution` process at most 1000 entities unless `.take()` is already smaller (0.7+). Scheduler leases renew while the task runs. Lease TTL is at least the task timeout plus 5 seconds. A wrapper timeout does not release the lock until the task settles.

## Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | `false` | Master switch. Also `app.setCacheConfig()`. |
| `CACHE_PROVIDER` | `memory` | `memory` \| `redis` \| `multilevel` \| `noop`. |
| `CACHE_DEFAULT_TTL` | `3600000` | Default TTL (ms). |
| `CACHE_MAX_MEMORY` | `104857600` | In-memory cap (bytes). |
| `CACHE_STRATEGY` | `write-invalidate` | `write-through` \| `write-invalidate`. |
| `CACHE_ENTITY_ENABLED` | `true` | Entity cache. |
| `CACHE_ENTITY_TTL` | `3600000` | Entity TTL. |
| `CACHE_COMPONENT_ENABLED` | `true` | Component cache. |
| `CACHE_COMPONENT_TTL` | `1800000` | Component TTL. |
| `CACHE_COMPONENT_NEGATIVE_ENABLED` | `true` | Tombstone absent components. Set `false` to probe SQL on every miss. |
| `CACHE_COMPONENT_NEGATIVE_TTL` | `min(component TTL, 60000)` | Negative TTL (ms). |
| `CACHE_RELATION_NEGATIVE_ENABLED` | `false` | Cache empty relation results. |
| `CACHE_RELATION_NEGATIVE_TTL` | `60000` | Negative relation TTL. |
| `CACHE_QUERY_ENABLED` | `true` | Query result cache. |
| `CACHE_QUERY_TTL` | `1800000` | Query TTL. |
| `CACHE_QUERY_MAX_SIZE` | `10000` | Max cached query results. |
| `BUNSANE_CACHE_INVALIDATION_SECRET` | unset | HMAC secret for cross-instance L1 invalidation. Same value on every instance. Unset: pub/sub stays off (one warning). Multi-instance apps then serve stale L1 until TTL. |
| `BUNSANE_CACHE_INVALIDATE_MAX` | `10000` | `invalidatePattern` aborts past this many keys. The pattern needs a literal prefix. |

### Redis

Used when `CACHE_PROVIDER` is `redis` or `multilevel`, and by Remote.

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Host. |
| `REDIS_PORT` | `6379` | Port. |
| `REDIS_PASSWORD` | — | Password. |
| `REDIS_USERNAME` | — | ACL username. Sent when set (0.8+). |
| `REDIS_DB` | `0` | DB index. |
| `REDIS_KEY_PREFIX` | `bunsane:` | Cache key prefix. |
| `REDIS_MAX_RECONNECT_ATTEMPTS` | `20` | Cap so an unreachable Redis does not spin forever. |
| `REDIS_ENABLE_OFFLINE_QUEUE` | `false` | Offline queue. Off bounds heap during an outage. |
| `REDIS_TLS` | unset | `true` connects cache and remote clients with TLS and certificate verification on (0.8+). In 0.6 this variable did nothing. Unset or `false` is plaintext. |
| `REDIS_TLS_SERVERNAME` | unset | SNI. Applied only when `REDIS_TLS=true`. |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | `false` skips certificate verification. Applied only when TLS is on. |

An explicit `RedisCache` config (`tls: false`, host, password) overrides these. There is no `REDIS_URL`.

## Remote

| Variable | Default | Description |
|----------|---------|-------------|
| `BUNSANE_RPC_SECRET` | unset | HMAC for RPC and outbox envelopes. Unset = unsigned, plus one warning. Set = consumers ACK-drop unsigned or tampered envelopes. Do not enable until every peer is on 0.8. |
| `BUNSANE_RPC_CONSUMER_CONCURRENCY` | `8` | In-flight stream messages per consumer. Positive integer. |

`replyTo` must be `rpc:responses:<instanceId>`.

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent`. |
| `LOG_PRETTY` | unset | `true` uses optional `pino-pretty`. If that package is missing, logs stay JSON and a warning is logged. Leave unset in production. |
| `DEBUG` | `false` | Framework debug mode. |

## S3

Only if you upload to S3-compatible storage. `S3StorageProvider` is `bunsane/storage/S3StorageProvider`.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET` | — | When set, access key and secret are required (or omit the bucket and use IAM). |
| `S3_REGION` | — | Region. |
| `S3_ENDPOINT` | — | MinIO, R2, or another custom endpoint. |
| `S3_ACCESS_KEY_ID` | — | Access key. |
| `S3_SECRET_ACCESS_KEY` | — | Secret key. |

## Running behind PgBouncer

Transaction pooling (`pool_mode=transaction`) needs two settings. Without them every `Entity.save` can hang until the query timeout, while the database itself looks healthy.

### 1. Disable prepared statements

```bash title=".env"
DB_DISABLE_PREPARE=true
```

Bun prepares statements per connection. Under transaction pooling the next transaction can land on a different backend, so `prepared statement does not exist` leaves the pooled connection stuck. `DB_DISABLE_PREPARE=true` turns that off. `?prepare=false` in the URL is not reliable.

Do not run the BunSane test suite with this flag. Object parameters become the string `"[object Object]"`.

### 2. Set timeouts on the server

`DB_STATEMENT_TIMEOUT` is dropped by PgBouncer. Set the role:

```sql
ALTER ROLE myapp SET statement_timeout = '15s';
ALTER ROLE myapp SET idle_in_transaction_session_timeout = '30s';
```

On PgBouncer, a lower `query_wait_timeout` (for example `30`) makes a drained pool fail fast.

The default `db` export is a lazy proxy, not the SQL instance. See [Database](./database.md#transactions).

## Health checks and liveness

| Endpoint | Purpose |
|----------|---------|
| `/health` | Database read, database write probe, cache. Use this for liveness. No `uptime` or `latency_ms`. |
| `/health/ready` | 503 until `init()` finishes and while shutting down. Same deep check otherwise. Fails on a saturated pool (`DB_POOL_SATURATION_READY_MS`) without failing liveness. |
| `/health/remote` | Remote subsystem. 404 if no metrics token and not `public`. 401 if a token is configured and the header is missing or wrong. |
| `/metrics` | Process, cache, and database JSON. Same rule as `/health/remote`. |
| `/docs`, `/openapi.json` | 404 if no docs token and not `public`. 401 if a token is configured and the header is missing or wrong. |

The write probe inserts into a temporary table inside a raw `db.transaction` and drops it on commit. It is a pooled write, not the `Entity.save` gateway transaction (no admission permit, no `SET LOCAL statement_timeout`). A `SELECT 1` cannot see a wedged write pool. Failure or `DB_HEALTH_WRITE_TIMEOUT` returns 503. A wedge inside admission is not what this probe detects.

```yaml title="Kubernetes"
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

```dockerfile title="Docker"
HEALTHCHECK --interval=10s --timeout=8s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1
```

Point liveness at `/health`, not a static route. A static route stays "healthy" when the write path is wedged.
