---
sidebar_position: 2
sidebar_label: Your First App
---

# Your First App

Let's build a running BunSane server. By the end of this page, you will have an HTTP server and, in development, a GraphQL playground.

## Step 1: Create Your App Class

Every BunSane project has an `App`. This is where you configure the process and register services.

Create `src/App.ts`:

```typescript title="src/App.ts"
import "reflect-metadata";
import { App } from "bunsane";

export default class MyAPI extends App {
    constructor() {
        super({ name: "MyAPI", version: "0.1.0" });

        // Required if you enable CORS. origin may be a string, an array,
        // a function, or "*". credentials: true with origin: "*" throws.
        this.setCors({ origin: "http://localhost:5173" });
    }
}
```

`new App(name, version)` is the same as `new App({ name, version })`. Config fields set here win over later environment variables for that field.

`setCors` is optional. CORS stays off until you call it (or pass `cors` in the config). When you do call it, `origin` is required. `credentials: true` with `origin: "*"` throws at configuration time, because that combination used to reflect any request `Origin`.

Register middleware in the constructor. `use()` after `start()` throws. `requestId` and `securityHeaders` are already installed; you do not add them yourself unless you opted out. See [Middleware](../middleware.md).

## Step 2: Create Your Entry Point

Create `index.ts` in the project root:

```typescript title="index.ts"
import "reflect-metadata";
import MyAPI from "./src/App";

const app = new MyAPI();
await app.init();
```

`init()` validates the environment, migrates base tables, registers components, builds the GraphQL schema, and arms the database gateway. It does not listen by itself. When boot reaches `APPLICATION_READY`, BunSane calls `start()` unless `NODE_ENV=test`.

`start()` binds the HTTP server. A second `start()` logs a warning and returns. In tests, call `start()` yourself after `init()` if you need a listener.

`shutdown()` drains HTTP, then the scheduler, remote, cache, and database. A failed drain exits non-zero.

## Step 3: Run It

```bash
NODE_ENV=development bun run index.ts
```

You should see log output for database init and "Application Started". The default port is **3000** (`APP_PORT`).

Open:

- **`http://localhost:3000/graphql`** -- GraphiQL, only when GraphiQL is enabled
- **`http://localhost:3000/health`** -- liveness. This is a real database **write** probe, not `SELECT 1`

## What Just Happened?

`init()` then `start()`:

1. Validated environment variables. A bad value throws `Environment validation failed:`.
2. Connected to PostgreSQL and created the base tables.
3. Built the GraphQL schema (GraphQL Yoga). The schema is empty until you define services.
4. Started HTTP on port 3000.

Importing `"bunsane"` did none of that. The pool opens on first use. Yoga is created while `init()` builds the server.

## Development and production defaults

Introspection and GraphiQL follow this order:

1. `setGraphQLIntrospection(true | false)` / `setGraphQLGraphiQL(true | false)`, if you called them
2. else `GRAPHQL_INTROSPECTION` / `GRAPHQL_GRAPHIQL` (`on` or `off`)
3. else **on only when `NODE_ENV=development`**

`NODE_ENV=test`, `NODE_ENV=production`, and an unset `NODE_ENV` leave both off. With GraphiQL off, `GET /graphql` that asks for HTML returns 404. The GraphQL POST endpoint still works.

Other defaults you will hit immediately:

| Surface | Default |
|---|---|
| JSON body | 1 MB. Over `Content-Length` returns 413 |
| Multipart body | 50 MB. Missing `Content-Length` returns 411 |
| GraphQL depth | 15. `setGraphQLMaxDepth(0)` throws; it does not disable the limit |
| GraphQL complexity | 1000. `0` does not disable it |
| `/docs`, `/openapi.json`, `/metrics` | 404 until you set a token or `=public` |

Details are in [Configuration](../configuration.md) and [GraphQL](../graphql.md).

## Changing the Port

Set `APP_PORT`, or call `setPort` before `start()`:

```bash title=".env"
APP_PORT=8080
```

## What's Next

The server is running, but it does not store anything yet. Next you define a component -- the building block for data in BunSane.
