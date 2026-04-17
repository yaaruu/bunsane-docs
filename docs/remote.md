---
sidebar_position: 10
sidebar_label: Remote Communication
---

# Remote Communication

BunSane's remote subsystem carries events and RPC calls between independent applications over Redis Streams. Fire-and-forget events go one way; RPC calls await a response with a deadline. Both use the same underlying stream machinery -- one envelope format, one consumer group per app.

The subsystem is **opt-in**. Nothing runs until you call `app.enableRemote()` before `app.init()`.

## When to Use

| You want... | Use |
|---|---|
| "Order was created" -- other apps may care | `@RemoteEvent` + `emit()` |
| "Get order 123 from the orders app" | `@RemoteRpc` + `call()` |
| Emit only if my DB write committed | `emit(target, event, data, { trx })` via the outbox |

Remote is appropriate when two or more BunSane apps need to coordinate and share a Redis instance. Within a single app, use the GraphQL layer, hooks, or `pubSub` instead.

## Quickstart

```typescript
import App from "bunsane/core/App";
import { BaseService } from "bunsane/service";
import {
    RemoteEvent,
    RemoteRpc,
    registerRemoteHandlers,
    RemoteContext,
} from "bunsane/core/remote";

class OrderService extends BaseService {
    constructor(private app: App) {
        super();
        registerRemoteHandlers(this);
    }

    @RemoteEvent({ event: "order.created" })
    async onOrderCreated(data: { orderId: string }, ctx: RemoteContext) {
        console.log(`${ctx.sourceApp} created order ${data.orderId}`);
    }

    @RemoteRpc({ event: "order.get" })
    async getOrder(data: { id: string }, ctx: RemoteContext) {
        return { id: data.id, status: "pending" };
    }
}

const app = new App("orders");
app.enableRemote();
await app.init();
```

From any other app:

```typescript
const remote = app.getRemote()!;

// Fire-and-forget
await remote.emit("notifications", "order.created", { orderId: "abc" });

// RPC with 3-second timeout
const order = await remote.call<Order>("orders", "order.get", { id: "abc" }, { timeout: 3000 });
```

## Events

### Defining Handlers

```typescript
@RemoteEvent({ event: "user.registered" })
async onUserRegistered(data: UserPayload, ctx: RemoteContext) { ... }
```

Handler IDs default to `ClassName.methodName`. Override with `id` when the same class has multiple handlers for related events.

Multiple handlers may subscribe to the same event on one app -- they all run for each delivery. If any throws, the message is **not** ACKed. It stays in the PEL until the idle threshold elapses, then a future `XAUTOCLAIM` reclaims it. After `dlqMaxDeliveries` redeliveries the message is routed to the DLQ instead.

### Emitting

```typescript
await remote.emit(target, event, data);
```

| Arg | Type | Description |
|---|---|---|
| `target` | `string` | Destination app name. Written to stream `remote:<target>` |
| `event` | `string` | Event name used for handler routing |
| `data` | `unknown` | JSON-serializable payload |

Returns the Redis message id on success. Throws `RemoteError` on failure:

| `code` | Cause |
|---|---|
| `CIRCUIT_OPEN` | Circuit breaker rejected the publish (Redis persistently failing) |
| *(raw ioredis error)* | Publisher connection down and breaker still closed |

### At-Least-Once Delivery

Events are delivered via Redis consumer groups. If a handler fails, the message stays in the pending entries list (PEL). On startup, a new consumer calls `XAUTOCLAIM` to reclaim orphaned messages from dead consumers.

**Implications for handlers:**

- Handlers may run more than once for the same message. Make them idempotent.
- Successful runs produce `XACK` -- the message is removed from the PEL.
- `ctx.attempt` is `1` for normal delivery and `2` for messages recovered by the startup `XAUTOCLAIM` sweep. It does **not** count every redelivery -- messages that fail and get re-fetched by the running consumer loop still see `attempt: 1`. Use `ctx.messageId` for dedupe.

## RPC

### Defining Handlers

```typescript
@RemoteRpc({ event: "order.get" })
async getOrder(data: { id: string }, ctx: RemoteContext): Promise<Order> {
    const order = await Entity.FindById(data.id);
    if (!order) {
        throw new RemoteError("order not found", { code: "NOT_FOUND" });
    }
    return order.toJSON();
}
```

