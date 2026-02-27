---
sidebar_position: 8
sidebar_label: Entity Hooks
---

# Entity Hooks

Entity hooks let you react to entity and component lifecycle events without modifying the code that triggers them. Hooks run automatically when entities are created, updated, or deleted, and when components are added, changed, or removed. They are the right tool for cross-cutting concerns like audit logging, cache invalidation, and side-effect notifications.

## Event Types

There are six hook event types, split into two categories.

| Event | Class | Fires When |
|---|---|---|
| `entity.created` | `EntityCreatedEvent` | After the first `entity.save()` on a new entity |
| `entity.updated` | `EntityUpdatedEvent` | After `entity.save()` when components changed |
| `entity.deleted` | `EntityDeletedEvent` | After `entity.delete()` |
| `component.added` | `ComponentAddedEvent` | Inside `entity.add(component)` |
| `component.updated` | `ComponentUpdatedEvent` | Inside `entity.set(TypeID, data)` when data changes |
| `component.removed` | `ComponentRemovedEvent` | Inside `entity.remove(TypeID)` |

**Entity events** (`entity.*`) are awaited -- your app waits for them to complete before continuing. **Component events** (`component.*`) fire asynchronously as fire-and-forget side effects.

## Event Properties

All events expose `timestamp`, `entity`, and `eventType`, plus getter methods for each.

| Event Class | Additional Properties |
|---|---|
| `EntityUpdatedEvent` | `changedComponents: string[]` -- type IDs of components that changed |
| `EntityDeletedEvent` | `isSoftDelete: boolean` |
| `ComponentAddedEvent`, `ComponentUpdatedEvent`, `ComponentRemovedEvent` | `component`, `componentType` |
| `ComponentUpdatedEvent` | `oldData`, `newData` |

## Decorator API

The decorator API is the primary way to register hooks inside services. Import from `bunsane/core/decorators/EntityHooks`.

Services that extend `BaseService` have their decorated hooks auto-registered during app boot via `ComponentRegistry`. No manual registration is needed.

### @EntityHook

Fires on a specific entity event.

```typescript
import { EntityHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

class AuditService extends BaseService {
    @EntityHook("entity.created", { priority: 10, name: "audit-create" })
    async onEntityCreated(event: EntityCreatedEvent) {
        await auditLog.write({
            action: "created",
            entityId: event.entity.id,
            at: event.timestamp,
        });
    }
}
```

### @ComponentHook

Fires on a specific component event.

```typescript
import { ComponentHook } from "bunsane/core/decorators/EntityHooks";
import type { ComponentUpdatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

class AuditService extends BaseService {
    @ComponentHook("component.updated", { async: true })
    async onComponentUpdated(event: ComponentUpdatedEvent) {
        await auditLog.write({
            entityId: event.entity.id,
            component: event.componentType,
            before: event.oldData,
            after: event.newData,
        });
    }
}
```

### @LifecycleHook

Fires on all six event types. Useful for blanket audit trails or debugging.

```typescript
import { LifecycleHook } from "bunsane/core/decorators/EntityHooks";
import type { LifecycleEvent } from "bunsane/core/events/EntityLifecycleEvents";

class DebugService extends BaseService {
    @LifecycleHook({ name: "debug-all" })
    onAnyEvent(event: LifecycleEvent) {
        console.log(`[${event.eventType}] entity=${event.entity.id}`);
    }
}
```

### @ComponentTargetHook

An entity event hook that only fires when the entity has (or lacks) specific components. This is the most common hook decorator -- it lets you scope reactions precisely without cluttering the callback with component-presence checks.

```typescript
import { ComponentTargetHook } from "bunsane/core/decorators/EntityHooks";
import type { EntityCreatedEvent } from "bunsane/core/events/EntityLifecycleEvents";

class NotificationService extends BaseService {
    @ComponentTargetHook("entity.created", {
        includeComponents: [OrderTag, OrderInfoComponent],
    })
    async onOrderCreated(event: EntityCreatedEvent) {
        const info = await event.entity.get(OrderInfoComponent);
        if (!info) return;
        await sendEmail({ to: info.customerEmail, subject: "Order received" });
    }
}
```

