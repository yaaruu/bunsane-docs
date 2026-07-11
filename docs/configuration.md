---
sidebar_position: 11
sidebar_label: Configuration
---

# Configuration

BunSane is configured almost entirely through environment variables, with a few
runtime setters (`app.setCacheConfig()`, `app.setGraphQLMaxComplexity()`, etc.)
for things you may want to change in code. This page is the reference for every
environment variable the framework reads, grouped by subsystem. Defaults match
the framework source.

On startup, `validateEnv()` checks a subset of these (numeric/enum formats, and
that a database connection is configured) and throws before the server binds if
anything is invalid.

## Database connection

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_CONNECTION_URL` | — | Full PostgreSQL connection string. When set, it **overrides** the `POSTGRES_*` fields below. |
| `POSTGRES_HOST` | — | DB host (required if no `DB_CONNECTION_URL`). |
| `POSTGRES_USER` | — | DB user (required if no `DB_CONNECTION_URL`). |
| `POSTGRES_PASSWORD` | — | DB password. |
| `POSTGRES_DB` | — | Database name (required if no `DB_CONNECTION_URL`). |
| `POSTGRES_PORT` | `5432` | DB port. |
| `POSTGRES_MAX_CONNECTIONS` | `20` | Connection pool size. |

A connection requires **either** `DB_CONNECTION_URL` **or** the trio
`POSTGRES_HOST` + `POSTGRES_USER` + `POSTGRES_DB`.

```bash title=".env"
# Option A — single URL
DB_CONNECTION_URL="postgres://user:password@localhost:5432/myapp"

# Option B — individual fields
POSTGRES_HOST=localhost
POSTGRES_USER=user
POSTGRES_PASSWORD=password
POSTGRES_DB=myapp
```

:::warning
Use `DB_CONNECTION_URL`, not `DATABASE_URL`. The framework's SQL client reads
`DB_CONNECTION_URL` (or the `POSTGRES_*` fields). `DATABASE_URL` is only read
into an internal config object and does **not** drive the live connection.
:::

## Database behavior & timeouts

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_QUERY_TIMEOUT` | `30000` (ms) | Client-side wall-clock timeout for `Query.exec/count/sum/average` and `Entity.save`. **JS-side only** — it raises a client error and rolls back the transaction, but does not by itself kill the server-side query (see `DB_STATEMENT_TIMEOUT`). |
| `DB_CONNECTION_TIMEOUT` | `30` (s) | How long the pool waits for a free connection before rejecting. Consider `5` for user-facing services so requests fail fast instead of queueing. |
| `DB_STATEMENT_TIMEOUT` | unset (ms) | Opt-in server-side `statement_timeout` appended to the connection URL, so PostgreSQL kills runaway queries. **Skipped under PgBouncer** (it rejects startup parameters) and under PGlite — set it on the database role instead when behind PgBouncer. |
| `DB_DISABLE_PREPARE` | `false` | `true` disables Bun SQL's automatic server-side prepared statements. **Required behind PgBouncer in transaction pooling mode** — see [Running behind PgBouncer](#running-behind-pgbouncer). |
| `DB_SAVE_PROFILE` | `false` | `true` logs per-phase `Entity.save` timings (`db`, `cache`, `hooks`, `total`). |

## Health checks

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_DB_WRITE_PROBE` | `true` | The `/health` endpoint runs a real **write** probe through the same transaction path `Entity.save` uses, so a wedged write pool fails liveness and the orchestrator restarts the container. Set `false` to fall back to a read-only `SELECT 1`. |
| `DB_HEALTH_WRITE_TIMEOUT` | `5000` (ms) | Short, independent timeout for the write probe so a wedge is caught quickly rather than waiting on the 30s request timeout. |

See [Health checks & liveness](#health-checks--liveness).

## Application & HTTP

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `3000` | HTTP listen port. |
| `NODE_ENV` | `development` | `development` \| `production` \| `test`. Affects error verbosity, security headers, and logging. |
| `SHUTDOWN_GRACE_PERIOD_MS` | framework default | Max time to drain in-flight requests on SIGTERM/SIGINT. Also `app.setShutdownGracePeriod(ms)`. |
| `MAX_REQUEST_BODY_SIZE` | framework default | Max request body size in bytes. Also `app.setMaxRequestBodySize(bytes)`. |

## GraphQL

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHQL_MAX_DEPTH` | `15` (floor) | Max query depth. Hard floor of 15 — `0` no longer disables it. Also `app.setGraphQLMaxDepth(n)`. |
| `GRAPHQL_MAX_COMPLEXITY` | `1000` | Max query complexity (per-field cost × `first`/`limit`/`take`). Also `app.setGraphQLMaxComplexity(n)`. |

## Query engine

| Variable | Default | Description |
|----------|---------|-------------|
| `BUNSANE_DEFAULT_QUERY_LIMIT` | `10000` | Default `LIMIT` applied to `Query.exec()` calls with no `.take()`. `0` disables. Logs a warning when applied. |
| `BUNSANE_USE_LATERAL_JOINS` | `true` | Use LATERAL joins for multi-component queries (PG12+). |
| `BUNSANE_PARTITION_STRATEGY` | `list` | Component partition strategy: `list` or `hash`. Changing this on an existing database is guarded against data loss. |
| `BUNSANE_USE_DIRECT_PARTITION` | `true` | Query partition tables directly. |
| `BUNSANE_DB_SLOW_MS` | framework default | Slow-query log threshold in milliseconds. |

## Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | `false` | Master switch for caching. Also `app.setCacheConfig({...})`. |
| `CACHE_PROVIDER` | `memory` | `memory` \| `redis` \| `multilevel` \| `noop`. |
| `CACHE_DEFAULT_TTL` | `3600000` (ms) | Default TTL (1 hour). |
| `CACHE_MAX_MEMORY` | `104857600` | In-memory cache cap in bytes (100 MB). |
| `CACHE_STRATEGY` | `write-invalidate` | `write-through` \| `write-invalidate`. |
| `CACHE_ENTITY_ENABLED` | `true` | Entity-level cache. |
| `CACHE_ENTITY_TTL` | `3600000` | Entity cache TTL (1 hour). |
| `CACHE_COMPONENT_ENABLED` | `true` | Component cache. |
| `CACHE_COMPONENT_TTL` | `1800000` | Component cache TTL (30 minutes). |
| `CACHE_QUERY_ENABLED` | `true` | Query result cache. |
| `CACHE_QUERY_TTL` | `1800000` | Query cache TTL (30 minutes). |
| `CACHE_QUERY_MAX_SIZE` | `10000` | Max cached query results. |

### Redis

Used when `CACHE_PROVIDER` is `redis`/`multilevel`, and by the Remote subsystem.

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis host. |
| `REDIS_PORT` | `6379` | Redis port. |
| `REDIS_PASSWORD` | — | Redis password. |
| `REDIS_DB` | `0` | Redis DB index. |
| `REDIS_KEY_PREFIX` | `bunsane:` | Key prefix. |
| `REDIS_MAX_RECONNECT_ATTEMPTS` | `20` | Capped reconnect attempts so an unreachable Redis doesn't spin forever. |
| `REDIS_ENABLE_OFFLINE_QUEUE` | `false` | Offline command queue. Off by default to bound heap growth during an outage. |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Pino log level. |
| `LOG_PRETTY` | — | Pretty-print logs (development). |
| `DEBUG` | `false` | Framework debug mode. |

## S3 / file uploads

Opt-in — only needed if you use file uploads with S3-compatible storage.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET` | — | Bucket name. When set, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are required (or use IAM roles and omit `S3_BUCKET`). |
| `S3_REGION` | — | Region. |
| `S3_ENDPOINT` | — | Custom endpoint (MinIO / Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | — | Access key. |
| `S3_SECRET_ACCESS_KEY` | — | Secret key. |

---

## Running behind PgBouncer

Running BunSane behind PgBouncer in **transaction pooling mode**
(`pool_mode=transaction`) requires two settings. Without them the write path can
wedge: every `Entity.save` hangs for 30 seconds and the process stops accepting
writes, even though the database itself looks completely healthy.

### 1. Disable prepared statements

```bash title=".env"
DB_DISABLE_PREPARE=true
```

Bun's SQL driver automatically creates **server-side named prepared statements
per connection** (it's on by default). With transaction pooling, each
transaction can land on a *different* backend connection, so a prepared
statement created on connection A won't exist on connection B — producing
`prepared statement "..." does not exist` / `already exists` errors. That error
can leave the pooled connection in a broken transaction state that the driver's
pool doesn't recover, so every later write waits and times out.

`DB_DISABLE_PREPARE=true` turns the feature off. The only cost is a little extra
query planning per statement — negligible compared to the outage it prevents,
and prepared statements aren't usable under transaction pooling anyway.

:::note
`?prepare=false` in the connection URL is *postgres.js* syntax and is **not**
reliably honored by Bun's driver. Use `DB_DISABLE_PREPARE=true` instead.
:::

### 2. Set timeouts on the server, not the app

`DB_STATEMENT_TIMEOUT` is ignored under PgBouncer because PgBouncer rejects the
startup parameter. Set the timeout on the database role instead, so PostgreSQL
kills runaway queries even when the application can't:

```sql
ALTER ROLE myapp SET statement_timeout = '15s';
ALTER ROLE myapp SET idle_in_transaction_session_timeout = '30s';
```

On PgBouncer itself, lowering `query_wait_timeout` (e.g. `30`) makes a drained
pool fail fast instead of hanging.

---

## Health checks & liveness

BunSane exposes several health endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/health` | Deep health check: database read, database **write probe**, and cache. Use this for liveness. |
| `/health/ready` | Readiness — returns 503 until `init()` completes and while shutting down; otherwise runs the same deep check. |
| `/health/remote` | Remote subsystem health (only when `app.enableRemote()` is used). |
| `/metrics` | Process, cache, and database statistics as JSON. |

The `/health` endpoint runs a **real database write** — a temporary-table
insert inside a transaction, dropped on commit, so it has no lasting effect —
using the same connection path as `Entity.save`. A plain `SELECT 1` can't detect
a wedged *write* pool because it runs on any idle read connection. If the write
probe fails or times out (`DB_HEALTH_WRITE_TIMEOUT`, default 5s), `/health`
returns **503**.

:::tip
Point your container's **liveness** probe at `/health`, not at a static route.
A static route stays "healthy" even when the write path is wedged, so the
container never restarts. With `/health`, a wedge fails the probe and the
orchestrator restarts the container automatically.
:::

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
