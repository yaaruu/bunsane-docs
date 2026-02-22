---
sidebar_position: 7
---

# Middleware

BunSane includes a middleware system for processing HTTP requests before they reach your routes. Middleware can add headers, log requests, inject request IDs, and more.

## Using Middleware

Register middleware with `app.use()` in your App class:

```typescript
import App from "bunsane/core/App";
import { requestId, accessLog, securityHeaders } from "bunsane/core/middleware";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        this.use(requestId());
        this.use(accessLog({ skip: ["/health"] }));
        this.use(securityHeaders());
    }
}
```

Middleware executes in the order you register it. Each middleware wraps the next, forming an onion-style chain -- the first middleware registered is the outermost layer.

## Built-in Middleware

### requestId

Generates a unique ID for every request and makes it available throughout your code. If the incoming request already has an `X-Request-Id` header (from a load balancer or proxy), that ID is reused.

```typescript
import { requestId } from "bunsane/core/middleware";

this.use(requestId());
```

The request ID is added to the `X-Request-Id` response header. To access it from anywhere in your code during a request:

```typescript
import { getRequestId } from "bunsane/core/middleware";

const id = getRequestId(); // Returns the current request's ID, or undefined outside a request
```

This uses `AsyncLocalStorage` internally, so it works in any function called during request processing -- no need to pass the ID around manually.

### accessLog

Logs every HTTP request with method, path, status code, and duration. It uses the built-in structured logger and includes the request ID for correlation.

```typescript
import { accessLog } from "bunsane/core/middleware";

this.use(accessLog());

// Skip noisy endpoints
this.use(accessLog({ skip: ["/health", "/graphql"] }));
```

Log levels are based on the response status code:
- **500+** -- logged as `error`
- **400-499** -- logged as `warn`
- **Everything else** -- logged as `info`

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `skip` | `string[]` | `[]` | Paths to exclude from logging |

### securityHeaders

Adds common security headers to all responses.

```typescript
import { securityHeaders } from "bunsane/core/middleware";

this.use(securityHeaders());
```

Default headers added:

| Header | Default Value | Notes |
|--------|---------------|-------|
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer information |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HSTS, production only by default |

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hsts` | `boolean` | `true` in production | Enable HSTS header |
| `hstsMaxAge` | `number` | `31536000` (1 year) | HSTS max-age in seconds |
| `frameOptions` | `'DENY'` \| `'SAMEORIGIN'` \| `false` | `'DENY'` | X-Frame-Options value |
| `noSniff` | `boolean` | `true` | Enable X-Content-Type-Options: nosniff |
| `referrerPolicy` | `string` \| `false` | `'strict-origin-when-cross-origin'` | Referrer-Policy value |
| `xssProtection` | `boolean` | `false` | Enable X-XSS-Protection (deprecated in modern browsers) |

## Writing Custom Middleware

A middleware is a function that receives the request and a `next` function. Call `next()` to pass the request to the next middleware (and eventually your route handler).

```typescript
import type { Middleware } from "bunsane/core/Middleware";