Return value becomes the RPC response. Throw `RemoteError` for custom error codes; any other thrown error becomes `{ code: "HANDLER_ERROR" }`.

Only one RPC handler per `(app, event)` pair. The `@RemoteRpc` decorator skips duplicate handler IDs (warning logged). Two handlers with distinct IDs bound to the same event will overwrite each other at `addRpcHandler` time (also warned).

### Calling

```typescript
const result = await remote.call<TResult>(
    target,    // destination app
    method,    // event name registered with @RemoteRpc
    data,      // payload
    { timeout: 5000 }
);
```

| Option | Default | Description |
|---|---|---|
| `timeout` | `5000` ms | Caller-side timeout. Handler sees this as `ctx.deadline` |

The request carries a `deadline` field. If the handler picks up the message after the deadline, it's silently dropped (ACKed without running) -- the caller already timed out.

### Errors

All call() failures reject with `RemoteError`:

| `code` | Cause |
|---|---|
| `TIMEOUT` | No response within `timeout` ms |
| `NOT_FOUND` | Target app has no `@RemoteRpc` handler for the event |
| `INVALID_TARGET` | Called with target `"*"` -- RPC does not support broadcast |
| `HANDLER_ERROR` | Handler threw a non-`RemoteError` exception |
| `PUBLISH_FAILED` | XADD to request stream failed |
| `CIRCUIT_OPEN` | Circuit breaker rejected the publish attempt |
| `SHUTDOWN` | RemoteManager draining or stopped |
| Custom | Handler threw `new RemoteError(msg, { code: "X" })` -- the code flows through |

`RemoteError` exposes `code`, `sourceApp`, and optional `extensions`:

```typescript
import { RemoteError } from "bunsane/core/remote";

try {
    await remote.call("orders", "order.get", { id });
} catch (err) {
    if (err instanceof RemoteError && err.code === "TIMEOUT") {
        // retry or fall back
    }
    throw err;
}
```

### Per-Instance Response Stream

Each `RemoteManager.start()` generates a UUID and creates a dedicated response stream `rpc:responses:<uuid>`. Responses are capped via `MAXLEN ~ 1000` so the stream cannot grow unbounded.

**The stream is not cleaned up across restarts.** Memory per orphan stream is bounded by `MAXLEN ~ 1000`, so this is not a leak. If orphan stream count becomes large in long-running clusters, add a periodic `SCAN` + age-based `DEL` sweep in your app.

## Transactional Outbox

Direct `emit()` is a standalone Redis write with no DB transaction involvement. If you emit and then the surrounding DB write rolls back (or the process crashes between the emit and the commit), consumers see an event for a write that never happened. For flows where that would corrupt downstream state, use the transactional outbox.

### Enabling the Outbox

Opt in at `enableRemote()` time:

```typescript
app.enableRemote({
    enableOutbox: true,
});
```

When enabled, `RemoteManager.start()` creates the `remote_outbox` table if missing (partial index on pending rows) and runs a background worker that publishes pending rows to Redis.

### Transactional Emit

Pass `{ trx }` to route an event through the outbox:

```typescript
await db.transaction(async (trx) => {
    await order.save(trx);
    await this.app.getRemote()!.emit(
        "notifications",
        "order.created",
        { orderId: order.id },
        { trx }
    );
    // Commit: row appears in remote_outbox with published_at = NULL.
    // Rollback: row never exists, nothing is published.
});
```

Behavior:

- Without `{ trx }`: direct XADD. No DB write. Fast, at-least-once.
- With `{ trx }`: one `INSERT INTO remote_outbox` in the caller's transaction. The worker picks it up after commit and publishes to the same `remote:<target>` stream used by direct emits. Subscribers cannot tell the difference.

Returns the Redis message id (direct) or the outbox row id (transactional).

### Worker Behavior

The OutboxWorker polls every `outboxPollIntervalMs` (default `1000`) and processes up to `outboxBatchSize` rows per tick (default `100`). Each tick:

