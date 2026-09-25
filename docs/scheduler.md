---
sidebar_position: 9
sidebar_label: Scheduler
---

# Scheduler

The scheduler runs recurring tasks that operate on entities. Define tasks with the `@ScheduledTask` decorator on service methods -- the scheduler handles timing, entity querying, retries, distributed locking, and metrics automatically.

## Defining Scheduled Tasks

Import `ScheduledTask`, `ScheduleInterval`, and `registerScheduledTasks` from `"bunsane"`:

```typescript
import { BaseService, Query, ScheduleInterval, ScheduledTask } from "bunsane";

class SessionService extends BaseService {
    @ScheduledTask({
        interval: ScheduleInterval.HOUR,
        query: () => new Query().with(SessionComponent).without(AuthenticatedTag),
    })
    async cleanExpiredSessions(entities: Entity[]) {
        for (const entity of entities) {
            await entity.delete();
        }
    }
}
```

The decorator stores metadata on the class. At `SYSTEM_READY`, boot calls `registerScheduledTasks` for every registered service. You may also call it yourself; registration is deduped by task id. The task id is `ClassName.methodName` unless you set `id`.

You do not have to call `registerScheduledTasks` in the constructor. Boot does it after services are registered. Call it yourself only if you register a service after boot.


## Schedule Intervals

| Value | Period |
|---|---|
| `ScheduleInterval.MINUTE` | 60 seconds |
| `ScheduleInterval.HOUR` | 1 hour |
| `ScheduleInterval.DAILY` | 24 hours |
| `ScheduleInterval.WEEKLY` | 7 days |
| `ScheduleInterval.MONTHLY` | ~30 days |
| `ScheduleInterval.CRON` | Custom cron expression |

For intervals longer than 24 hours, the scheduler uses a 24-hour polling loop internally to avoid JavaScript timer overflow.

## Cron Expressions

Use `ScheduleInterval.CRON` with a `cronExpression` for precise timing. BunSane includes a built-in cron parser with zero dependencies.

Supported fields: 5-field (`minute hour dayOfMonth month dayOfWeek`) and 6-field (`second minute hour dayOfMonth month dayOfWeek`).

Standard cron syntax is supported: `*`, `*/5`, `1-5`, `1,3,5`, `1-5/2`.

```typescript
@ScheduledTask({
    interval: ScheduleInterval.CRON,
    cronExpression: "0 2 * * 1",   // Every Monday at 2 AM
})
async weeklyReport(entities: Entity[]) { ... }

@ScheduledTask({
    interval: ScheduleInterval.CRON,
    cronExpression: "*/15 * * * *", // Every 15 minutes
})
async frequentSync(entities: Entity[]) { ... }

@ScheduledTask({
    interval: ScheduleInterval.CRON,
    cronExpression: "0 0 1 * *",   // First day of every month at midnight
})
async monthlyBilling(entities: Entity[]) { ... }
```

## Task Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | `ScheduleInterval` | (required) | How often the task runs |
| `id` | `string` | `Class.method` | Unique task identifier |
| `name` | `string` | `Class.method` | Human-readable name |
| `query` | `() => Query` | -- | Function returning an entity query |
| `cronExpression` | `string` | -- | Required when interval is `CRON` |
| `runOnStart` | `boolean` | `false` | Run immediately on startup |
| `timeout` | `number` | `30000` | Max execution time in ms |
| `priority` | `number` | `0` | Higher values run first |
| `maxRetries` | `number` | `0` | Retry attempts on failure |
| `retryDelay` | `number` | `1000` | ms between retries |
| `continueOnError` | `boolean` | `false` | Keep running after unhandled errors |
| `maxEntitiesPerExecution` | `number` | `1000` when the query has no smaller `.take()` | Cap rows loaded per tick (0.7+) |
| `enableMetrics` | `boolean` | -- | Enable per-task metrics collection |
| `enableLogging` | `boolean` | -- | Verbose per-task logging |

## Entity Targeting

### query (recommended)

The `query` function gives you full access to the Query API:

```typescript
@ScheduledTask({
    interval: ScheduleInterval.DAILY,
    query: () => new Query()
        .with(OrderComponent)
        .with(PaymentComponent)
        .without(CompletedTag)
        .take(500),
})
async processOpenOrders(entities: Entity[]) { ... }
```