const timing: Middleware = async (req, next) => {
    const start = performance.now();
    const response = await next();
    const duration = Math.round(performance.now() - start);

    const headers = new Headers(response.headers);
    headers.set("X-Response-Time", `${duration}ms`);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
};
```

Then register it:

```typescript
this.use(timing);
```

### The Middleware Type

```typescript
type Middleware = (req: Request, next: () => Promise<Response>) => Promise<Response>;
```

- **`req`** -- the incoming `Request` object
- **`next`** -- call this to continue to the next middleware or the route handler
- **Return** -- a `Response` (either the one from `next()`, or a new one)

### How It Works (Onion Model)

Middleware wraps around your request handler like layers of an onion. Code before `next()` runs on the way in, and code after `next()` runs on the way out:

```
Request  -->  [Middleware 1]  -->  [Middleware 2]  -->  [Route Handler]
Response <--  [Middleware 1]  <--  [Middleware 2]  <--  [Route Handler]
```

This means you can:
- **Modify the request** before it reaches your handler (e.g., parse headers, authenticate)
- **Modify the response** after your handler runs (e.g., add headers, compress)
- **Short-circuit** by returning a response without calling `next()` (e.g., reject unauthorized requests)

### Example: Authentication Middleware

```typescript
const requireAuth: Middleware = async (req, next) => {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");

    if (!token) {
        return new Response(
            JSON.stringify({ error: "Authentication required" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        );
    }

    // Continue to the next middleware / route handler
    return next();
};
```

## Operation Middleware

In addition to HTTP middleware, BunSane supports **operation middleware** -- resolver-level middleware that runs per GraphQL operation. While HTTP middleware wraps every request before it reaches Yoga, operation middleware runs inside the resolver chain and has access to GraphQL-specific data: the operation arguments, the enriched context, and the `GraphQLResolveInfo` object.

Import from `bunsane/gql`:

```typescript
import { Middleware, type OperationMiddleware } from "bunsane/gql";
```

### The OperationMiddleware Type

```typescript
type OperationMiddleware = (
    args: any,
    context: any,
    info: any,
    next: () => Promise<any>,
) => Promise<any>;
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `any` | The GraphQL operation arguments passed by the client |
| `context` | `any` | The Yoga request context, enriched by `app.setGraphQLContextFactory()` |
| `info` | `any` | The `GraphQLResolveInfo` object (field name, schema, path, etc.) |
| `next` | `() => Promise<any>` | Calls the next middleware in the chain, or the resolver if none remain |

Call `next()` to continue the chain. Return its result (or a transformed version) as the operation's response. Throw a `GraphQLError` to short-circuit the chain entirely.

### Using @Middleware

Place `@Middleware` above `@GraphQLOperation` on any service method:

```typescript
import { Middleware, type OperationMiddleware } from "bunsane/gql";
import { GraphQLOperation } from "bunsane/gql";
import { GraphQLError } from "graphql";

const Authenticate: OperationMiddleware = async (args, ctx, info, next) => {
    if (!ctx.user) {
        throw new GraphQLError("Unauthenticated", {
            extensions: { code: "UNAUTHENTICATED" },
        });
    }
    return next();
};

class UserService extends BaseService {
    @Middleware([Authenticate])
    @GraphQLOperation({ type: "Query", output: "User", input: { id: "ID!" } })
    async getUser(args, context, info) {
        return db.users.findById(args.id);
    }
}
```

:::caution
`@Middleware` must be placed **above** `@GraphQLOperation`. TypeScript decorators apply bottom-up, so the middleware decorator wraps the already-decorated resolver.
:::

### Execution Order

Middleware in the array executes left-to-right, wrapping the resolver in an onion model identical to HTTP middleware. Code before `next()` runs on the way in; code after `next()` runs on the way out:

```
Operation call  -->  [Middleware 1]  -->  [Middleware 2]  -->  [Resolver]
Operation result <-- [Middleware 1]  <--  [Middleware 2]  <--  [Resolver]
```

Given `@Middleware([A, B, C])`:

1. `A` runs first and calls `next()`
2. `B` runs and calls `next()`
3. `C` runs and calls `next()`
4. The resolver executes
5. `C` resumes after its `next()` call
6. `B` resumes after its `next()` call
7. `A` resumes after its `next()` call

Any middleware can short-circuit by throwing a `GraphQLError` rather than calling `next()`.

### Writing Auth Guards

**Step 1 -- enrich the context** using `app.setGraphQLContextFactory()` in your App class. The factory receives the raw Yoga context (which includes the `Request`) and returns whatever you want available in `context` inside every resolver:

```typescript
import App from "bunsane/core/App";
import { verifyToken } from "./auth";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "1.0.0");

        this.setGraphQLContextFactory((yogaContext) => {
            const token = yogaContext.request.headers.get("Authorization")
                ?.replace("Bearer ", "");
            const user = token ? verifyToken(token) : null;
            return { user };
        });
    }
}
```

**Step 2 -- write the guards** in a shared file (e.g., `gql/guards.ts`):

```typescript
import { GraphQLError } from "graphql";
import type { OperationMiddleware } from "bunsane/gql";

export const Authenticate: OperationMiddleware = async (args, ctx, info, next) => {
    if (!ctx.user) {
        throw new GraphQLError("Unauthenticated", {
            extensions: { code: "UNAUTHENTICATED" },
        });
    }
    return next();
};

export function Authorize(...permissions: string[]): OperationMiddleware {
    return async (args, ctx, info, next) => {
        const granted: string[] = ctx.user?.permissions ?? [];
        const missing = permissions.filter((p) => !granted.includes(p));
        if (missing.length > 0) {
            throw new GraphQLError("Forbidden", {
                extensions: { code: "FORBIDDEN" },
            });
        }
        return next();
    };
}
```

**Step 3 -- apply them to operations:**

```typescript
import { Middleware, GraphQLOperation } from "bunsane/gql";
import { Authenticate, Authorize } from "./guards";

class UserService extends BaseService {
    @Middleware([Authenticate, Authorize("users.read")])
    @GraphQLOperation({ type: "Query", output: "User", input: { id: "ID!" } })
    async getUser(args, context, info) {
        return db.users.findById(args.id);
    }

    @Middleware([Authenticate, Authorize("users.write")])
    @GraphQLOperation({ type: "Mutation", output: "User", input: { name: "String!" } })
    async createUser(args, context, info) {
        return db.users.create(args);
    }
}
```

:::tip
The framework's `maskError` function in `gql/index.ts` automatically maps `UNAUTHENTICATED` errors to HTTP 401 and `FORBIDDEN` errors to HTTP 403. You do not need to set `http.status` on the `GraphQLError` extensions -- throwing with the right `code` is sufficient.
:::

### Transforming Results

Middleware can also intercept and transform the resolver's return value by awaiting `next()` and modifying its result:

```typescript
import type { OperationMiddleware } from "bunsane/gql";

const withAuditLog: OperationMiddleware = async (args, ctx, info, next) => {
    const result = await next();
    // Log after the resolver succeeds
    auditLog.record({ user: ctx.user?.id, operation: info.fieldName, args });
    return result;
};

const withNullCoerce: OperationMiddleware = async (args, ctx, info, next) => {
    const result = await next();
    // Replace null results with a default shape
    return result ?? { id: null, name: "Unknown" };
};
```

### HTTP Middleware vs Operation Middleware

| | HTTP Middleware | Operation Middleware |
|---|---|---|
| **Scope** | Every HTTP request | One GraphQL resolver |
| **Input** | Raw `Request` object | `args`, `context`, `info` |
| **Output** | `Response` | Resolver return value |
| **Registration** | `app.use(fn)` | `@Middleware([...])` decorator |
| **Short-circuit** | Return a `Response` early | Throw a `GraphQLError` |
| **Use cases** | Request IDs, logging, security headers, CORS | Auth, rate limiting, field-level auditing |
| **Import from** | `bunsane/core/middleware` | `bunsane/gql` |

Use HTTP middleware for concerns that apply across all requests (including non-GraphQL routes such as `/health` or webhook endpoints). Use operation middleware for logic that is specific to individual GraphQL operations and needs access to the parsed arguments or user context.