1. `BEGIN`
2. `SELECT ... WHERE published_at IS NULL ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`
3. For each row, `XADD` to `remote:<target>`. XADD failures leave the row pending.
4. `UPDATE remote_outbox SET published_at = NOW() WHERE id = ANY(successIds)`
5. `COMMIT`

`FOR UPDATE SKIP LOCKED` coordinates across multiple app instances -- each row is processed by exactly one worker per batch. No distributed locks required.

### At-Least-Once Semantics

A crash between `XADD` and the `UPDATE` commit will republish the row on the next tick. Event handlers must be idempotent:

```typescript
@RemoteEvent({ event: "order.created" })
async onOrderCreated(data, ctx) {
    if (await this.dedupe.seen(ctx.messageId)) return;
    await this.doWork(data);
    await this.dedupe.mark(ctx.messageId);
}
```

This is the same requirement as for direct `emit()` -- XAUTOCLAIM redelivery produces the same risk.

### Retention

Published rows are not deleted. The partial index `idx_remote_outbox_pending` keeps polling performance stable regardless of history size, but the table grows indefinitely. Add your own cleanup job if you need to trim it:

```sql
DELETE FROM remote_outbox
WHERE published_at IS NOT NULL
  AND published_at < NOW() - INTERVAL '7 days';
```

### Schema

```sql
CREATE TABLE remote_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target VARCHAR(255) NOT NULL,
    event VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX idx_remote_outbox_pending
ON remote_outbox (created_at)
WHERE published_at IS NULL;
```

No retry count, no DLQ column, no lease columns. Keep it minimal -- extend when there's a concrete reason.

## Handler Context

```typescript
interface RemoteContext {
    sourceApp: string;        // App that emitted/called
    messageId: string;        // Redis stream message id
    timestamp: Date;          // When sender emitted
    attempt: number;          // 1 on first delivery, 2 if XAUTOCLAIM-reclaimed
    correlationId?: string;   // RPC only
    deadline?: Date;          // RPC only -- when caller gives up
}
```

## Enabling Remote

Call `enableRemote()` before `init()`:

```typescript
const app = new App("orders");
app.enableRemote({ enableLogging: true });
await app.init();
```

`RemoteManagerConfig` options:

| Option | Default | Description |
|---|---|---|
| `appName` | App's name | Stream name suffix and `sourceApp` field |
| `consumerGroup` | `appName` | Redis consumer group name |
| `consumerId` | `consumer-<pid>-<ts>` | Consumer identity within the group |
| `streamPrefix` | `"remote:"` | Prefix for event streams |
| `enableLogging` | `false` | Verbose debug logs |
| `batchSize` | `10` | Messages per XREADGROUP call |
| `blockMs` | `2000` | XREADGROUP BLOCK timeout |
| `autoClaimIdleMs` | `60000` | XAUTOCLAIM idle threshold on startup. `0` disables |
| `responseStreamMaxLen` | `1000` | MAXLEN ~ cap for RPC response streams |
| `defaultCallTimeout` | `5000` | Default `call()` timeout |
| `shutdownDrainMs` | `2000` | Grace window for pending RPC calls during shutdown |
| `enableOutbox` | `false` | Enable transactional outbox + background worker |
| `outboxPollIntervalMs` | `1000` | Outbox worker poll interval |
| `outboxBatchSize` | `100` | Max outbox rows processed per tick |
| `circuitBreakerThreshold` | `5` | Consecutive publisher failures before the breaker opens |
| `circuitBreakerResetMs` | `30000` | Reset window before a half-open trial |
| `dlqMaxDeliveries` | `3` | Move a message to the DLQ after this many deliveries. `0` disables |

## Environment Variables

Redis connection is read from the same env vars as the cache layer:

| Var | Default |
|---|---|
| `REDIS_HOST` | `localhost` |
| `REDIS_PORT` | `6379` |
| `REDIS_PASSWORD` | (none) |
| `REDIS_DB` | `0` |

Remote opens three Redis connections: a publisher (retries enabled), a blocking stream consumer, and a blocking RPC response listener. The blocking connections set `maxRetriesPerRequest: null` -- required by ioredis for XREAD/XREADGROUP with BLOCK, since the retry budget would cancel long-running commands.

## Stream Layout

```
remote:<appName>              event stream for that app
rpc:responses:<instanceId>    per-instance RPC response stream
```