A query with no `maxEntitiesPerExecution` and no smaller `.take()` is capped at **1000** entities (0.7+). If a run returns that many rows, the scheduler warns once per task. Set `maxEntitiesPerExecution`, or `.take()` inside the query, when 1000 is not the limit you want. `.take()` smaller than 1000 is left alone.

### componentTarget (deprecated)

The `componentTarget` option accepts a `ComponentTargetConfig` object with `includeComponents`, `excludeComponents`, `archetype`, and similar fields. It is preserved for backward compatibility. All new tasks should use `query`.

## Execution Flow

For each tick the scheduler:

1. Checks whether the task is enabled and the concurrency limit has not been reached
2. Attempts to acquire a distributed lock (if enabled)
3. Executes the query to fetch matching entities
4. Calls the task method with the entity array
5. Handles success or failure, updates metrics
6. Releases the lock

## Retries

When `maxRetries > 0`, a failed task is retried up to that many times with `retryDelay` ms between attempts. Each retry emits a `task.retry` event.

```typescript
@ScheduledTask({
    interval: ScheduleInterval.HOUR,
    query: () => new Query().with(InvoiceComponent).without(SentTag),
    maxRetries: 3,
    retryDelay: 5000,
})
async sendInvoices(entities: Entity[]) { ... }
```

## Distributed Locking

The default backend is a PostgreSQL **lease** (`BUNSANE_LOCK_BACKEND=auto` selects postgres). It is one short transaction per acquire, renew, and release, so it works behind PgBouncer transaction pooling. Advisory locks are opt-in. They need a session-pinned connection and are not the default.

The lease is renewed about every TTL/3 (minimum 1 second) while the task runs. TTL is at least the task timeout plus 5 seconds. A wrapper timeout does not release the lease until the task function settles. If renewal fails, the lease was lost and the critical section is no longer protected.

When a second instance cannot take the lock, the scheduler emits `task.skipped` and moves on. It does not queue.

See [Configuration](./configuration.md) for `BUNSANE_LOCK_BACKEND`.

## Manual Locking (`withLock`)

`withLock` is on the root barrel. It uses the same lease backend as the scheduler.

```typescript
import { withLock } from "bunsane";

const res = await withLock("rebuild-search-index", async () => {
    await rebuildIndex();
    return "done";
});

if (!res.acquired) {
    // Another holder has the lock.
} else {
    console.log(res.result);
}
```

`withLock(key, fn, options?)` acquires the lock, runs `fn`, renews the lease about every TTL/3, and releases afterward — including when `fn` throws. Contention returns `{ acquired: false }` unless `throwOnContention` is set, in which case it throws `LockUnavailableError` (also on the root barrel).

| Option | Default | Description |
|---|---|---|
| `wait` | `0` | Max ms to wait. `0` tries once |
| `retryInterval` | `100` | Ms between attempts |
| `throwOnContention` | `false` | Throw `LockUnavailableError` instead of `{ acquired: false }` |
| `onContended` | — | Called before the contention return or throw |
| `leaseTtlMs` | backend default (30000) | Lease lifetime. Heartbeat is about TTL/3, at least 1 second |

Same-process re-entry of a key this call already holds returns `{ acquired: false }` (or waits, then gives up). Do not nest the same key. If scheduler distributed locking is disabled, acquire reports success and takes no database lock.

## Scheduler Configuration

Configure the scheduler globally via `SchedulerManager.updateConfig()`:

```typescript
import { SchedulerManager } from "bunsane/core/SchedulerManager";

SchedulerManager.getInstance().updateConfig({
    maxConcurrentTasks: 10,
    enableLogging: true,
    distributedLocking: true,
    lockTimeout: 2000,
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master enable switch |
| `maxConcurrentTasks` | `number` | `5` | Max simultaneously running tasks |
| `defaultTimeout` | `number` | `30000` | Default task timeout in ms |
| `enableLogging` | `boolean` | `false` | Verbose scheduler logging |
| `runOnStart` | `boolean` | `true` | Auto-start when the app reaches ready state |
| `distributedLocking` | `boolean` | `true` | Enable distributed locks. Default backend is a PostgreSQL lease, not advisory locks |
| `lockTimeout` | `number` | `0` | Lock wait time in ms |
| `lockRetryInterval` | `number` | `100` | ms between lock retries |

The scheduler starts automatically when the app reaches the `APPLICATION_READY` phase (if `runOnStart` is `true`). It stops cleanly during `App.shutdown()`.

## Simple Jobs (Non-ECS)

For tasks that do not need entity queries, use `scheduleJob`:

```typescript
import { SchedulerManager } from "bunsane/core/SchedulerManager";

