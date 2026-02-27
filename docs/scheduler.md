---
sidebar_position: 9
sidebar_label: Scheduler
---

# Scheduler

The scheduler runs recurring tasks that operate on entities. Define tasks with the `@ScheduledTask` decorator on service methods -- the scheduler handles timing, entity querying, retries, distributed locking, and metrics automatically.

## Defining Scheduled Tasks

Import `ScheduledTask` and `ScheduleInterval` from `bunsane/scheduler`:

```typescript
import { ScheduledTask, ScheduleInterval } from "bunsane/scheduler";
import { BaseService } from "bunsane/service";
import { Query } from "bunsane/query";

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

The decorator stores metadata on the class. Actual registration happens at app boot when `registerScheduledTasks(service)` is called for all registered services. The task ID is auto-generated as `ClassName.methodName` unless you provide one.

### Registering Tasks with Your Service

Call `registerScheduledTasks` in your service constructor after calling `super()`:

```typescript
import { registerScheduledTasks } from "bunsane/scheduler";

class SessionService extends BaseService {
    constructor(private app: App) {
        super();
        registerScheduledTasks(this);
    }

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
| `maxEntitiesPerExecution` | `number` | -- | Cap query results per tick |
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

Prefer `.take()` inside your query function rather than `maxEntitiesPerExecution` -- it limits results at the database level rather than after fetching.

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

In multi-instance deployments, the scheduler uses PostgreSQL advisory locks to ensure only one instance executes a given task at a time. When a second instance attempts the same task while the lock is held, it emits `task.skipped` and moves on -- it does not queue or block.

Lock keys are a deterministic hash of the task ID, namespaced to BunSane. Locks are session-scoped and are released automatically if the database connection drops.

Configure locking via `SchedulerManager.updateConfig()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `distributedLocking` | `boolean` | `true` | Enable advisory locks |
| `lockTimeout` | `number` | `0` | Lock wait time in ms (`0` = skip immediately) |
| `lockRetryInterval` | `number` | `100` | ms between lock retry attempts |

Setting `lockTimeout` to a value greater than `0` causes the scheduler to retry acquiring the lock until the timeout elapses before giving up.

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
| `distributedLocking` | `boolean` | `true` | Enable PostgreSQL advisory locks |
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
| `task.skipped` | Task skipped (concurrency limit or lock unavailable) |
| `task.lock.acquired` | Distributed lock acquired |
| `task.lock.released` | Distributed lock released |
| `task.lock.failed` | Failed to acquire distributed lock |
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
import { BaseService } from "bunsane/service";
import { ScheduledTask, ScheduleInterval, registerScheduledTasks } from "bunsane/scheduler";
import { SchedulerManager } from "bunsane/core/SchedulerManager";
import { Query } from "bunsane/query";
import App from "bunsane/core/App";

class MaintenanceService extends BaseService {
    constructor(private app: App) {
        super();
        registerScheduledTasks(this);
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
        query: () => new Query().with(UserComponent).with(ActivityComponent).take(10_000),
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
            await this.app.cache.warm(["featured-products", "top-categories"]);
        });
    }
}

export default MaintenanceService;
```
