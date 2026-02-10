---
sidebar_position: 4
---

# Services

Services are the primary way to expose your application's functionality through GraphQL and REST APIs. This page provides an overview of service patterns and best practices.

## Service Structure

A typical service follows this structure:

```typescript
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import App from "bunsane/core/App";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import type { GraphQLContext, GraphQLInfo } from "bunsane/types/graphql.types";

class ProductService extends BaseService {
    constructor(private app: App) {
        super();
        ProductArcheType.registerFieldResolvers(this);
    }

    @GraphQLOperation({
        type: "Query",
        output: ProductArcheType,
    })
    async getProduct(args: { id: string }, context: GraphQLContext) {
        return await Entity.FindById(args.id);
    }

    @GraphQLOperation({
        type: "Query",
        output: ProductListArcheType,
    })
    async listProducts(args: {}, context: GraphQLContext) {
        const products = await new Query()
            .with(ProductInfoComponent)
            .exec();
        return { totalData: products.length, items: products };
    }
}

export default ProductService;
```

## Organizing Services

Organize services by domain or feature:

```
src/
  services/
    AuthService.ts
    UserService.ts
    OrderService.ts
    PayService.ts
    admin/
      AdminUserService.ts
      AdminOrderService.ts
```

## Registering Multiple Services

Register all services in your App constructor:

```typescript
import { ServiceRegistry } from "bunsane/service";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        // Core services
        ServiceRegistry.registerService(new AuthService(this));
        ServiceRegistry.registerService(new UserService(this));
        ServiceRegistry.registerService(new OrderService(this));
        ServiceRegistry.registerService(new PayService(this));

        // Admin module
        RegisterAdminModule(this);

        // Development-only services
        if (process.env.NODE_ENV === "development") {
            ServiceRegistry.registerService(new DebugService(this));
        }
    }
}
```

## Service Dependencies

Services can depend on other services or configuration managers:

```typescript
class OrderService extends BaseService {
    constructor(
        private app: App,
        private appConfig: AppConfigManager
    ) {
        super();
        OrderArcheType.registerFieldResolvers(this);
    }

    @GraphQLOperation({
        type: "Mutation",
        input: CreateOrderSchema,
        output: OrderArcheType,
    })
    async createOrder(args: CreateOrderInput, context: GraphQLContext) {
        const config = await this.appConfig.getConfig();
        // Use config values
    }
}
```

## Importing Components

Import all component files in your App to ensure decorators are executed:

```typescript
// Import all component files to ensure decorators are executed during app initialization
import "./components/UserComponent";
import "./components/OrderComponent";
import "./components/PayComponent";
```

## GraphQL Context

The GraphQL context provides access to:

- `context.jwt` - JWT payload (when authenticated)
- `context.loaders` - DataLoaders for efficient batching

```typescript
async getUser(args: { id: string }, context: GraphQLContext) {
    // Access authenticated user
    const currentUserId = context.jwt?.payload?.user_id;

    // Use loaders for efficient data fetching
    const user = await context.loaders.entity.load(args.id);

    return user;
}
```

## File Uploads

Handle file uploads in GraphQL mutations:

```typescript
import { Upload } from "bunsane/gql";
import { UploadManager } from "bunsane/upload";

@GraphQLOperation({
    type: "Mutation",
    input: z.object({
        file: Upload,
    }),
    output: UserArcheType,
})
async uploadProfilePicture(args: { file: any }, context: GraphQLContext) {
    const userId = context.jwt.payload.user_id;
    const user = await Entity.FindById(userId);
    if (!user) {
        return responseError("User not found");
    }

    const uploadManager = UploadManager.getInstance();
    const uploadResult = await uploadManager.uploadFile(args.file, {
        maxFileSize: 5 * 1024 * 1024, // 5MB
    });

    if (!uploadResult.success) {
        return responseError("Failed to upload file");
    }

    await user.set(ProfilePictureComponent, { path: uploadResult.path });
    await user.save();
    return user;
}
```

## Logging

Use the built-in logger for service logging:

```typescript
import { logger as MainLogger } from "bunsane/core/Logger";

const logger = MainLogger.child({ service: "UserService" });

class UserService extends BaseService {
    async getUser(args: { id: string }, context: GraphQLContext) {
        logger.trace({ msg: `Fetching user with ID: ${args.id}` });

        const user = await Entity.FindById(args.id);
        if (!user) {
            logger.warn({ msg: `User not found: ${args.id}` });
            return null;
        }

        return user;
    }
}
```

## Service Communication

Services can communicate through:

1. **Direct method calls** - When services have references to each other
2. **PubSub** - For event-driven communication
3. **Entity hooks** - For reacting to data changes

```typescript
// Using PubSub for service communication
class OrderService extends BaseService {
    async completeOrder(orderId: string) {
        // Update order status
        const order = await Entity.FindById(orderId);
        await order.set(OrderStatusComponent, { value: "completed" });
        await order.save();

        // Notify other services
        this.app.pubSub.publish("order.completed", { orderId, order });
    }
}

class NotificationService extends BaseService {
    constructor(private app: App) {
        super();
        // Subscribe to order events
        this.app.pubSub.subscribe("order.completed", this.onOrderCompleted.bind(this));
    }

    async onOrderCompleted(data: { orderId: string; order: Entity }) {
        // Send notification
    }
}
```

## Testing Services

Services can be tested by mocking dependencies:

```typescript
import { describe, test, expect } from "bun:test";

describe("UserService", () => {
    test("should return user profile", async () => {
        const mockApp = {
            pubSub: { publish: () => {}, subscribe: () => {} },
        };

        const service = new UserService(mockApp as any);

        const mockContext = {
            jwt: { payload: { user_id: "test-user-id" } },
        };

        const result = await service.profile({}, mockContext as any);
        expect(result).toBeDefined();
    });
});
```