const scheduler = SchedulerManager.getInstance();

const job = scheduler.scheduleJob("cache-warm", "0 */6 * * *", async () => {
    await warmCache();
});

job.cancel();
```

`scheduleJob` accepts any valid cron expression and returns a handle with a `cancel()` method.

## Task Control

```typescript
const scheduler = SchedulerManager.getInstance();

scheduler.disableTask("SessionService.cleanExpiredSessions");
scheduler.enableTask("SessionService.cleanExpiredSessions");

await scheduler.executeTaskNow("SessionService.cleanExpiredSessions");
```

`executeTaskNow` is useful for manual triggers and testing -- it runs through the full execution flow including distributed locking.

## Events

Subscribe to scheduler events with `addEventListener`:

```typescript
scheduler.addEventListener((event) => {
    if (event.type === "task.failed") {
        alerting.notify(`Task ${event.taskId} failed: ${event.data?.error}`);
    }
});
```

Available event types:

| Event | When |
|---|---|
| `task.registered` | Task registered at boot |
| `task.executed` | Task completed successfully |
| `task.failed` | Task threw an error (after all retries) |
| `task.timeout` | Task exceeded its timeout |
| `task.retry` | Task is being retried |
| `task.skipped` | Task skipped (concurrency limit or lock unavailable). `task.lock.failed` is in the type union and is never emitted |
| `task.lock.acquired` | Distributed lock acquired |
| `task.lock.released` | Distributed lock released |
| `scheduler.started` | Scheduler started |
| `scheduler.stopped` | Scheduler stopped |

## Metrics

```typescript
const metrics = scheduler.getMetrics();
// {
//   totalTasks, runningTasks,
//   completedExecutions, failedExecutions,
//   averageExecutionTime, totalExecutionTime,
//   timedOutTasks, retriedTasks, skippedExecutions,
//   lockAttempts, locksAcquired,
//   taskMetrics: { ... }
// }

const taskMetrics = scheduler.getTaskMetrics("SessionService.cleanExpiredSessions");
// {
//   taskId, taskName,
//   totalExecutions, successfulExecutions, failedExecutions,
//   averageExecutionTime, lastExecutionTime,
//   totalEntitiesProcessed, retryCount, timeoutCount
// }
```

Scheduler metrics are included in the `/metrics` HTTP endpoint response alongside cache and process stats.

## Example: Full Service

```typescript
import { App, BaseService, Query, ScheduleInterval, ScheduledTask } from "bunsane";
import { SchedulerManager } from "bunsane/core/SchedulerManager";

class MaintenanceService extends BaseService {
    constructor(private app: App) {
        super();

        this.registerCacheWarmJob();
    }

    // Clean up expired sessions every hour
    @ScheduledTask({
        interval: ScheduleInterval.HOUR,
        query: () => new Query().with(SessionComponent).without(ActiveTag),
        timeout: 60_000,
        maxRetries: 2,
        retryDelay: 10_000,
    })
    async cleanExpiredSessions(entities: Entity[]) {
        for (const entity of entities) {
            await entity.delete();
        }
    }

    // Generate daily usage report at 1 AM
    @ScheduledTask({
        interval: ScheduleInterval.CRON,
        cronExpression: "0 1 * * *",
        query: () => new Query().with(UserComponent).with(ActivityComponent).take(500),
        timeout: 120_000,
        priority: 10,
    })
    async generateDailyReport(entities: Entity[]) {
        const stats = entities.reduce((acc, entity) => {
            // aggregate activity data
            return acc;
        }, { activeUsers: 0, totalEvents: 0 });

        await ReportService.store("daily-usage", stats);
    }

    // Simple job: warm cache every 6 hours (no entity query needed)
    private registerCacheWarmJob() {
        const scheduler = SchedulerManager.getInstance();

        scheduler.scheduleJob("cache-warm", "0 */6 * * *", async () => {
            await this.warmFeaturedLists();
        });
    }
}

export default MaintenanceService;
```