The hook only fires if the entity has **all** components in `includeComponents` (AND logic by default). See [Component Targeting](#component-targeting) for the full configuration.

## Hook Options

All four decorators accept an `options` object as their last argument.

| Option | Type | Default | Description |
|---|---|---|---|
| `priority` | `number` | `0` | Higher numbers execute first |
| `name` | `string` | -- | Label for debugging and metrics |
| `async` | `boolean` | `false` | `true` runs this hook in parallel with other async hooks |
| `filter` | `(event) => boolean` | -- | Predicate for conditional execution |
| `timeout` | `number` | -- | Maximum execution time in ms before the hook is aborted |
| `componentTarget` | `ComponentTargetConfig` | -- | Filter by entity component composition |

## Component Targeting

`ComponentTargetConfig` controls which entities trigger a hook based on what components they carry. It applies to `@ComponentTargetHook` and can also be set on `@EntityHook` via the `componentTarget` option.

| Option | Type | Default | Description |
|---|---|---|---|
| `includeComponents` | `Component[]` | -- | Entity must have these components |
| `excludeComponents` | `Component[]` | -- | Entity must NOT have these components |
| `requireAllIncluded` | `boolean` | `true` | `true` = AND logic, `false` = OR logic for `includeComponents` |
| `requireAllExcluded` | `boolean` | `true` | `true` = AND logic, `false` = OR logic for `excludeComponents` |
| `archetype` | `ArcheType` | -- | Entity must match this archetype exactly |
| `archetypes` | `ArcheType[]` | -- | Entity must match ANY of these archetypes |

```typescript
// Only fire for entities that are orders but NOT yet shipped
@ComponentTargetHook("entity.updated", {
    includeComponents: [OrderTag, OrderInfoComponent],
    excludeComponents: [ShippedTag],
})
async onUnshippedOrderUpdated(event: EntityUpdatedEvent) {
    // ...
}
```

## Execution Model

Within a single event, hooks run in two passes:

1. **Sync hooks** (default) -- execute sequentially in priority order (highest first).
2. **Async hooks** (`async: true`) -- execute in parallel via `Promise.allSettled()` after all sync hooks complete.

Each hook is individually error-wrapped. A failing hook is logged and skipped; it does not interrupt the other hooks or the entity operation that triggered them.

```
event fires
  → sync hook (priority 10)
  → sync hook (priority 0)
  → async hook  ─┐
  → async hook   ├── run in parallel
  → async hook  ─┘
```

## Error Handling

Hook errors never propagate back to the caller. They are caught, logged at `error` level, and execution continues with the remaining hooks. This is intentional -- hooks are side effects, not gatekeepers. If you need to block an operation based on a condition, do it inside the operation itself, not in a hook.

## Programmatic API

Use `EntityHookManager` directly when you need to register hooks outside of a service class -- for example, from application bootstrap code or tests.

```typescript
import EntityHookManager from "bunsane/core/EntityHookManager";

// Register for a specific entity event
const hookId = EntityHookManager.registerEntityHook(
    "entity.created",
    (event) => { console.log("created:", event.entity.id); },
    { priority: 5 }
);

// Register for a specific component event
const hookId2 = EntityHookManager.registerComponentHook(
    "component.added",
    (event) => { console.log("component added:", event.componentType); }
);

// Register for all six event types at once
const hookId3 = EntityHookManager.registerLifecycleHook(
    (event) => { console.log(event.eventType); }
);

// Remove a specific hook
EntityHookManager.removeHook(hookId);

// Remove all hooks (useful in test teardown)
EntityHookManager.clearAllHooks();
```

## Metrics

`EntityHookManager` tracks execution counts, timing, and error rates.

```typescript
import EntityHookManager from "bunsane/core/EntityHookManager";

// Total hooks registered (all event types)
EntityHookManager.getHookCount();

// Hooks registered for a specific event
EntityHookManager.getHookCount("entity.created");

// Global execution metrics
const metrics = EntityHookManager.getMetrics();
// { totalExecutions, totalExecutionTime, averageExecutionTime, errorCount, lastExecutionTime }

// Metrics scoped to one event type
const entityMetrics = EntityHookManager.getMetrics("entity.updated");

// Reset all metrics (or scoped to one event)
EntityHookManager.resetMetrics();
EntityHookManager.resetMetrics("entity.updated");
```

## Practical Example

A realistic service that combines an audit hook, a cache invalidation hook, and a component-targeted notification hook.

```typescript
import { BaseService } from "bunsane/service";
import {
    EntityHook,
    ComponentHook,
    ComponentTargetHook,
} from "bunsane/core/decorators/EntityHooks";
import type {
    EntityCreatedEvent,
    EntityUpdatedEvent,
    EntityDeletedEvent,
    ComponentUpdatedEvent,
} from "bunsane/core/events/EntityLifecycleEvents";
import { logger as MainLogger } from "bunsane/core/Logger";
import { CacheManager } from "bunsane/core/cache";

const logger = MainLogger.child({ service: "OrderSideEffects" });

class OrderSideEffectsService extends BaseService {
    // --- Audit log for all order mutations ---

    @EntityHook("entity.created", { name: "order-audit-create", priority: 10 })
    async onOrderCreated(event: EntityCreatedEvent) {
        await db.auditLog.insert({
            action: "order.created",
            entityId: event.entity.id,
            performedAt: event.timestamp,
        });
    }

    @EntityHook("entity.updated", { name: "order-audit-update", priority: 10 })
    async onOrderUpdated(event: EntityUpdatedEvent) {
        await db.auditLog.insert({
            action: "order.updated",
            entityId: event.entity.id,
            changedComponents: event.changedComponents,
            performedAt: event.timestamp,
        });
    }

    @EntityHook("entity.deleted", { name: "order-audit-delete", priority: 10 })
    async onOrderDeleted(event: EntityDeletedEvent) {
        await db.auditLog.insert({
            action: event.isSoftDelete ? "order.archived" : "order.deleted",
            entityId: event.entity.id,
            performedAt: event.timestamp,
        });
    }

    // --- Cache invalidation (async, runs in parallel with other async hooks) ---

    @EntityHook("entity.updated", {
        name: "order-cache-invalidate",
        async: true,
        filter: (event) => (event as EntityUpdatedEvent).changedComponents.includes("OrderStatus"),
    })
    async onOrderStatusChangedInvalidateCache(event: EntityUpdatedEvent) {
        const cache = CacheManager.getInstance();
        await cache.invalidateEntity(event.entity.id);
        logger.info({ entityId: event.entity.id }, "Cache invalidated after status change");
    }

    // --- Notification: only for entities that are orders with a customer email ---

    @ComponentTargetHook(
        "entity.updated",
        {
            includeComponents: [OrderTag, OrderStatusComponent, CustomerEmailComponent],
            excludeComponents: [NotificationSentTag],
        },
        { name: "order-status-notify", async: true }
    )
    async onOrderReadyToNotify(event: EntityUpdatedEvent) {
        const status = await event.entity.get(OrderStatusComponent);
        const contact = await event.entity.get(CustomerEmailComponent);
        if (!status || !contact) return;

        await emailService.send({
            to: contact.email,
            subject: `Your order is now: ${status.value}`,
        });

        // Mark as notified so this hook doesn't fire again for the same update
        await event.entity.add(NotificationSentTag, {});
    }

    // --- Component-level hook to track individual field changes ---

    @ComponentHook("component.updated", {
        name: "order-status-log",
        filter: (event) => event.componentType === OrderStatusComponent.TYPE_ID,
    })
    onOrderStatusComponentChanged(event: ComponentUpdatedEvent) {
        logger.info(
            { entityId: event.entity.id, from: event.oldData, to: event.newData },
            "Order status component changed"
        );
    }
}

export default OrderSideEffectsService;
```

Register it alongside your other services:

```typescript
import { ServiceRegistry } from "bunsane/service";
import OrderSideEffectsService from "./services/OrderSideEffectsService";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        ServiceRegistry.registerService(new OrderSideEffectsService());
        // ... other services
    }
}
```

No additional wiring is needed -- the decorators are picked up automatically when the service is registered.