Every message carries a JSON envelope under the `data` field. Shape (TypeScript):

```typescript
interface RemoteEnvelope {
    kind: "event" | "rpc_request";    // default "event" if absent
    sourceApp: string;
    event: string;
    data: unknown;
    emittedAt: number;                // unix ms

    // RPC only
    correlationId?: string;
    replyTo?: string;                 // response stream key
    deadline?: number;                // unix ms
}
```

Additional streams:

```
remote:<appName>:dlq          per-app dead-letter queue
```

DLQ entries carry the original fields plus `original_id`, `delivery_count`, `moved_at`.

## Lifecycle

Remote hooks into the normal App lifecycle:

1. `enableRemote(config)` stores config -- no Redis connection yet.
2. `app.init()` -> `SYSTEM_READY` phase:
   - RemoteManager constructs, Redis conns open.
   - `XGROUP CREATE` creates the consumer group (idempotent).
   - `XAUTOCLAIM` reclaims orphaned PEL messages.
   - Consumer loop starts; RPC response listener starts; OutboxWorker starts (if enabled).
   - `registerRemoteHandlers(service)` runs for each registered service.
3. `app.shutdown()` drains in order:
   - `OutboxWorker.flush()` then `.stop()` -- best-effort final publish of committed-but-unpublished rows.
   - `RpcCaller.stop(shutdownDrainMs)` -- wait for pending calls or reject with `SHUTDOWN`.
   - `StreamConsumer.stop()` -- wait for in-flight handler.
   - Disconnect Redis connections.

The remote layer shuts down **after** the scheduler and **before** the cache and database. The outbox worker needs DB access during its final flush, which is why remote shutdown runs before `db.close()`.

## Operational Signals

### Metrics

`RemoteManager.getMetrics()` returns a counter snapshot. The same payload is merged under `remote` in the `/metrics` HTTP endpoint.

```json
{
  "emit":   { "direct": 0, "outbox": 0, "failed": 0 },
  "events": { "received": 0, "handled": 0, "handlerFailed": 0, "noHandler": 0, "dlq": 0 },
  "rpc":    { "called": 0, "succeeded": 0, "failed": 0, "timedOut": 0,
              "handlerExecuted": 0, "handlerFailed": 0, "pastDeadline": 0 },
  "outbox": { "claimed": 0, "published": 0, "publishFailed": 0 },
  "circuitBreaker": { "trips": 0, "rejected": 0, "state": "closed" }
}
```

### Health Check

`GET /health/remote` returns a JSON health report. `200` when all checks pass, `503` when any degrade.

```json
{
  "healthy": true,
  "checks": {
    "redis":    { "ok": true, "latencyMs": 2 },
    "consumer": { "streamKey": "remote:orders", "pelCount": 0 },
    "dlq":      { "stream": "remote:orders:dlq", "length": 0 },
    "outbox":   { "pendingCount": 0 },
    "circuitBreaker": { "state": "closed", "failures": 0 }
  },
  "timestamp": "2026-04-17T12:00:00.000Z"
}
```

Signals considered unhealthy:

- Redis ping fails
- Circuit breaker is `open`

Non-fatal degradations (reported but do not flip `healthy` to false):

- PEL count high
- DLQ non-empty
- Outbox pending count growing

Use the metrics endpoint + your monitoring thresholds to page on those.

### Circuit Breaker

Wraps the publisher so a sustained Redis outage fails fast instead of stalling every caller on the ioredis command timeout.

States:

- `closed` — normal operation. Failures are counted.
- `open` — publisher call rejected immediately. `emit()` throws `RemoteError { code: "CIRCUIT_OPEN" }`; `call()` rejects with `RemoteError { code: "CIRCUIT_OPEN" }` (other publish errors map to `PUBLISH_FAILED`). Opens after `circuitBreakerThreshold` consecutive failures (default 5).
- `half-open` — after `circuitBreakerResetMs` (default 30 s), one trial call is allowed. Success closes the breaker; failure reopens it.

The breaker protects `emit()` and the RPC request XADD. Outbox publishing and RPC response XADD are not wrapped — the outbox already has built-in retry, and RPC responses on the server side should not stall the consumer loop.

Config:

| Option | Default | Description |
|---|---|---|
| `circuitBreakerThreshold` | `5` | Consecutive failures before opening |
| `circuitBreakerResetMs` | `30000` | Reset window before half-open trial |

When the breaker rejects a call it throws a `CircuitOpenError` (exported from `bunsane/core/remote`). This is caught and wrapped into `RemoteError { code: "CIRCUIT_OPEN" }` at the public API boundary, so most callers should match on `err.code`. `instanceof CircuitOpenError` is available if you need a structural check inside the internals.

### Dead Letter Queue

Messages that fail repeatedly are moved to a per-app DLQ stream so the main stream can progress past them.

- Stream name: `remote:<appName>:dlq`
- Triggered when a message's delivery count (from `XPENDING`) reaches `dlqMaxDeliveries` (default `3`)
- DLQ entry carries `original_id`, `delivery_count`, `moved_at`, plus the full original envelope
- MAXLEN cap of `~10000` keeps the DLQ bounded

Disable by setting `dlqMaxDeliveries: 0` in `enableRemote()`.

Consume and act on DLQ entries with any Redis client; there is no built-in handler.

```typescript
// Manually inspect the DLQ
const entries = await redis.xrange("remote:orders:dlq", "-", "+", "COUNT", 50);
```

## Programmatic Access

Most code reaches `RemoteManager` via `app.getRemote()`. Two additional helpers are exported for tests and advanced setups:

```typescript
import {
    getRemoteManager,
    setRemoteManager,
    ensureOutboxSchema,
} from "bunsane/core/remote";

// Access the singleton outside an App instance (e.g., in a test harness)
const manager = getRemoteManager();

// Override the singleton for tests
setRemoteManager(mockManager);

// Manually ensure the remote_outbox table exists (e.g., from a migration script)
await ensureOutboxSchema(db);
```

`setRemoteManager(null)` clears the registration. This does not stop a running manager -- call `shutdown()` first.

## Limits and Non-Goals

- **No broadcast RPC.** `call("*", ...)` throws `INVALID_TARGET`. Use `emit("*", ...)` for fan-out, but emit writes to a literal `remote:*` stream -- it is not service discovery.
- **No built-in DLQ consumer.** The DLQ captures poison messages but nothing reprocesses them. Consume with any Redis client.
- **No service discovery.** Broadcast `"*"` writes to a literal `remote:*` stream; nothing enumerates known apps.
- **No typed event registry.** `event` is a free-form string. Callers and handlers agree by convention. A type-safe registry is deferred until there's a concrete use case.
- **Outbox grows indefinitely.** Successful rows stay in `remote_outbox`. Add your own cleanup job (see Transactional Outbox → Retention).

## Error Handling Pattern

For events, handlers should be idempotent and allow redelivery on failure:

```typescript
@RemoteEvent({ event: "order.created" })
async onOrderCreated(data: { orderId: string }, ctx: RemoteContext) {
    // Dedupe by message id -- XAUTOCLAIM may redeliver
    if (await this.alreadyProcessed(ctx.messageId)) return;
    await this.doWork(data);
    await this.markProcessed(ctx.messageId);
}
```

For RPC, prefer specific error codes over generic throws:

```typescript
@RemoteRpc({ event: "order.get" })
async getOrder(data: { id: string }) {
    const order = await Entity.FindById(data.id);
    if (!order) throw new RemoteError("not found", { code: "NOT_FOUND" });
    if (!order.isPublic) throw new RemoteError("forbidden", { code: "FORBIDDEN" });
    return order.toJSON();
}
```

When Redis is flapping, `CIRCUIT_OPEN` is the signal to degrade gracefully:

```typescript
try {
    await remote.emit("notifications", "order.created", payload);
} catch (err) {
    if (err instanceof RemoteError && err.code === "CIRCUIT_OPEN") {
        // Breaker is open -- fall back to outbox so we don't lose the event.
        await db.transaction(async (trx) => {
            await remote.emit("notifications", "order.created", payload, { trx });
        });
        return;
    }
    throw err;
}
```

Transactional emit (`{ trx }`) is **not** wrapped by the breaker -- it only writes to the DB. The OutboxWorker will retry Redis publishing indefinitely until the breaker closes.

