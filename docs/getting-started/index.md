---
sidebar_position: 1
sidebar_label: Installation
---

# Getting Started

This guide walks you through setting up a new BunSane project from scratch. It matches `main` (0.8, plus unreleased 0.9). npm `latest` is 0.6.1. See [Upgrading](../upgrading.md) if you are moving an existing app.

## Prerequisites

You need two things installed:

- **[Bun](https://bun.sh/)** 1.1 or newer (the package `engines` field). These docs were written against Bun 1.4.
- **PostgreSQL** 14 or newer. BunSane stores entities and components there.

## Create a New Project

Start by creating a new directory and initializing it with Bun:

```bash
mkdir my-app
cd my-app
bun init
```

Then install BunSane:

```bash
bun add bunsane
```

`reflect-metadata` is already a dependency. Import it once, before any decorated class:

```typescript
import "reflect-metadata";
```

## Configure Your Database

BunSane connects to PostgreSQL using `DB_CONNECTION_URL`, or using `POSTGRES_HOST`, `POSTGRES_USER`, and `POSTGRES_DB` together. Create a `.env` file in your project root:

```bash title=".env"
DB_CONNECTION_URL="postgres://username:password@localhost:5432/myapp"
NODE_ENV=development
```

Replace `username`, `password`, and `myapp` with your credentials. Create the database before you start the app. The full variable list is in [Configuration](../configuration.md).

`NODE_ENV=development` turns on GraphQL introspection and GraphiQL. Any other value, including unset and `test`, leaves both off unless you set `GRAPHQL_INTROSPECTION=on` / `GRAPHQL_GRAPHIQL=on`.

## Configure TypeScript

Decorators are required for `@Component`, `@ArcheType`, and `@GraphQLOperation`. Do not extend the BunSane repo `tsconfig.json` (`baseUrl: "."` is internal). Use a consumer config:

```json title="tsconfig.json"
{
    "compilerOptions": {
        "target": "ESNext",
        "module": "Preserve",
        "moduleResolution": "bundler",
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true,
        "strict": true
    }
}
```

`experimentalDecorators` and `emitDecoratorMetadata` are required. BunSane reads `design:type` to detect `Date` and `number` fields. Without them, those fields are not revived or indexed correctly.

The package ships TypeScript source. `moduleResolution: "bundler"` is what resolves the `.ts` export targets.

## Imports

Prefer the root barrel for anything it exports:

```typescript
import { App, Entity, Query, t } from "bunsane";
```

Importing `"bunsane"` does not open a database pool and does not construct the GraphQL server. The pool opens on first use. The server is built when `App.init()` runs.

Use a deep path only for symbols the barrel does not export (`Get` / `Post` from `"bunsane/service"`, `getDb` from `"bunsane/database"`, upload decorators from `"bunsane/upload"`, and so on).

## What's Next

With everything installed and configured, create your first app. The next page builds a running server.
