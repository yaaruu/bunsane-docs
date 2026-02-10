---
sidebar_position: 6
---

# GraphQL Integration

BunSane generates GraphQL schemas from your services automatically.

## Playground

Visit http://localhost:4000/graphql for the GraphQL playground.

## Auto-Generated Schema

Services create:
- Queries from methods starting with `get`, `list`, `find`
- Mutations from methods like `create`, `update`, `delete`
- Subscriptions from methods starting with `on` or `subscribe`

## Custom Types

Use TypeScript interfaces:

```typescript
interface User {
    id: string;
    name: string;
    email: string;
}

class UserService extends BaseService {
    async getUser(id: string): Promise<User> {
        // ...
    }
}
```

Creates GraphQL type `User`.

## Input Types

```typescript
interface CreateUserInput {
    name: string;
    email: string;
}

class UserService extends BaseService {
    async createUser(input: CreateUserInput): Promise<User> {
        // ...
    }
}
```

Creates `CreateUserInput` in GraphQL.

## Context

Access request data:

```typescript
class UserService extends BaseService {
    async getCurrentUser(context: any): Promise<User | null> {
        return context.user; // From JWT
    }
}
```

## Plugins

Add GraphQL Yoga plugins:

```typescript
import { useJWT } from "@graphql-yoga/plugin-jwt";

app.addYogaPlugin(useJWT({ ... }));
```

## Custom Resolvers

For complex logic, write custom resolvers in services.

## Error Handling

Use Zod for validation:

```typescript
import { z } from "zod";

const CreateUserSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
});

class UserService extends BaseService {
    async createUser(input: any) {
        const validated = CreateUserSchema.parse(input);
        // ...
    }
}
```

Errors are formatted for GraphQL automatically.