---
sidebar_position: 2
sidebar_label: Your First App
---

# Your First App

Let's build a running BunSane server. By the end of this page, you will have a working API with a GraphQL playground.

## Step 1: Create Your App Class

Every BunSane project has an App class. This is where you configure your application and register services.

Create a file at `src/App.ts`:

```typescript title="src/App.ts"
import App from "bunsane/core/App";

export default class MyAPI extends App {
    constructor() {
        super("MyAPI", "0.1.0");
    }
}
```

The two arguments to `super()` are your app's name and version. These are used in logs and the auto-generated OpenAPI spec.

## Step 2: Create Your Entry Point

Create an `index.ts` file in your project root:

```typescript title="index.ts"
import MyAPI from "./src/App";

const app = new MyAPI();
app.init();
```

Calling `app.init()` does everything: connects to PostgreSQL, creates tables, registers your services, and starts the HTTP server.

## Step 3: Run It

```bash
bun run index.ts
```

You should see log output showing BunSane initializing the database and starting the server. Once it is ready, your app is listening on **port 3000**.

Open your browser and visit:

- **`http://localhost:3000/graphql`** -- GraphQL playground
- **`http://localhost:3000/health`** -- Health check endpoint

## What Just Happened?

When you called `app.init()`, BunSane:

1. Connected to your PostgreSQL database
2. Created the base tables it needs to store entities and components
3. Set up the GraphQL server (powered by [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server))
4. Started an HTTP server on port 3000

Right now the GraphQL schema is empty because you have not defined any components or services yet. That is what the next page covers.

## Changing the Port

Set the `APP_PORT` environment variable to use a different port:

```bash title=".env"
APP_PORT=8080
```

## What's Next

Your server is running, but it does not do anything useful yet. In the next section, you will define your first Component -- the building block for all data in BunSane.
